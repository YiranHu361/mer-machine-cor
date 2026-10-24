"""Bambu A1 mini: G-code inspection, 3MF wrapping, pre-flight, and the adapter on the dry-run transport."""
import asyncio
import json
import zipfile
from pathlib import Path

import pytest

from node.adapters import AdapterError, make_adapter
from node.adapters.bambu.adapter import preflight
from node.adapters.bambu.gcode import (GcodeInfo, build_gcode_3mf, inspect_gcode, parse_duration,
                                       read_3mf_gcode)
from node.adapters.bambu.transport import cn_from_der
from node.protocol import Job

ROOT = Path(__file__).parents[1]

GCODE = """; HEADER_BLOCK_START
; BambuStudio 02.08.02.60
; model printing time: 5m 54s; total estimated time: 12m 5s
; total layer number: 15
; total filament weight [g] : 1.84
; max_z_height: 3.00
; filament: 3
; HEADER_BLOCK_END

; CONFIG_BLOCK_START
; curr_bed_type = Textured PEI Plate
; filament_colour = #000000;#C1C1C1;#FFFFFF
; filament_type = PETG-CF;PETG;PLA
; nozzle_diameter = 0.4
; nozzle_temperature = 255,245,220
; printer_model = Bambu Lab A1 mini
; CONFIG_BLOCK_END

; EXECUTABLE_BLOCK_START
M1002 set_filament_type:PLA
M140 S65
M104 S220
G1 X10 Y10
"""


def manifest(**adapter):
    m = json.loads((ROOT / "node/machines/m_fdm_01.json").read_text())
    m["adapter"].update(transport="file", dry_run_step_s=0, **adapter)
    return m


def idle(**kw):
    return {"gcode_state": "IDLE", "nozzle_diameter": "0.4", "sdcard": True, "vt_tray": {"tray_type": "PLA"}, **kw}


def test_parse_duration():
    assert parse_duration("12m 5s") == 725
    assert parse_duration("1d 2h 3m 4s") == 93784
    assert parse_duration("soon") is None


def test_inspect_reads_the_used_filament():
    info = inspect_gcode(GCODE)
    assert info.printer_model == "Bambu Lab A1 mini"
    assert info.nozzle_diameter == 0.4
    assert info.filament_type == "PLA" and info.filament_types_used == ["PLA"]
    assert info.filament_color == "#FFFFFF"
    assert info.nozzle_temp_c == 220 and info.bed_temp_c == 65
    assert info.weight_g == 1.84 and info.est_time_s == 725 and info.layers == 15


@pytest.mark.skipif(not (ROOT / "samples/yiran_PLA_11m11s.gcode").exists(), reason="sample file not present")
def test_inspect_real_sample():
    info = inspect_gcode((ROOT / "samples/yiran_PLA_11m11s.gcode").read_text())
    assert (info.filament_type, info.nozzle_temp_c, info.weight_g) == ("PLA", 220, 1.91)


def test_3mf_wraps_gcode_byte_for_byte(tmp_path):
    raw = GCODE.encode()
    path = tmp_path / "x.gcode.3mf"
    path.write_bytes(build_gcode_3mf(raw, inspect_gcode(GCODE)))
    assert read_3mf_gcode(path) == raw
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        assert {"[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model", "Metadata/plate_1.gcode",
                "Metadata/plate_1.gcode.md5", "Metadata/slice_info.config"} <= names
        import hashlib
        assert z.read("Metadata/plate_1.gcode.md5").decode() == hashlib.md5(raw).hexdigest().upper()


def test_preflight_ok_and_each_refusal():
    m = manifest()
    info = inspect_gcode(GCODE)
    cfg = m["adapter"]
    assert preflight(info, idle(), m, cfg, plate_clear=None) == []

    def reasons(report, **kw):
        return [p.split(":")[0] for p in preflight(kw.pop("info", info), report, m, cfg, **{"plate_clear": None, **kw})]

    assert reasons(idle(gcode_state="RUNNING")) == ["printer_busy"]
    assert reasons(idle(gcode_state="FINISH")) == ["plate_not_cleared"]
    assert reasons(idle(gcode_state="FINISH"), plate_clear=True) == []
    assert reasons(idle(), plate_clear=False) == ["plate_not_cleared"]
    assert reasons(idle(sdcard=False)) == ["no_sd_card"]
    assert reasons(idle(vt_tray={"tray_type": "PETG"})) == ["wrong_material"]
    assert reasons(idle(nozzle_diameter="0.2")) == ["wrong_nozzle"]
    assert reasons(idle(), info=GcodeInfo(printer_model="Bambu Lab X1 Carbon", filament_type="PLA")) == ["wrong_printer"]
    heavy = inspect_gcode(GCODE.replace("[g] : 1.84", "[g] : 14.5"))
    assert reasons(idle(), info=heavy) == ["out_of_media"]
    # The printer's spool setting wins; with none set, the manifest's material is used.
    assert reasons(idle(vt_tray={"tray_type": ""})) == []


def test_preflight_mismatch_can_be_allowed():
    m = manifest(allow_material_mismatch=True)
    assert preflight(inspect_gcode(GCODE), idle(vt_tray={"tray_type": "PETG"}), m, m["adapter"], plate_clear=None) == []


def test_cn_from_der():
    # issuer CN then subject CN, as in a real certificate
    der = b"\x30\x00" + b"\x55\x04\x03\x0c\x07BBL CA2" + b"\x00" + b"\x55\x04\x03\x13\x0f0309DA123456789"
    assert cn_from_der(der) == "0309DA123456789"


def _job(job_id="job_1", quantity=1):
    return Job(job_id=job_id, order_id="o", item_id="i", machine_id="m_fdm_01", process="fdm_print", quantity=quantity)


def test_adapter_dry_run_prints_then_blocks_until_plate_cleared(tmp_path):
    async def go():
        m = manifest(out_dir=str(tmp_path / "sd"))
        adapter = make_adapter(m)
        src = tmp_path / "part.gcode"
        src.write_text(GCODE)
        native = await adapter.prepare(_job(), src)
        assert native.name == "job_1.gcode.3mf"
        steps = [p async for p in adapter.run(_job(), native)]
        assert steps[-1].progress == 1.0
        assert all(0 <= p.progress <= 0.9 for p in steps[:-1])
        assert (tmp_path / "sd/fabrary_job_1.gcode.3mf").exists()
        assert m["media_loaded"]["remaining_est"] == pytest.approx(15 - 1.84)
        st = await adapter.status()
        assert st["state"] == "error" and st["detail"].startswith("plate_not_cleared")

        with pytest.raises(AdapterError, match="plate_not_cleared"):
            async for _ in adapter.run(_job("job_2"), native):
                pass
        adapter.plate_cleared()
        assert (await adapter.status())["state"] == "idle"
        assert [p async for p in adapter.run(_job("job_3"), native)][-1].progress == 1.0

    asyncio.run(go())


def test_adapter_refuses_wrong_material_without_uploading(tmp_path):
    async def go():
        m = manifest(out_dir=str(tmp_path / "sd"))
        m["media_loaded"]["material"] = "PETG"
        adapter = make_adapter(m)
        src = tmp_path / "part.gcode"
        src.write_text(GCODE)
        native = await adapter.prepare(_job(), src)
        with pytest.raises(AdapterError, match="wrong_material"):
            async for _ in adapter.run(_job(), native):
                pass
        assert not (tmp_path / "sd/fabrary_job_1.gcode.3mf").exists()
        assert (await adapter.status())["state"] == "idle"  # a refusal is not a machine fault

    asyncio.run(go())


def test_prepare_rejects_stl(tmp_path):
    adapter = make_adapter(manifest())
    stl = tmp_path / "part.stl"
    stl.write_text("solid x\nendsolid x\n")
    with pytest.raises(AdapterError, match="sliced"):
        asyncio.run(adapter.prepare(_job(), stl))
