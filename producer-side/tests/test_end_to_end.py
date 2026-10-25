"""Stub hub + real NodeClient + Phomemo adapter on the file transport (no printer)."""
import asyncio
import json
import socket
from pathlib import Path

import httpx
import uvicorn

from hub.dev_server import create_app
from node.client import NodeClient

ROOT = Path(__file__).parents[1]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def wait_for(pred, timeout=15.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if (r := await pred()):
            return r
        await asyncio.sleep(0.1)
    raise TimeoutError


def test_offer_to_result(tmp_path):
    async def go():
        port = free_port()
        app = create_app(frames_dir=tmp_path / "frames")
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
        server_task = asyncio.create_task(server.serve())
        await wait_for(lambda: asyncio.sleep(0, server.started))

        manifest = json.loads((ROOT / "node/machines/m_sticker_01.json").read_text())
        manifest["adapter"].update(transport="file", out_dir=str(tmp_path / "printer_out"), settle_s=0)
        hub = f"http://127.0.0.1:{port}"
        node = NodeClient(manifest, hub, tmp_path / "work")
        node_task = asyncio.create_task(node.run())

        async with httpx.AsyncClient(base_url=hub) as http:
            async def online():
                ms = (await http.get("/machines")).json()
                return ms and ms[0]["status"] != "offline"
            await wait_for(online)

            # Policy rejection travels back as job.updated state=rejected.
            r = await http.post("/dev/offer", json={"machine_id": "m_sticker_01", "params": {"width_mm": 90}})
            bad_id = r.json()["job_id"]

            r = await http.post("/dev/offer", json={"machine_id": "m_sticker_01", "quantity": 2})
            job_id = r.json()["job_id"]

            async def finished():
                evs = (await http.get("/dev/events", params={"limit": 500})).json()
                return [e for e in evs if e["data"].get("job_id") == job_id and e["data"].get("state") == "verifying"
                        and e["type"] == "job.updated"] and evs
            events = await wait_for(finished)

        states = [e["data"].get("state") for e in events if e["data"].get("job_id") == job_id]
        assert states[:3] == ["offered", "accepted", "running"]
        assert "rejected" in [e["data"].get("state") for e in events if e["data"].get("job_id") == bad_id]

        printed = list((tmp_path / "printer_out").glob("*.bin"))
        assert len(printed) == 1 and printed[0].stat().st_size > 2 * 72 * 300  # two copies of a ~30 mm label
        assert manifest["media_loaded"]["remaining_est"] == 118

        node_task.cancel()
        server.should_exit = True
        await asyncio.gather(node_task, server_task, return_exceptions=True)

    asyncio.run(go())


def test_check_connects_to_the_machine_and_reports_back(tmp_path):
    async def go():
        port = free_port()
        app = create_app(frames_dir=tmp_path / "frames")
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
        server_task = asyncio.create_task(server.serve())
        await wait_for(lambda: asyncio.sleep(0, server.started))

        manifest = json.loads((ROOT / "node/machines/m_photo_01.json").read_text())
        manifest["adapter"].update(transport="file", out_dir=str(tmp_path / "printer_out"))
        hub = f"http://127.0.0.1:{port}"
        node = NodeClient(manifest, hub, tmp_path / "work")
        node_task = asyncio.create_task(node.run())

        async with httpx.AsyncClient(base_url=hub, timeout=30) as http:
            async def online():
                ms = (await http.get("/machines")).json()
                return ms and ms[0]["status"] != "offline"
            await wait_for(online)

            answered = (await http.post("/dev/check", json={"machine_id": "m_photo_01"})).json()
            assert answered == {"machine_id": "m_photo_01", "ok": True, "detail": "answered"}

            async def asleep():
                raise RuntimeError("INSTAX-71659090 not found; is it on and not connected to the phone app?")
            node.adapter.probe = asleep
            silent = (await http.post("/dev/check", json={"machine_id": "m_photo_01"})).json()
            assert silent["ok"] is False and "not found" in silent["detail"]
            # A failed check is an answer about the printer, not an error state for the node.
            assert (await http.get("/machines")).json()[0]["status"] == "idle"

            assert (await http.post("/dev/check", json={"machine_id": "nobody"})).status_code == 404

            # A job that failed only because the printer was out of reach: once a check
            # reaches it, the node is out of its error state and takes jobs again.
            del node.adapter.probe
            node.adapter._state, node.adapter._detail = "error", "INSTAX-71659090 not found; is it on?"
            assert (await http.post("/dev/check", json={"machine_id": "m_photo_01"})).json()["ok"] is True
            assert (await node.adapter.status())["state"] == "idle"
            # Any other error (here: no film) still waits for the owner.
            node.adapter._state, node.adapter._detail = "error", "out_of_media: the printer reports no film left"
            await http.post("/dev/check", json={"machine_id": "m_photo_01"})
            assert (await node.adapter.status())["state"] == "error"

        node_task.cancel()
        server.should_exit = True
        await asyncio.gather(node_task, server_task, return_exceptions=True)

    asyncio.run(go())
