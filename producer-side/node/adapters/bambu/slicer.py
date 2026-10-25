"""Slice a model (.3mf or .stl) for the A1 mini with the Bambu Studio command line.

Bambu Studio's CLI does not resolve a system preset's `inherits` chain or the G-code templates its
`include` list names. Given the bundled preset files as they are, it still reports success, but
slices with generic defaults: no A1 mini start sequence (no bed levelling), 200 °C, a 2 mm³/s flow
cap, Cool Plate. So the presets are flattened here first (parents, then included templates, then
the preset's own keys), and the G-code is checked for the A1 mini start sequence and sane PLA
settings before anything is uploaded.

Config (manifest adapter block, all optional):
  slicer_path      Bambu Studio binary (default $BAMBU_STUDIO_CLI, then /Applications/BambuStudio.app)
  slicer_profiles  the BBL profile folder (default: inside the app)
  slice_profile    {"machine", "process", "filament", "bed_type", "filament_colour"}; the defaults are
                   Bambu Studio's standard A1 mini settings with white Bambu PLA Basic
  slice_timeout_s  default 180
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from ..base import AdapterError
from .gcode import GcodeInfo, inspect_gcode

APP_BINARY = "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio"
DEFAULT_PROFILE = {
    "machine": "Bambu Lab A1 mini 0.4 nozzle",
    "process": "0.20mm Standard @BBL A1M",
    "filament": "Bambu PLA Basic @BBL A1M",
    "bed_type": "Textured PEI Plate",
    "filament_colour": "#FFFFFF",
}
TEMPLATE_KEYS = {"name", "instantiation", "type", "from", "inherits", "include"}
START_MARKER = re.compile(r"^;=+ machine: A1 mini", re.M)
LEVELING = re.compile(r"^\s*G29\b", re.M)
HOMING = re.compile(r"^\s*G28\b", re.M)
FLOW_CAP = re.compile(r"^; filament_max_volumetric_speed = ([\d.]+)", re.M)
PLA_NOZZLE_C = (190, 240)
MIN_FLOW_MM3_S = 5


def cli_path(config: dict[str, Any]) -> str:
    for candidate in (config.get("slicer_path"), os.environ.get("BAMBU_STUDIO_CLI"), APP_BINARY):
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise AdapterError("slicer_unavailable: Bambu Studio is not installed; set adapter.slicer_path "
                       "or BAMBU_STUDIO_CLI, or send a sliced .gcode")


def profiles_dir(cli: str, config: dict[str, Any]) -> Path:
    if config.get("slicer_profiles"):
        return Path(config["slicer_profiles"])
    return Path(cli).resolve().parents[1] / "Resources/profiles/BBL"


def flatten(root: Path, kind: str, name: str) -> dict[str, Any]:
    """One system preset with everything it inherits and includes, as a single settings file."""
    presets: dict[str, dict[str, Any]] = {}
    for path in (root / kind).glob("*.json"):
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and isinstance(data.get("name"), str):
            presets[data["name"]] = data

    def resolve(preset: str, chain: tuple[str, ...]) -> dict[str, Any]:
        if preset not in presets:
            raise AdapterError(f"slicer_profile: no {kind} preset named {preset!r} in {root}")
        if preset in chain:
            raise AdapterError(f"slicer_profile: {kind} preset {preset!r} inherits itself")
        own = presets[preset]
        merged = resolve(own["inherits"], (*chain, preset)) if own.get("inherits") else {}
        for template in own.get("include", []):
            if template not in presets:
                raise AdapterError(f"slicer_profile: {preset!r} includes missing {kind} template {template!r}")
            merged.update({k: v for k, v in presets[template].items() if k not in TEMPLATE_KEYS})
        merged.update({k: v for k, v in own.items() if k != "include"})
        return merged

    flat = resolve(name, ())
    flat.pop("inherits", None)
    flat["from"] = "system"
    return flat


def check_gcode(text: str, info: GcodeInfo, profile: dict[str, str]) -> list[str]:
    """Reasons this G-code was not sliced with the full A1 mini profile. Empty list = good."""
    problems = []
    if info.printer_model != "Bambu Lab A1 mini":
        problems.append(f"sliced for {info.printer_model or 'an unknown printer'}")
    if not START_MARKER.search(text) or not HOMING.search(text) or not LEVELING.search(text):
        problems.append("the A1 mini start sequence (homing and bed levelling) is missing")
    low, high = PLA_NOZZLE_C
    if not info.nozzle_temp_c or not low <= info.nozzle_temp_c <= high:
        problems.append(f"nozzle temperature {info.nozzle_temp_c} °C is outside {low}-{high} °C for PLA")
    flow = FLOW_CAP.search(text)
    if not flow or float(flow.group(1).split(",")[0]) < MIN_FLOW_MM3_S:
        problems.append("the filament flow limit is the generic default, so the filament preset did not load")
    if not info.weight_g:
        problems.append("no filament weight, so the filament preset did not load")
    if info.bed_type != profile["bed_type"]:
        problems.append(f"plate is {info.bed_type}, expected {profile['bed_type']}")
    return problems


def slice_model(model: Path, work: Path, config: dict[str, Any]) -> Path:
    """Slice plate 1 of `model` into `work`; return the checked plain G-code."""
    model, work = model.resolve(), work.resolve()  # the slicer runs inside `work`
    cli = cli_path(config)
    root = profiles_dir(cli, config)
    profile = {**DEFAULT_PROFILE, **(config.get("slice_profile") or {})}
    shutil.rmtree(work, ignore_errors=True)
    (work / "out").mkdir(parents=True)
    settings = {
        "machine": flatten(root, "machine", profile["machine"]),
        "process": {**flatten(root, "process", profile["process"]), "curr_bed_type": profile["bed_type"]},
        "filament": {**flatten(root, "filament", profile["filament"]),
                     "filament_colour": [profile["filament_colour"]],
                     "default_filament_colour": [profile["filament_colour"]]},
    }
    for kind, data in settings.items():
        (work / f"{kind}.json").write_text(json.dumps(data, indent=1))
    command = [cli, "--debug", "1", "--datadir", str(work / "datadir"),
               "--load-settings", f"{work / 'machine.json'};{work / 'process.json'}",
               "--load-filaments", str(work / "filament.json"),
               "--arrange", "1", "--orient", "0", "--slice", "0",
               "--outputdir", str(work / "out"), "--export-3mf", "sliced.gcode.3mf", str(model)]
    try:
        done = subprocess.run(command, cwd=work, capture_output=True, text=True,
                              timeout=float(config.get("slice_timeout_s", 180)))
    except (OSError, subprocess.TimeoutExpired) as e:
        raise AdapterError(f"slicer_failed: {e}") from e
    result = _result(work / "out/result.json")
    gcode = work / "out/plate_1.gcode"
    if done.returncode != 0 or result.get("return_code") != 0 or not gcode.is_file():
        reason = result.get("error_string") or (done.stderr or done.stdout).strip()[-300:] or done.returncode
        raise AdapterError(f"slicer_failed: {reason}")
    text = gcode.read_text(errors="replace")
    problems = check_gcode(text, inspect_gcode(text), profile)
    if problems:
        raise AdapterError("slicer_profile: " + "; ".join(problems))
    return gcode


def _result(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
