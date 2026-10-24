"""Node loop (design doc, Producer side).

load manifest -> dial /ws/node, send hello -> heartbeat every 5 s -> on job.offer check
local policy, accept or reject -> download asset -> adapter.prepare -> adapter.run,
streaming job.progress -> capture a frame -> verify -> job.result.

Run:  python -m node.client --machine node/machines/m_sticker_01.json --hub http://localhost:8000
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import random
import shutil
from collections import deque
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from pydantic import ValidationError
from websockets.asyncio.client import ClientConnection, connect

from . import policy, verify
from .adapters import AdapterError, make_adapter
from .protocol import (
    HEARTBEAT,
    HEARTBEAT_INTERVAL_S,
    HELLO,
    JOB_ACCEPT,
    JOB_CANCEL,
    JOB_OFFER,
    JOB_PROGRESS,
    JOB_REJECT,
    JOB_RESULT,
    WELCOME,
    Job,
    envelope,
)

log = logging.getLogger("node")

# Keys in node/machines/<id>.json that configure this node only and never go to the hub.
LOCAL_KEYS = ("adapter", "camera")


class NodeClient:
    def __init__(self, manifest: dict[str, Any], hub_url: str, work_dir: Path, max_queue: int = 3):
        self.manifest = manifest
        self.machine_id: str = manifest["machine_id"]
        self.adapter = make_adapter(manifest)
        self.camera = manifest.get("camera")
        self.hub = hub_url.rstrip("/")
        u = urlparse(self.hub)
        self.ws_url = f"{'wss' if u.scheme == 'https' else 'ws'}://{u.netloc}{u.path}/ws/node"
        self.work_dir = work_dir / self.machine_id
        self.max_queue = max_queue

        self.queue: asyncio.Queue[Job] = asyncio.Queue()
        self.seen: set[str] = set()
        self.cancelled: set[str] = set()
        self.current: Job | None = None
        self.listed = False

        # Job messages survive reconnects; heartbeats don't need to.
        self._outbox: deque[dict[str, Any]] = deque()
        self._outbox_ready = asyncio.Event()
        self._ws: ClientConnection | None = None

    # ---- public manifest ---------------------------------------------------

    async def public_manifest(self) -> dict[str, Any]:
        m = {k: v for k, v in self.manifest.items() if k not in LOCAL_KEYS}
        m["status"] = await self._status()
        return m

    async def _status(self) -> str:
        st = (await self.adapter.status())["state"]
        if st == "error":
            return "error"
        return "busy" if self.current or not self.queue.empty() else "idle"

    # ---- sending -----------------------------------------------------------

    def send(self, type_: str, data: dict[str, Any]) -> None:
        self._outbox.append(envelope(type_, data))
        self._outbox_ready.set()

    async def _send_now(self, ws: ClientConnection, type_: str, data: dict[str, Any]) -> None:
        await ws.send(json.dumps(envelope(type_, data)))

    async def _writer(self, ws: ClientConnection) -> None:
        while True:
            while self._outbox:
                await ws.send(json.dumps(self._outbox[0]))
                self._outbox.popleft()  # only after a successful send
            self._outbox_ready.clear()
            await self._outbox_ready.wait()

    async def _heartbeat(self, ws: ClientConnection) -> None:
        while True:
            st = await self.adapter.status()
            await self._send_now(ws, HEARTBEAT, {
                "machine_id": self.machine_id,
                "status": await self._status(),
                "media_loaded": self.manifest.get("media_loaded"),
                "queue": self.queue.qsize(),
                "current_job": self.current.job_id if self.current else None,
                "detail": st.get("detail"),
                "battery_pct": st.get("battery_pct"),
            })
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)

    # ---- receiving ---------------------------------------------------------

    async def _reader(self, ws: ClientConnection) -> None:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                log.warning("hub sent non-JSON: %r", raw[:200])
                continue
            type_, data = msg.get("type"), msg.get("data") or {}
            if type_ == JOB_OFFER:
                await self._on_offer(data)
            elif type_ == JOB_CANCEL:
                await self._on_cancel(data)
            elif type_ == WELCOME:
                pass
            else:
                log.debug("ignoring %s", type_)

    async def _on_offer(self, data: dict[str, Any]) -> None:
        try:
            job = Job.model_validate(data)
        except ValidationError as e:
            job_id = data.get("job_id", "unknown")
            log.warning("invalid job %s: %s", job_id, e)
            self.send(JOB_REJECT, {"job_id": job_id, "reason": "invalid_job"})
            return
        if job.job_id in self.seen:
            log.info("duplicate offer %s ignored", job.job_id)
            return
        reason = policy.check(
            job,
            self.manifest,
            machine_state=(await self.adapter.status())["state"],
            queued=self.queue.qsize() + (1 if self.current else 0),
            max_queue=self.max_queue,
        )
        if reason:
            log.info("reject %s: %s", job.job_id, reason)
            self.send(JOB_REJECT, {"job_id": job.job_id, "reason": reason})
            return
        self.seen.add(job.job_id)
        await self.queue.put(job)
        log.info("accept %s (%s x%d)", job.job_id, job.item_id, job.quantity)
        self.send(JOB_ACCEPT, {"job_id": job.job_id, "reason": None})

    async def _on_cancel(self, data: dict[str, Any]) -> None:
        job_id = data.get("job_id")
        if not job_id:
            return
        self.cancelled.add(job_id)
        if self.current and self.current.job_id == job_id:
            log.info("cancelling running job %s", job_id)
            await self.adapter.cancel(job_id)
        else:
            log.info("cancelled queued job %s", job_id)

    # ---- doing the work ----------------------------------------------------

    async def _fetch_asset(self, http: httpx.AsyncClient, job: Job, dest_dir: Path) -> Path:
        if not job.asset_url:
            raise AdapterError("job has no asset_url")
        url = job.asset_url
        name = Path(urlparse(url).path).name or "asset"
        dest = dest_dir / name
        if url.startswith("file://"):
            shutil.copy(urlparse(url).path, dest)
            return dest
        r = await http.get(urljoin(self.hub + "/", url.lstrip("/")) if not urlparse(url).scheme else url)
        r.raise_for_status()
        dest.write_bytes(r.content)
        return dest

    async def _do_job(self, http: httpx.AsyncClient, job: Job) -> None:
        jid = job.job_id
        dest_dir = self.work_dir / jid
        dest_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.send(JOB_PROGRESS, {"job_id": jid, "state": "running", "progress": 0.0, "eta_s": None})
            asset = await self._fetch_asset(http, job, dest_dir)
            native = await self.adapter.prepare(job, asset)
            async for p in self.adapter.run(job, native):
                self.send(JOB_PROGRESS, {"job_id": jid, "state": p.state, "progress": p.progress,
                                         "eta_s": p.eta_s, "message": p.message})
            self.send(JOB_PROGRESS, {"job_id": jid, "state": "verifying", "progress": 1.0, "eta_s": 0})
            photo_url, verification = await verify.verify_job(http, self.hub, self.machine_id, job, self.camera)
            log.info("done %s photo=%s verification=%s", jid, photo_url, verification)
            self.send(JOB_RESULT, {"job_id": jid, "ok": True, "photo_url": photo_url, "verification": verification})
        except Exception as e:
            reason = "cancelled" if jid in self.cancelled else str(e) or type(e).__name__
            log.error("job %s failed: %s", jid, reason)
            self.send(JOB_RESULT, {"job_id": jid, "ok": False, "photo_url": None,
                                   "verification": None, "error": reason})

    async def _worker(self) -> None:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as http:
            while True:
                job = await self.queue.get()
                if job.job_id in self.cancelled:
                    continue
                self.current = job
                try:
                    await self._do_job(http, job)
                finally:
                    self.current = None

    # ---- connection --------------------------------------------------------

    async def _session(self, ws: ClientConnection) -> None:
        await self._send_now(ws, HELLO, await self.public_manifest())
        welcome = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        if welcome.get("type") != WELCOME:
            raise ConnectionError(f"expected welcome, got {welcome.get('type')}")
        self.listed = bool(welcome.get("data", {}).get("listed"))
        log.info("connected to %s as %s (listed=%s)", self.ws_url, self.machine_id, self.listed)
        tasks = [asyncio.create_task(c) for c in (self._reader(ws), self._writer(ws), self._heartbeat(ws))]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                t.result()  # re-raise whatever ended the session
        finally:
            for t in tasks:
                t.cancel()

    async def run(self) -> None:
        worker = asyncio.create_task(self._worker())
        backoff = 1.0
        try:
            while True:
                try:
                    async with connect(self.ws_url, open_timeout=10, ping_interval=20) as ws:
                        self._ws = ws
                        backoff = 1.0
                        await self._session(ws)
                    log.warning("hub closed the connection")
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    log.warning("hub connection failed: %s", e)
                finally:
                    self._ws = None
                if worker.done():
                    worker.result()
                delay = backoff + random.uniform(0, 0.5)
                log.info("reconnecting in %.1fs", delay)
                await asyncio.sleep(delay)
                backoff = min(backoff * 2, 15)
        finally:
            worker.cancel()


def load_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text())
    for key in ("machine_id", "process", "adapter"):
        if key not in manifest:
            raise SystemExit(f"{path}: manifest is missing {key!r}")
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(description="Fabrary machine node")
    ap.add_argument("--machine", required=True, type=Path, help="node/machines/<id>.json")
    ap.add_argument("--hub", default=os.environ.get("FABRARY_HUB_URL", "http://localhost:8000"))
    ap.add_argument("--work-dir", type=Path, default=Path(".work"))
    ap.add_argument("--max-queue", type=int, default=3)
    ap.add_argument("--transport", choices=["ble", "serial", "lan", "file"],
                    help="override adapter.transport (file = dry run, no printer)")
    ap.add_argument("--probe", action="store_true", help="connect to the machine once before going online")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname).1s %(name)s: %(message)s", datefmt="%H:%M:%S")
    manifest = load_manifest(args.machine)
    if args.transport:
        manifest["adapter"]["transport"] = args.transport
    client = NodeClient(manifest, args.hub, args.work_dir, args.max_queue)

    async def go() -> None:
        if args.probe:
            log.info("probing machine...")
            await client.adapter.probe()
            log.info("machine reachable")
        await client.run()

    try:
        asyncio.run(go())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
