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
        app = create_app()
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
                return [e for e in evs if e["data"].get("job_id") == job_id and e["data"].get("state") == "done"
                        and e["type"] == "job.done"] and evs
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


def test_a1_mini_waits_for_the_plate_then_takes_the_next_job(tmp_path):
    """Stub hub + real NodeClient + A1 mini adapter on the dry-run transport, with a sliced file."""
    from tests.test_bambu import GCODE

    async def go():
        port = free_port()
        app = create_app()
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
        server_task = asyncio.create_task(server.serve())
        await wait_for(lambda: asyncio.sleep(0, server.started))

        manifest = json.loads((ROOT / "node/machines/m_fdm_01.json").read_text())
        manifest["adapter"].update(transport="file", out_dir=str(tmp_path / "sd"), dry_run_step_s=0)
        part = tmp_path / "asset_part"  # no extension, like the app's signed asset links
        part.write_text(GCODE)
        hub = f"http://127.0.0.1:{port}"
        node = NodeClient(manifest, hub, tmp_path / "work")
        node_task = asyncio.create_task(node.run())

        async with httpx.AsyncClient(base_url=hub) as http:
            async def machine():
                ms = (await http.get("/machines")).json()
                return ms[0] if ms and ms[0]["status"] != "offline" else None

            async def offer() -> str:
                r = await http.post("/dev/offer", json={"machine_id": "m_fdm_01", "asset_url": f"file://{part}"})
                return r.json()["job_id"]

            async def state_of(job_id, want):
                async def check():
                    evs = (await http.get("/dev/events", params={"limit": 500})).json()
                    return any(e["data"].get("job_id") == job_id and e["data"].get("state") == want for e in evs)
                await wait_for(check)

            await wait_for(machine)
            first = await offer()
            await state_of(first, "done")
            await wait_for(lambda: _status(machine, "error"))
            assert (await machine())["detail"].startswith("plate_not_cleared")

            second = await offer()
            await state_of(second, "rejected")  # nothing goes onto an occupied plate

            assert (await http.post("/dev/plate-cleared", json={"machine_id": "m_fdm_01"})).status_code == 200
            await wait_for(lambda: _status(machine, "idle"), timeout=2)  # reported at once, not at the next heartbeat
            third = await offer()
            await state_of(third, "done")
            assert (await http.post("/dev/plate-cleared", json={"machine_id": "m_nope"})).status_code == 409

        assert len(list((tmp_path / "sd").glob("fabyn_*.gcode.3mf"))) == 2
        node_task.cancel()
        server.should_exit = True
        await asyncio.gather(node_task, server_task, return_exceptions=True)

    asyncio.run(go())


async def _status(machine, want):
    m = await machine()
    return m and m["status"] == want


def test_check_connects_to_the_machine_and_reports_back(tmp_path):
    async def go():
        port = free_port()
        app = create_app()
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


def test_a1_mini_takes_jobs_again_once_it_answers_after_being_out_of_reach(tmp_path):
    manifest = json.loads((ROOT / "node/machines/m_fdm_01.json").read_text())
    manifest["adapter"].update(transport="file", out_dir=str(tmp_path / "sd"))
    node = NodeClient(manifest, "http://127.0.0.1:1", tmp_path / "work")
    for unreachable in ("cannot reach printer MQTT at 172.20.10.8:8883 (timed out); same network? LAN mode on?",
                        "MQTT connect timed out"):
        node.adapter._state, node.adapter._detail = "error", unreachable
        asyncio.run(node._on_check({"check_id": "c"}))
        assert asyncio.run(node.adapter.status())["state"] == "idle"
    # Nothing reached the printer, so the plate is still unknown, not cleared.
    assert node.adapter._plate_clear is None
