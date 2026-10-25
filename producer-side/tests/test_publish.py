"""hub/publish.py: what reaches Convex, how fast, and in what shape. No network."""
import asyncio
import json

import httpx

from hub.publish import ConvexPublisher, convex_url, public_view

JOB = {
    "job_id": "job_dev_0001",
    "machine_id": "m_sticker_01",
    "asset_url": "http://127.0.0.1:4318/assets/x?token=SIGNED",
    "preview_url": "http://127.0.0.1:4318/assets/p?token=SIGNED",
    "params": {"fabrary_job_id": "job_ours", "sha256": "abc", "width_mm": 48},
}


def test_signed_links_and_adapter_config_never_leave_the_hub():
    job = public_view("job.updated", {**JOB, "state": "running", "progress": 0.4})
    assert "SIGNED" not in json.dumps(job)
    assert job["params"] == {"fabrary_job_id": "job_ours"}
    machine = public_view("machine.online", {"machine_id": "m", "status": "idle", "adapter": {"ble_address": "x"}})
    assert machine == {"machine_id": "m", "status": "idle"}


def test_progress_is_held_to_one_every_two_seconds_and_a_state_change_supersedes_it():
    p = ConvexPublisher("http://convex", "s", client=httpx.AsyncClient())
    for progress in (0.1, 0.2, 0.3):
        p.handle("job.updated", {**JOB, "state": "running", "progress": progress})
    assert [e["data"]["progress"] for e in p.queue] == [0.1]
    assert p.held["job_dev_0001"]["data"]["progress"] == 0.3
    p.handle("job.updated", {**JOB, "state": "done", "progress": 1.0})
    assert p.held == {}
    assert [e["data"]["state"] for e in p.queue] == ["running", "done"]


def test_flush_sends_one_publish_batch_and_keeps_events_after_a_failure():
    calls = []
    status = {"ok": False}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        if not status["ok"]:
            return httpx.Response(500, json={"status": "error", "errorMessage": "down"})
        return httpx.Response(200, json={"status": "success", "value": 1})

    async def run():
        p = ConvexPublisher("http://convex/", "secret", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        p.handle("machine.online", {"machine_id": "m_sticker_01", "status": "idle"})
        assert await p.flush() is False
        assert len(p.queue) == 1
        status["ok"] = True
        assert await p.flush() is True
        assert p.queue == []
        await p.aclose()

    asyncio.run(run())
    body = calls[-1]
    assert body["path"] == "publish:batch"
    assert body["args"]["source"] == "producer"
    assert body["args"]["secret"] == "secret"
    assert body["args"]["events"][0]["type"] == "machine.online"


def test_deployment_url_from_env():
    assert convex_url({"CONVEX_URL": "http://127.0.0.1:3210"}) == "http://127.0.0.1:3210"
    assert convex_url({"CONVEX_DEPLOY_KEY": "dev:happy-animal-123|eyJ2"}) == "https://happy-animal-123.convex.cloud"
    assert convex_url({"CONVEX_DEPLOY_KEY": "eyJ2"}) is None
