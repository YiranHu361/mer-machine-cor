import json
from datetime import datetime
from pathlib import Path

from node import policy
from node.protocol import Job

MANIFEST = json.loads((Path(__file__).parents[1] / "node/machines/m_sticker_01.json").read_text())


def job(**kw):
    base = dict(job_id="job_1", order_id="ord_1", item_id="it_1", machine_id="m_sticker_01",
                process="sticker_print", quantity=1, asset_url="/assets/x.png")
    return Job(**{**base, **kw})


def check(j, **kw):
    args = dict(machine_state="idle", queued=0, max_queue=3, now=datetime(2026, 10, 24, 12, 0))
    return policy.check(j, MANIFEST, **{**args, **kw})


def test_accepts_normal_job():
    assert check(job()) is None


def test_rejects():
    assert check(job(process="fdm_print")).startswith("wrong_process")
    assert check(job(machine_id="m_other")).startswith("wrong_machine")
    assert check(job(), queued=3).startswith("busy")
    assert check(job(), machine_state="error") == "machine_error"
    assert check(job(params={"width_mm": 60, "height_mm": 30})).startswith("too_large")
    assert check(job(quantity=500)).startswith("too_long")


def test_hours_window_wraps_midnight():
    m = {**MANIFEST, "limits": {**MANIFEST["limits"], "hours": "22:00-06:00"}}
    assert policy.check(job(), m, machine_state="idle", queued=0, max_queue=3,
                        now=datetime(2026, 10, 24, 23, 30)) is None
    assert policy.check(job(), m, machine_state="idle", queued=0, max_queue=3,
                        now=datetime(2026, 10, 24, 12, 0)).startswith("outside_hours")
