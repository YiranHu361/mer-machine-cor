"""Bambu Lab A1 mini (process fdm_print), over the LAN.

prepare: a sliced .gcode (wrapped into a .gcode.3mf) or a .gcode.3mf (checked, passed through);
         an unsliced .3mf or .stl model is sliced first with Bambu Studio (slicer.py). Asset links
         carry no file extension, so the type is read from the file's first bytes.
         Reads printer model, nozzle, filament type, weight and time from the slicer's header.
run:     connect (MQTT), check the printer can safely take this file, upload it (FTPS),
         start it (project_file), follow MQTT progress until FINISH.

Pre-flight refuses, with a reason, when: the file is for another printer or nozzle; the printer
is busy, paused or has no SD card; the loaded filament type differs from the file's; there is
not enough filament; or the plate may still hold the last print.
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import struct
import time
from pathlib import Path
from typing import Any, AsyncIterator

from ...protocol import Job
from ..base import Adapter, AdapterError, Progress
from .gcode import (GcodeInfo, build_gcode_3mf, inspect_gcode, normalize_material, plates_in_3mf,
                    read_3mf_gcode)
from .slicer import slice_model
from .transport import Transport, make_transport, project_file_cmd, stop_cmd

log = logging.getLogger(__name__)

BUSY_STATES = {"PREPARE", "RUNNING", "PAUSE", "SLICING", "INIT"}
LEFT_SOMETHING_ON_PLATE = {"FINISH", "FAILED"}


def _float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def loaded_material(report: dict[str, Any], manifest: dict[str, Any]) -> tuple[str | None, str]:
    """(material, where it came from). The printer's external-spool setting wins over the manifest."""
    tray = report.get("vt_tray") or {}
    if t := normalize_material(tray.get("tray_type")):
        return t, "printer"
    media = manifest.get("media_loaded") or {}
    return normalize_material(media.get("material")), "manifest"


def preflight(info: GcodeInfo, report: dict[str, Any], manifest: dict[str, Any], config: dict[str, Any], *,
              plate_clear: bool | None, quantity: int = 1) -> list[str]:
    """Every reason not to start this file on this printer right now. Empty list = go."""
    problems: list[str] = []
    want_model = config.get("printer_model", "Bambu Lab A1 mini")
    if info.printer_model != want_model:
        problems.append(f"wrong_printer: file was sliced for {info.printer_model or 'an unknown printer'}, "
                        f"this is a {want_model}")
    nozzle = _float(report.get("nozzle_diameter")) or _float(config.get("nozzle_diameter"))
    if nozzle and info.nozzle_diameter and abs(nozzle - info.nozzle_diameter) > 1e-3:
        problems.append(f"wrong_nozzle: file is for a {info.nozzle_diameter} mm nozzle, printer has {nozzle} mm")
    if quantity != 1:
        problems.append("quantity: one print per job; put copies on one plate when slicing")

    state = str(report.get("gcode_state") or "UNKNOWN").upper()
    if state in BUSY_STATES:
        problems.append(f"printer_busy: printer is {state}")
    elif state in LEFT_SOMETHING_ON_PLATE and plate_clear is not True:
        problems.append(f"plate_not_cleared: last print ended {state}; remove it, then pass "
                        "--plate-cleared (or send plate cleared from the hub)")
    elif plate_clear is False:
        problems.append("plate_not_cleared: remove the last print, then mark the plate cleared")
    if report.get("sdcard") is False:
        problems.append("no_sd_card: the A1 mini stores uploaded jobs on its microSD card")

    loaded, source = loaded_material(report, manifest)
    wanted = normalize_material(info.filament_type)
    if not config.get("allow_material_mismatch") and wanted and loaded and wanted != loaded:
        problems.append(f"wrong_material: file is sliced for {wanted}, {source} says {loaded} is loaded; "
                        "re-slice for the loaded filament or pass --allow-material-mismatch")
    if not wanted:
        problems.append("unknown_material: the file does not say which filament it was sliced for")

    remaining = (manifest.get("media_loaded") or {}).get("remaining_est")
    spare = float(config.get("min_spare_g", 2.0))
    if info.weight_g is not None and isinstance(remaining, (int, float)) and info.weight_g + spare > remaining:
        problems.append(f"out_of_media: needs {info.weight_g:.1f} g + {spare:.0f} g spare, "
                        f"{remaining} g left on the spool")

    max_min = (manifest.get("limits") or {}).get("max_job_minutes")
    if max_min and info.est_time_s and info.est_time_s / 60 > max_min:
        problems.append(f"too_long: about {info.est_time_s / 60:.0f} min exceeds {max_min} min")
    return problems


def file_kind(path: Path) -> str:
    """'3mf', 'gcode', 'stl' or 'unknown', from the name or, failing that, the first bytes."""
    name = path.name.lower()
    for suffix, kind in ((".3mf", "3mf"), (".gcode", "gcode"), (".stl", "stl")):
        if name.endswith(suffix):
            return kind
    with path.open("rb") as f:
        head = f.read(84)
    size = path.stat().st_size
    if head.startswith(b"PK\x03\x04"):
        return "3mf"
    if head.lstrip().startswith(b";"):
        return "gcode"
    if head.lstrip().startswith(b"solid") or (len(head) == 84 and size == 84 + 50 * struct.unpack("<I", head[80:84])[0]):
        return "stl"
    return "unknown"


def remote_name_for(job: Job) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", f"{job.job_id}")[:48]
    return f"fabyn_{safe}.gcode.3mf"


class BambuA1Mini(Adapter):
    process = "fdm_print"

    def __init__(self, manifest: dict[str, Any], config: dict[str, Any]):
        super().__init__(manifest, config)
        self.plate = int(config.get("plate", 1))
        self.start_timeout_s = float(config.get("start_timeout_s", 120))
        self.quiet_refresh_s = float(config.get("quiet_refresh_s", 20))
        # None = unknown: fine if the printer is IDLE, refused if it says FINISH/FAILED.
        self._plate_clear: bool | None = True if config.get("plate_clear_at_start") else None
        self._state = "idle"
        self._detail: str | None = None
        self._cancel: set[str] = set()
        self._info: dict[Path, GcodeInfo] = {}
        self._last_report: dict[str, Any] = {}

    def _transport(self) -> Transport:
        def dry_state() -> dict[str, Any]:
            media = self.manifest.get("media_loaded") or {}
            return {"gcode_state": self.config.get("dry_run_state", "IDLE"), "sdcard": True,
                    "nozzle_diameter": str(self.config.get("nozzle_diameter", 0.4)),
                    "vt_tray": {"tray_type": media.get("material", ""), "tray_color": "FFFFFFFF"},
                    "mc_percent": 0, "print_error": 0}
        return make_transport(self.config, dry_run_state=dry_state)

    async def prepare(self, job: Job, asset_path: Path) -> Path:
        def work() -> tuple[Path, GcodeInfo]:
            kind = file_kind(asset_path)
            gcode = None
            if kind == "3mf":
                plates = plates_in_3mf(asset_path)
                if self.plate in plates:
                    info = inspect_gcode(read_3mf_gcode(asset_path, self.plate).decode("utf-8", "replace"))
                    return asset_path, info
                if plates:
                    raise AdapterError(f"{asset_path.name} has no sliced plate {self.plate} (plates: {plates})")
            if kind in ("3mf", "stl"):
                # An unsliced model: slice it here with the printer's own profile.
                model = asset_path.with_name(f"{job.job_id}_model.{kind}")
                if model != asset_path:
                    shutil.copyfile(asset_path, model)
                gcode = slice_model(model, asset_path.with_name(f"{job.job_id}_slice"), self.config)
                log.info("sliced %s with Bambu Studio -> %s", job.job_id, gcode)
            elif kind == "gcode":
                gcode = asset_path
            if gcode is None:
                raise AdapterError(f"{asset_path.name}: send a .gcode, .gcode.3mf, or a .3mf/.stl model to slice")
            raw = gcode.read_bytes()
            info = inspect_gcode(raw.decode("utf-8", "replace"))
            native = asset_path.with_name(f"{job.job_id}.gcode.3mf")
            native.write_bytes(build_gcode_3mf(raw, info, self.plate))
            return native, info

        native, info = await asyncio.to_thread(work)
        self._info[native] = info
        log.info("prepared %s: %s, %s, %.2f g, ~%s s -> %s", job.job_id, info.printer_model,
                 info.filament_type, info.weight_g or 0, info.est_time_s, native.name)
        return native

    def info_for(self, native_path: Path) -> GcodeInfo:
        if native_path not in self._info:
            self._info[native_path] = inspect_gcode(read_3mf_gcode(native_path, self.plate).decode("utf-8", "replace"))
        return self._info[native_path]

    async def run(self, job: Job, native_path: Path) -> AsyncIterator[Progress]:
        info = self.info_for(native_path)
        est = info.est_time_s or int((self.manifest.get("time_model") or {}).get("per_unit_s", 900))
        self._state, self._detail = "busy", None
        self._cancel.discard(job.job_id)
        transport = self._transport()
        try:
            yield Progress("running", 0.0, eta_s=est, message="connecting to printer")
            await transport.connect()
            try:
                report = await transport.refresh()
                self._last_report = report
                problems = preflight(info, report, self.manifest, self.config,
                                     plate_clear=self._plate_clear, quantity=job.quantity)
                if problems:
                    raise AdapterError("; ".join(problems))
                if job.job_id in self._cancel:
                    raise AdapterError("cancelled")

                remote = remote_name_for(job)
                yield Progress("running", 0.01, eta_s=est, message=f"uploading {remote}")
                reply = await transport.upload(native_path, remote)
                log.info("uploaded %s (%s)", remote, reply)

                task = Path(remote).name.removesuffix(".gcode.3mf")
                transport.reports.command_results.pop("project_file", None)
                await transport.publish(project_file_cmd(
                    remote, task, plate=self.plate,
                    url_template=self.config.get("url_template", "file:///sdcard/{name}"),
                    bed_leveling=bool(self.config.get("bed_leveling", True)),
                    flow_cali=bool(self.config.get("flow_cali", False)),
                    vibration_cali=bool(self.config.get("vibration_cali", False)),
                    timelapse=bool(self.config.get("timelapse", False)),
                ))
                self._plate_clear = False  # from here on, assume something may be on the plate
                yield Progress("running", 0.05, eta_s=est, message="print command sent")
                async for p in self._follow(transport, job, task, est):
                    yield p
            finally:
                await transport.close()

            media = self.manifest.get("media_loaded") or {}
            if info.weight_g and isinstance(media.get("remaining_est"), (int, float)):
                media["remaining_est"] = round(max(0.0, media["remaining_est"] - info.weight_g), 2)
            yield Progress("running", 1.0, eta_s=0, message="printed; remove it from the plate")
            self._state = "error"
            self._detail = "plate_not_cleared: remove the print, then mark the plate cleared"
        except AdapterError as e:
            self._state = "idle" if str(e) == "cancelled" or str(e).startswith(_REFUSALS) else "error"
            self._detail = str(e)
            raise
        except Exception as e:
            self._state, self._detail = "error", str(e)
            raise AdapterError(str(e)) from e
        finally:
            self._cancel.discard(job.job_id)

    async def _follow(self, transport: Transport, job: Job, task: str, est: int) -> AsyncIterator[Progress]:
        """Wait for the printer to pick up our job, then report until FINISH or FAILED."""
        sent_at = time.monotonic()
        deadline = sent_at + est * 2 + 900
        started = False
        last_pct, last_state = -1, None
        while True:
            if job.job_id in self._cancel:
                await transport.publish(stop_cmd())
                raise AdapterError("cancelled")
            if time.monotonic() > deadline:
                await transport.publish(stop_cmd())
                raise AdapterError("print took more than twice its estimate; stop sent, check the printer")
            if not await transport.wait_report(self.quiet_refresh_s):
                try:
                    await transport.refresh()
                except AdapterError:  # the print carries on without us; keep listening
                    log.warning("no status from printer for %.0f s; still waiting", self.quiet_refresh_s + 10)
                    continue
            r = transport.report()
            self._last_report = r

            reply = transport.reports.command_results.get("project_file")
            if reply and str(reply.get("result", "")).lower() not in ("", "success", "ok"):
                raise AdapterError(f"printer refused the print: {reply.get('reason') or reply.get('result')} "
                                   f"(err {reply.get('err_code', '?')}). Is Developer Mode on?")

            state = str(r.get("gcode_state") or "").upper()
            name = str(r.get("subtask_name") or "")
            ours = name == task or task in str(r.get("gcode_file") or "")
            if not started:
                if state in ("PREPARE", "RUNNING") and (ours or not name):
                    started = True
                    log.info("printer started %s", task)
                elif time.monotonic() - sent_at > self.start_timeout_s:
                    raise AdapterError(f"printer did not start the job within {self.start_timeout_s:.0f} s "
                                       f"(state {state or '?'}); check Developer Mode and the printer screen")
                continue
            if state == "FINISH":
                return
            if state == "FAILED":
                raise AdapterError(f"printer reports the print FAILED (print_error {r.get('print_error')}, "
                                   f"hms {r.get('hms') or []})")
            pct = int(r.get("mc_percent") or 0)
            if pct != last_pct or state != last_state:
                last_pct, last_state = pct, state
                remaining = r.get("mc_remaining_time")
                eta = int(remaining) * 60 if isinstance(remaining, (int, float)) else None
                layer = f" layer {r.get('layer_num')}/{r.get('total_layer_num')}" if r.get("total_layer_num") else ""
                msg = f"{state.lower()} {pct}%{layer}"
                if state == "PAUSE":
                    msg += f" (print_error {r.get('print_error')}; needs someone at the printer)"
                yield Progress("running", round(0.05 + 0.85 * pct / 100, 3), eta_s=eta, message=msg)

    async def status(self) -> dict[str, Any]:
        r = self._last_report
        return {"state": self._state, "media": self.manifest.get("media_loaded"), "detail": self._detail,
                "printer_state": r.get("gcode_state"), "loaded_material": loaded_material(r, self.manifest)[0]}

    async def cancel(self, job_id: str) -> None:
        # run() sends "stop" at its next report (within quiet_refresh_s). The part stays on the plate.
        self._cancel.add(job_id)

    async def probe(self) -> None:
        transport = self._transport()
        await transport.connect()
        try:
            self._last_report = await transport.refresh()
        finally:
            await transport.close()
        # A part from an earlier print may still be on the plate: say so before any job arrives.
        state = str(self._last_report.get("gcode_state") or "").upper()
        if state in LEFT_SOMETHING_ON_PLATE and self._plate_clear is not True:
            self._state = "error"
            self._detail = (f"plate_not_cleared: the printer's last print ended {state}; remove it, "
                            "then mark the plate cleared")

    def plate_cleared(self) -> None:
        """A person removed the last print."""
        self._plate_clear = True
        if self._detail and self._detail.startswith("plate_not_cleared"):
            self._state, self._detail = "idle", None

    def clear_error(self) -> None:
        """The printer answers again after a job could not reach it. Nothing was uploaded, so
        this says nothing about the plate: what we knew about it before still stands."""
        self._state, self._detail = "idle", None


# Pre-flight refusals leave the machine usable; they are about the job, not a fault.
_REFUSALS = ("wrong_printer", "wrong_nozzle", "quantity", "wrong_material", "unknown_material",
             "out_of_media", "too_long", "printer_busy")
