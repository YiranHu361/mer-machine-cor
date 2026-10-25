"""publish(type, data) into Convex, the live read model (design doc, "Convex live state").

Subscribes to the gateway and forwards its events, as §5 envelopes, to the
`publish:batch` mutation over Convex's HTTP API. Throttled as the design doc
asks: heartbeats never reach it (the gateway only emits status changes), and job
progress goes at most every 2 s per job. Convex is never on the print path: a
failed send is retried and logged once, and nothing here raises into the gateway.

    pub = ConvexPublisher.from_env()      # None unless CONVEX_URL and FABYN_PUBLISH_SECRET are set
    gateway.subscribe(pub.handle)
    task = asyncio.create_task(pub.run())
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from typing import Any

import httpx

from node.protocol import now_iso

log = logging.getLogger("publish")

# Only what the read model shows. asset_url and preview_url are signed file
# links, so they never leave the hub.
MACHINE_KEYS = ("machine_id", "process", "display_name", "simulated", "status", "media_loaded", "location", "reason")
JOB_KEYS = ("job_id", "machine_id", "state", "progress", "eta_s", "reason", "error")


def convex_url(env: dict[str, str] = os.environ) -> str | None:  # type: ignore[assignment]
    """CONVEX_URL, or the deployment named inside a dev/prod deploy key."""
    if env.get("CONVEX_URL"):
        return env["CONVEX_URL"]
    m = re.match(r"^(?:dev|prod):([a-z0-9-]+)\|", env.get("CONVEX_DEPLOY_KEY", ""))
    return f"https://{m.group(1)}.convex.cloud" if m else None


def public_view(type_: str, data: dict[str, Any]) -> dict[str, Any]:
    keys = MACHINE_KEYS if type_.startswith("machine.") else JOB_KEYS
    out = {k: data[k] for k in keys if data.get(k) is not None}
    if type_.startswith("job."):
        ours = (data.get("params") or {}).get("fabyn_job_id")
        if ours:
            out["params"] = {"fabyn_job_id": ours}
    return out


class ConvexPublisher:
    def __init__(self, url: str, secret: str, *, client: httpx.AsyncClient | None = None,
                 progress_every_s: float = 2.0, flush_every_s: float = 0.25):
        self.url = url.rstrip("/")
        self.secret = secret
        self.client = client or httpx.AsyncClient(timeout=10)
        self.progress_every_s = progress_every_s
        self.flush_every_s = flush_every_s
        self.queue: list[dict[str, Any]] = []
        self.held: dict[str, dict[str, Any]] = {}  # job_id -> newest throttled progress
        self.last_progress: dict[str, float] = {}
        self.failing = False

    @classmethod
    def from_env(cls) -> ConvexPublisher | None:
        url, secret = convex_url(), os.environ.get("FABYN_PUBLISH_SECRET")
        return cls(url, secret) if url and secret else None

    def handle(self, type_: str, data: dict[str, Any]) -> None:
        """Gateway subscriber: queue one event, holding back progress that comes too fast."""
        event = {"type": type_, "ts": now_iso(), "data": public_view(type_, data)}
        job_id = data.get("job_id")
        if type_ == "job.updated" and data.get("state") == "running" and job_id:
            if time.monotonic() - self.last_progress.get(job_id, float("-inf")) < self.progress_every_s:
                self.held[job_id] = event
                return
            self.last_progress[job_id] = time.monotonic()
        elif job_id:
            self.held.pop(job_id, None)  # a state change supersedes held progress
        self.queue.append(event)
        del self.queue[:-2000]

    def _release_held(self) -> None:
        t = time.monotonic()
        for job_id, event in list(self.held.items()):
            if t - self.last_progress.get(job_id, float("-inf")) >= self.progress_every_s:
                self.last_progress[job_id] = t
                self.queue.append(self.held.pop(job_id))

    async def flush(self) -> bool:
        self._release_held()
        while self.queue:
            batch = self.queue[:100]
            try:
                r = await self.client.post(f"{self.url}/api/mutation", json={
                    "path": "publish:batch",
                    "args": {"secret": self.secret, "source": "producer", "events": batch},
                    "format": "json",
                })
                body = r.json()
                if r.status_code != 200 or body.get("status") != "success":
                    raise RuntimeError(body.get("errorMessage") or f"HTTP {r.status_code}")
            except Exception as e:
                if not self.failing:
                    log.warning("Convex publish failed; the live view is stale until it recovers. Prints continue. %s", e)
                self.failing = True
                return False
            if self.failing:
                log.info("Convex publish recovered")
            self.failing = False
            del self.queue[:len(batch)]
        return True

    async def run(self) -> None:
        while True:
            ok = await self.flush()
            await asyncio.sleep(self.flush_every_s if ok else 5)

    async def aclose(self) -> None:
        await self.flush()
        await self.client.aclose()
