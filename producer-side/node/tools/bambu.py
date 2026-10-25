"""Bambu A1 mini from the command line: find it, read its status, print a sliced file, stop.

  python -m node.tools.bambu discover                       # listen for printers on this network
  python -m node.tools.bambu status                         # state, filament, temps, SD card
  python -m node.tools.bambu inspect part.gcode             # what the file needs; no printer
  python -m node.tools.bambu print part.gcode               # upload, start, follow to FINISH
  python -m node.tools.bambu print part.gcode --dry-run     # same flow against a fake printer
  python -m node.tools.bambu stop

The LAN access code comes from $BAMBU_ACCESS_CODE and the printer's IP from $BAMBU_HOST (or
producer-side/.env), else the manifest. --machine picks the manifest (default
node/machines/m_fdm_01.json); --host / --serial override both.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

from ..adapters import AdapterError, make_adapter
from ..env import load_dotenv
from ..adapters.bambu.adapter import loaded_material, preflight
from ..adapters.bambu.gcode import inspect_gcode, read_3mf_gcode
from ..adapters.bambu.transport import discover, make_transport, stop_cmd, version_cmd
from ..protocol import Job

ROOT = Path(__file__).parents[2]
DEFAULT_MACHINE = ROOT / "node/machines/m_fdm_01.json"


def load_manifest(a: argparse.Namespace) -> dict:
    manifest = json.loads(a.machine.read_text())
    cfg = manifest["adapter"]
    if a.host:
        cfg["host"], cfg["host_env"] = a.host, ""  # --host wins over $BAMBU_HOST
    if a.serial:
        cfg["serial"] = a.serial
    if getattr(a, "dry_run", False):
        cfg["transport"] = "file"
        cfg.setdefault("out_dir", str(ROOT / ".work/bambu_dry_run"))
    return manifest


def file_info(path: Path):
    if path.name.lower().endswith(".3mf"):
        return inspect_gcode(read_3mf_gcode(path).decode("utf-8", "replace"))
    return inspect_gcode(path.read_text(errors="replace"))


async def cmd_status(a: argparse.Namespace) -> int:
    manifest = load_manifest(a)
    t = make_transport(manifest["adapter"], dry_run_state=dict)
    await t.connect()
    try:
        r = await t.refresh()
        await t.publish(version_cmd())
        await t.wait_report(3)
        modules = t.reports.info.get("module") or []
    finally:
        await t.close()
    if a.json:
        print(json.dumps(r, indent=2))
        return 0
    tray = r.get("vt_tray") or {}
    fw = next((m.get("sw_ver") for m in modules if m.get("name") == "ota"), None)
    rows = [
        ("printer", f"{t.host}  serial {t.serial}" + (f"  firmware {fw}" if fw else "")),
        ("state", f"{r.get('gcode_state')}  {r.get('mc_percent', 0)}%  "
                  f"remaining {r.get('mc_remaining_time', '?')} min  job {r.get('subtask_name') or '-'}"),
        ("filament", f"{tray.get('tray_type') or 'not set on printer'}  color #{(tray.get('tray_color') or '')[:6]}"
                     f"  (manifest: {(manifest.get('media_loaded') or {}).get('material')})"),
        ("nozzle", f"{r.get('nozzle_temper')} / {r.get('nozzle_target_temper')} C  "
                   f"{r.get('nozzle_diameter', '?')} mm {r.get('nozzle_type', '')}"),
        ("bed", f"{r.get('bed_temper')} / {r.get('bed_target_temper')} C"),
        ("sd card", str(r.get("sdcard", "unknown"))),
        ("errors", f"print_error {r.get('print_error', 0)}  hms {r.get('hms') or []}"),
        ("wifi", str(r.get("wifi_signal", "?"))),
    ]
    for k, v in rows:
        print(f"{k:>9}  {v}")
    return 0


def cmd_inspect(a: argparse.Namespace) -> int:
    manifest = load_manifest(a)
    info = file_info(a.file)
    for k, v in info.as_dict().items():
        print(f"{k:>20}  {v}")
    # The printer's live state is unknown here; check everything that depends only on file + manifest.
    report = {"gcode_state": "IDLE", "nozzle_diameter": manifest["adapter"].get("nozzle_diameter")}
    problems = preflight(info, report, manifest, manifest["adapter"], plate_clear=True)
    loaded, _ = loaded_material({}, manifest)
    print(f"\nmanifest says {loaded} is loaded, "
          f"{(manifest.get('media_loaded') or {}).get('remaining_est')} g left")
    if problems:
        print("would refuse:\n  " + "\n  ".join(problems))
        return 1
    print("ok to print (printer state is checked at print time)")
    return 0


async def cmd_print(a: argparse.Namespace) -> int:
    manifest = load_manifest(a)
    cfg = manifest["adapter"]
    if a.plate_cleared:
        cfg["plate_clear_at_start"] = True
    if a.allow_material_mismatch:
        cfg["allow_material_mismatch"] = True
    if a.filament_g is not None:
        manifest["media_loaded"]["remaining_est"] = a.filament_g
    adapter = make_adapter(manifest)

    work = ROOT / ".work" / manifest["machine_id"] / "cli"
    work.mkdir(parents=True, exist_ok=True)
    src = work / a.file.name
    src.write_bytes(a.file.read_bytes())
    job_id = a.job_id or "cli_" + "".join(c if c.isalnum() else "_" for c in a.file.stem)[:32]
    job = Job(job_id=job_id, order_id="ord_cli", item_id="it_cli", machine_id=manifest["machine_id"],
              process=manifest["process"], quantity=1)
    native = await adapter.prepare(job, src)
    info = adapter.info_for(native)
    print(f"file      {a.file.name}: {info.filament_type}, {info.weight_g} g, ~{(info.est_time_s or 0) // 60} min, "
          f"sliced for {info.printer_model} {info.nozzle_diameter} mm")
    print(f"prepared  {native}")
    try:
        async for p in adapter.run(job, native):
            eta = f" eta {p.eta_s // 60}m{p.eta_s % 60:02d}s" if p.eta_s is not None else ""
            print(f"  {p.progress:5.0%}{eta}  {p.message or ''}", flush=True)
    except AdapterError as e:
        print(f"REFUSED/FAILED: {e}", file=sys.stderr)
        return 2
    left = manifest["media_loaded"].get("remaining_est")
    print(f"done. about {left} g of filament left; update media_loaded.remaining_est in the manifest.")
    return 0


async def cmd_stop(a: argparse.Namespace) -> int:
    manifest = load_manifest(a)
    t = make_transport(manifest["adapter"], dry_run_state=dict)
    await t.connect()
    try:
        await t.publish(stop_cmd())
    finally:
        await t.close()
    print("stop sent")
    return 0


def main() -> None:
    load_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--machine", type=Path, default=DEFAULT_MACHINE)
    ap.add_argument("--host", help="printer IP (overrides the manifest)")
    ap.add_argument("--serial", help="printer serial (default: read from its certificate)")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("discover", help="listen for Bambu printers' SSDP broadcasts")
    d.add_argument("--timeout", type=float, default=10)
    s = sub.add_parser("status", help="print the printer's live state")
    s.add_argument("--json", action="store_true", help="the raw merged MQTT report")
    i = sub.add_parser("inspect", help="read a .gcode/.gcode.3mf and check it against the manifest")
    i.add_argument("file", type=Path)
    p = sub.add_parser("print", help="upload a sliced file and print it, following progress to the end")
    p.add_argument("file", type=Path)
    p.add_argument("--plate-cleared", action="store_true",
                   help="the build plate is empty (needed when the printer still shows the last print as FINISH)")
    p.add_argument("--allow-material-mismatch", action="store_true",
                   help="print even though the file was sliced for a different filament type")
    p.add_argument("--filament-g", type=float, help="grams left on the spool (overrides the manifest)")
    p.add_argument("--job-id", help="names the file on the SD card (default: from the file name)")
    p.add_argument("--dry-run", action="store_true", help="fake printer; nothing leaves this machine")
    sub.add_parser("stop", help="stop the current print")
    a = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(levelname).1s %(name)s: %(message)s")

    if a.cmd == "discover":
        found = discover(a.timeout)
        for f in found:
            print(f"{f['ip']:<16} {f['serial']}  model {f['model']}  name {f['name']!r}  signal {f['signal']}")
        if not found:
            print(f"no Bambu printer announced itself in {a.timeout:.0f} s "
                  "(is this computer on the printer's network?)")
        raise SystemExit(0 if found else 1)
    try:
        if a.cmd == "inspect":
            code = cmd_inspect(a)
        else:
            code = asyncio.run({"status": cmd_status, "print": cmd_print, "stop": cmd_stop}[a.cmd](a))
    except AdapterError as e:
        print(f"error: {e}", file=sys.stderr)
        code = 2
    except KeyboardInterrupt:
        print("\ninterrupted. If a print was started it keeps going; use `stop` to stop it.", file=sys.stderr)
        code = 130
    raise SystemExit(code)


if __name__ == "__main__":
    main()
