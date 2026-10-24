"""Pure helpers for Bambu G-code: read what a sliced file needs, and wrap it as a .gcode.3mf.

No I/O beyond the bytes passed in, so all of this is unit-tested without a printer.
"""
from __future__ import annotations

import hashlib
import io
import re
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

PLATE_GCODE = "Metadata/plate_{plate}.gcode"


@dataclass
class GcodeInfo:
    """What the slicer wrote into the file's header and config block."""

    slicer: str | None = None
    printer_model: str | None = None  # "Bambu Lab A1 mini"
    nozzle_diameter: float | None = None
    filament_type: str | None = None  # the first filament the print uses, e.g. "PLA"
    filament_types_used: list[str] = field(default_factory=list)
    filament_color: str | None = None
    weight_g: float | None = None
    est_time_s: int | None = None
    layers: int | None = None
    max_z_mm: float | None = None
    bed_type: str | None = None
    nozzle_temp_c: int | None = None
    bed_temp_c: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


_TIME_PART = re.compile(r"(\d+)\s*([dhms])")
_UNIT_S = {"d": 86400, "h": 3600, "m": 60, "s": 1}


def parse_duration(text: str) -> int | None:
    """'1h 2m 5s' -> 3725. None if nothing parses."""
    parts = _TIME_PART.findall(text)
    return sum(int(n) * _UNIT_S[u] for n, u in parts) if parts else None


def _list(value: str | None, sep: str) -> list[str]:
    if not value:
        return []
    return [v.strip().strip('"') for v in value.split(sep)]


def _num(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def inspect_gcode(text: str) -> GcodeInfo:
    """Read the Bambu Studio / OrcaSlicer header and config block. Fields missing from the file stay None."""
    header: dict[str, str] = {}
    config: dict[str, str] = {}
    body_types: list[str] = []
    first_bed: int | None = None
    max_nozzle: int | None = None
    section = None
    in_body = False
    for line in text.splitlines():
        if line.startswith("; HEADER_BLOCK_START"):
            section = header
            continue
        if line.startswith("; CONFIG_BLOCK_START"):
            section = config
            continue
        if line.startswith(("; HEADER_BLOCK_END", "; CONFIG_BLOCK_END")):
            section = None
            continue
        if line.startswith("; EXECUTABLE_BLOCK_START"):
            in_body = True
            continue
        if section is not None and line.startswith("; "):
            body = line[2:]
            if section is config and " = " in body:
                k, v = body.split(" = ", 1)
                section[k.strip()] = v.strip()
            elif section is header:
                if ":" in body:
                    k, v = body.split(":", 1)
                    section[k.strip()] = v.strip()
                elif not header.get("_slicer"):
                    header["_slicer"] = body.strip()
            continue
        if in_body or section is None:
            if line.startswith("M1002 set_filament_type:"):
                t = line.split(":", 1)[1].strip()
                if t and t != "UNKNOWN":
                    body_types.append(t)
            elif line.startswith(("M104 S", "M109 S")):
                m = re.match(r"M10[49] S(\d+)", line)
                if m:
                    max_nozzle = max(max_nozzle or 0, int(m.group(1)))
            elif first_bed is None and line.startswith(("M140 S", "M190 S")):
                m = re.match(r"M1[49]0 S(\d+)", line)
                if m and int(m.group(1)) > 0:
                    first_bed = int(m.group(1))

    info = GcodeInfo()
    info.slicer = header.get("_slicer")
    info.printer_model = config.get("printer_model") or None
    nozzle = _list(config.get("nozzle_diameter"), ",")
    info.nozzle_diameter = _num(nozzle[0]) if nozzle else None

    types = _list(config.get("filament_type"), ";")
    colors = _list(config.get("filament_colour"), ";")
    temps = _list(config.get("nozzle_temperature"), ",")
    used = [int(i) - 1 for i in _list(header.get("filament"), ",") if i.isdigit()]
    if types and used and all(0 <= i < len(types) for i in used):
        info.filament_types_used = [types[i] for i in used]
        first = used[0]
        info.filament_color = colors[first] if first < len(colors) else None
        info.nozzle_temp_c = int(_num(temps[first]) or 0) or None if first < len(temps) else None
    elif body_types:
        info.filament_types_used = list(dict.fromkeys(body_types))
    if body_types:
        # The firmware is told the type by M1002 in the body; that is the one that prints.
        info.filament_type = body_types[0]
    elif info.filament_types_used:
        info.filament_type = info.filament_types_used[0]
    if info.nozzle_temp_c is None:
        info.nozzle_temp_c = max_nozzle

    info.weight_g = _num(header.get("total filament weight [g]"))
    est = header.get("model printing time")
    if est and "total estimated time:" in est:
        info.est_time_s = parse_duration(est.split("total estimated time:", 1)[1])
    elif est:
        info.est_time_s = parse_duration(est)
    layers = _num(header.get("total layer number"))
    info.layers = int(layers) if layers is not None else None
    info.max_z_mm = _num(header.get("max_z_height"))
    info.bed_type = config.get("curr_bed_type") or None
    info.bed_temp_c = first_bed
    return info


def normalize_material(name: str | None) -> str | None:
    """'pla ' -> 'PLA', 'PETG CF' -> 'PETG-CF'. Trays report tray_type in this form."""
    if not name:
        return None
    return re.sub(r"[\s_]+", "-", name.strip().upper())


def build_gcode_3mf(gcode: bytes, info: GcodeInfo | None = None, plate: int = 1) -> bytes:
    """Wrap plain G-code as a single-plate .gcode.3mf, the format the printer's project_file command takes.

    The printer reads Metadata/plate_<n>.gcode (and checks its .md5); the rest is the minimum
    3MF package plus a slice_info.config so the screen shows the time and filament.
    """
    info = info or GcodeInfo()
    md5 = hashlib.md5(gcode).hexdigest().upper()
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
        ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
        ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
        ' <Default Extension="gcode" ContentType="text/x.gcode"/>\n'
        "</Types>\n"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
        "</Relationships>\n"
    )
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
        ' <metadata name="Application">Fabrary</metadata>\n'
        " <resources/>\n <build/>\n</model>\n"
    )
    filament = ""
    if info.filament_type:
        color = info.filament_color or "#FFFFFF"
        filament = (f'    <filament id="1" type="{info.filament_type}" color="{color}" '
                    f'used_m="0" used_g="{info.weight_g or 0:.2f}" />\n')
    slice_info = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n'
        '    <header_item key="X-BBL-Client-Type" value="slicer"/>\n'
        '    <header_item key="X-BBL-Client-Version" value=""/>\n  </header>\n'
        f'  <plate>\n    <metadata key="index" value="{plate}"/>\n'
        f'    <metadata key="printer_model_id" value=""/>\n'
        f'    <metadata key="nozzle_diameters" value="{info.nozzle_diameter or 0.4}"/>\n'
        f'    <metadata key="prediction" value="{info.est_time_s or 0}"/>\n'
        f'    <metadata key="weight" value="{info.weight_g or 0:.2f}"/>\n'
        '    <metadata key="outside" value="false"/>\n'
        '    <metadata key="support_used" value="false"/>\n'
        f"{filament}  </plate>\n</config>\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", model)
        z.writestr(PLATE_GCODE.format(plate=plate), gcode)
        z.writestr(PLATE_GCODE.format(plate=plate) + ".md5", md5)
        z.writestr("Metadata/slice_info.config", slice_info)
    return buf.getvalue()


def read_3mf_gcode(path: Path, plate: int = 1) -> bytes:
    """The plate's G-code from a .gcode.3mf. Raises KeyError if the plate is not in the file."""
    with zipfile.ZipFile(path) as z:
        return z.read(PLATE_GCODE.format(plate=plate))


def plates_in_3mf(path: Path) -> list[int]:
    with zipfile.ZipFile(path) as z:
        found = (re.fullmatch(r"Metadata/plate_(\d+)\.gcode", n) for n in z.namelist())
        return sorted(int(m.group(1)) for m in found if m)
