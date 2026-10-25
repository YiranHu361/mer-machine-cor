"""Node gateway: the producer's part of the hub (design doc, Ownership).

Owns /ws/node, heartbeats, job dispatch and POST /nodes/{machine_id}/frames.
The consumer's hub core mounts it and talks to it through three calls plus events:

    from hub.gateway import gateway
    app.include_router(gateway.router)          # and call gateway.start() in the lifespan
    gateway.subscribe(on_event)                 # on_event(type, data); types match /ws/events:
                                                # machine.online/offline/updated, job.updated/done/failed
    await gateway.offer_job(job_dict)           # job.offer to job["machine_id"]
    await gateway.cancel_job(machine_id, job_id)
    await gateway.check_machine(machine_id)     # node connects to its machine once: {"ok", "detail"}
    gateway.machines()                          # manifests with live status, for GET /machines
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect

from node.protocol import (
    HEARTBEAT,
    HELLO,
    JOB_ACCEPT,
    JOB_CANCEL,
    JOB_OFFER,
    JOB_PROGRESS,
    JOB_REJECT,
    JOB_RESULT,
    MACHINE_CHECK,
    MACHINE_CHECKED,
    OFFLINE_AFTER_S,
    PLATE_CLEARED,
    WELCOME,
    envelope,
)

log = logging.getLogger("gateway")

EventHandler = Callable[[str, dict[str, Any]], Awaitable[None] | None]


@dataclass
class NodeConn:
    ws: WebSocket | None
    manifest: dict[str, Any]
    last_seen: float = field(default_factory=time.monotonic)
    online: bool = True
    jobs: dict[str, dict[str, Any]] = field(default_factory=dict)  # job_id -> last known state


class Gateway:
    def __init__(self, frames_dir: Path = Path(".data/frames")):
        self.nodes: dict[str, NodeConn] = {}
        self.frames_dir = frames_dir
        self._subs: list[EventHandler] = []
        self._watchdog: asyncio.Task | None = None
        self._checks: dict[str, asyncio.Future] = {}  # check_id -> the node's answer
        self.router = APIRouter()
        self.router.add_api_websocket_route("/ws/node", self._ws_node)
        self.router.add_api_route("/nodes/{machine_id}/frames", self._upload_frame, methods=["POST"])

    # ---- consumer-facing API ----------------------------------------------

    def subscribe(self, handler: EventHandler) -> None:
        self._subs.append(handler)

    def start(self) -> None:
        if self._watchdog is None or self._watchdog.done():
            self._watchdog = asyncio.create_task(self._watch_heartbeats())

    async def stop(self) -> None:
        if self._watchdog:
            self._watchdog.cancel()

    def machines(self) -> list[dict[str, Any]]:
        out = []
        for c in self.nodes.values():
            m = dict(c.manifest)
            if not c.online:
                m["status"] = "offline"
            out.append(m)
        return out

    async def plate_cleared(self, machine_id: str) -> None:
        """Someone took the last print off this machine; its node may take the next job."""
        conn = self.nodes.get(machine_id)
        if not conn or not conn.online or conn.ws is None:
            raise LookupError(f"machine {machine_id} is offline")
        await conn.ws.send_json(envelope(PLATE_CLEARED, {"machine_id": machine_id}))
        await self._emit("machine.plate_cleared", {"machine_id": machine_id})

    async def offer_job(self, job: dict[str, Any]) -> None:
        conn = self.nodes.get(job["machine_id"])
        if not conn or not conn.online or conn.ws is None:
            raise LookupError(f"machine {job['machine_id']} is offline")
        conn.jobs[job["job_id"]] = {**job, "state": "offered"}
        await conn.ws.send_json(envelope(JOB_OFFER, job))
        await self._emit("job.updated", {**job, "state": "offered"})

    async def cancel_job(self, machine_id: str, job_id: str) -> None:
        conn = self.nodes.get(machine_id)
        if conn and conn.online and conn.ws is not None:
            await conn.ws.send_json(envelope(JOB_CANCEL, {"job_id": job_id}))

    async def check_machine(self, machine_id: str, timeout: float = 90) -> dict[str, Any]:
        """Ask the node to connect to its machine once, printing nothing, before an order
        is offered to it. A node online is not proof the printer is on: it may have slept."""
        conn = self.nodes.get(machine_id)
        if not conn or not conn.online or conn.ws is None:
            raise LookupError(f"machine {machine_id} is offline")
        check_id = uuid.uuid4().hex[:12]
        answer: asyncio.Future = asyncio.get_running_loop().create_future()
        self._checks[check_id] = answer
        try:
            await conn.ws.send_json(envelope(MACHINE_CHECK, {"check_id": check_id}))
            return await asyncio.wait_for(answer, timeout)
        finally:
            self._checks.pop(check_id, None)

    # ---- internals ---------------------------------------------------------

    async def _emit(self, type_: str, data: dict[str, Any]) -> None:
        for h in self._subs:
            try:
                r = h(type_, data)
                if inspect.isawaitable(r):
                    await r
            except Exception:
                log.exception("event handler failed for %s", type_)

    def _job_update(self, conn: NodeConn, job_id: str, **changes: Any) -> dict[str, Any]:
        job = conn.jobs.setdefault(job_id, {"job_id": job_id, "machine_id": conn.manifest["machine_id"]})
        job.update({k: v for k, v in changes.items() if v is not None or k == "verification"})
        return dict(job)

    async def _mark_offline(self, conn: NodeConn, reason: str) -> None:
        if not conn.online:
            return
        conn.online = False
        mid = conn.manifest["machine_id"]
        log.info("%s offline (%s)", mid, reason)
        unfinished = [j for j, s in conn.jobs.items() if s.get("state") not in ("done", "failed", "rejected")]
        await self._emit("machine.offline", {"machine_id": mid, "reason": reason, "unfinished_jobs": unfinished})

    async def _watch_heartbeats(self) -> None:
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            for conn in list(self.nodes.values()):
                if conn.online and now - conn.last_seen > OFFLINE_AFTER_S:
                    await self._mark_offline(conn, "heartbeat_timeout")
                    if conn.ws is not None:
                        try:
                            await conn.ws.close(code=4000)
                        except Exception:
                            pass

    async def _ws_node(self, ws: WebSocket) -> None:
        await ws.accept()
        try:
            hello = await asyncio.wait_for(ws.receive_json(), timeout=10)
        except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
            await ws.close(code=4001)
            return
        if hello.get("type") != HELLO or "machine_id" not in (hello.get("data") or {}):
            await ws.close(code=4002)
            return
        manifest = hello["data"]
        mid = manifest["machine_id"]

        old = self.nodes.get(mid)
        if old and old.ws is not None and old.online:
            try:
                await old.ws.close(code=4003)  # replaced by a newer connection
            except Exception:
                pass
        conn = NodeConn(ws=ws, manifest=manifest, jobs=old.jobs if old else {})
        self.nodes[mid] = conn
        await ws.send_json(envelope(WELCOME, {"machine_id": mid, "listed": True}))
        log.info("%s online (%s, simulated=%s)", mid, manifest.get("process"), manifest.get("simulated"))
        await self._emit("machine.online", manifest)

        try:
            while True:
                msg = await ws.receive_json()
                conn.last_seen = time.monotonic()
                await self._handle(conn, msg.get("type"), msg.get("data") or {})
        except WebSocketDisconnect:
            pass
        except Exception:
            log.exception("node %s connection error", mid)
        finally:
            if self.nodes.get(mid) is conn:
                conn.ws = None
                await self._mark_offline(conn, "disconnected")

    async def _handle(self, conn: NodeConn, type_: str | None, d: dict[str, Any]) -> None:
        mid = conn.manifest["machine_id"]
        if type_ == HEARTBEAT:
            changed = (d.get("status") != conn.manifest.get("status")
                       or d.get("media_loaded") != conn.manifest.get("media_loaded")
                       or d.get("detail") != conn.manifest.get("detail"))
            conn.manifest["status"] = d.get("status", conn.manifest.get("status"))
            conn.manifest["media_loaded"] = d.get("media_loaded", conn.manifest.get("media_loaded"))
            conn.manifest["detail"] = d.get("detail")
            if not conn.online:
                conn.online = True
                await self._emit("machine.online", conn.manifest)
            elif changed:
                await self._emit("machine.updated", conn.manifest)
        elif type_ == JOB_ACCEPT:
            await self._emit("job.updated", self._job_update(conn, d["job_id"], state="accepted"))
        elif type_ == JOB_REJECT:
            await self._emit("job.updated", self._job_update(conn, d["job_id"], state="rejected", reason=d.get("reason")))
        elif type_ == JOB_PROGRESS:
            await self._emit("job.updated", self._job_update(
                conn, d["job_id"], state=d.get("state"), progress=d.get("progress"), eta_s=d.get("eta_s")))
        elif type_ == JOB_RESULT:
            v = d.get("verification")
            if not d.get("ok") or (v and v.get("pass") is False):
                job = self._job_update(conn, d["job_id"], state="failed", verification=v,
                                       photo_url=d.get("photo_url"), error=d.get("error"))
                await self._emit("job.failed", job)
            elif v and v.get("pass") is True:
                job = self._job_update(conn, d["job_id"], state="done", progress=1.0, verification=v,
                                       photo_url=d.get("photo_url"))
                await self._emit("job.done", job)
            else:
                # Made, but nobody has checked it yet: wait for "Approve manually" on the dashboard.
                job = self._job_update(conn, d["job_id"], state="verifying", progress=1.0, verification=v,
                                       photo_url=d.get("photo_url"))
                await self._emit("job.updated", job)
        elif type_ == MACHINE_CHECKED:
            answer = self._checks.get(d.get("check_id"))
            if answer and not answer.done():
                answer.set_result({"machine_id": mid, "ok": bool(d.get("ok")), "detail": d.get("detail")})
        else:
            log.debug("%s sent unknown type %s", mid, type_)

    async def approve_manually(self, machine_id: str, job_id: str, reason: str | None = None) -> dict[str, Any]:
        """Owner dashboard's labeled "Approve manually" button (or the consumer's no-camera acceptance)."""
        conn = self.nodes.get(machine_id)
        if not conn or job_id not in conn.jobs:
            raise LookupError(job_id)
        job = self._job_update(conn, job_id, state="done",
                               verification={"pass": True, "reason": reason or "approved manually by owner", "manual": True})
        await self._emit("job.done", job)
        return job

    async def _upload_frame(self, machine_id: str, file: UploadFile = File(...), job_id: str = Form(...)) -> dict:
        if machine_id not in self.nodes:
            raise HTTPException(404, "unknown machine")
        data = await file.read()
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(413, "frame too large")
        self.frames_dir.mkdir(parents=True, exist_ok=True)
        name = f"{machine_id}_{job_id}_{uuid.uuid4().hex[:6]}.jpg"
        (self.frames_dir / name).write_bytes(data)
        return {"photo_url": f"/frames/{name}"}


gateway = Gateway()
