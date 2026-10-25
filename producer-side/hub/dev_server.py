"""Stub hub for testing nodes without the consumer's hub (Contracts gate: "stub gateway").

Serves the real gateway plus just enough to push jobs by hand:

    python -m hub.dev_server                     # http://localhost:8000
    curl -X POST localhost:8000/dev/offer -H 'content-type: application/json' \
         -d '{"machine_id": "m_sticker_01"}'     # prints hub/dev_assets/test_sticker.png
    curl localhost:8000/machines
    curl localhost:8000/dev/events
    curl -X POST localhost:8000/dev/plate-cleared -d '{"machine_id":"m_fdm_01"}' -H 'content-type: application/json'
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import logging
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field

from .gateway import Gateway
from .publish import ConvexPublisher

log = logging.getLogger("dev_hub")
HERE = Path(__file__).parent
ASSETS = HERE / "dev_assets"


def make_test_sticker(path: Path) -> None:
    """48 x 30 mm at 300 dpi, high contrast, like the consumer's sticker assets."""
    w, h = 567, 354
    img = Image.new("L", (w, h), 255)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((6, 6, w - 7, h - 7), radius=40, outline=0, width=8)
    d.text((w // 2, h // 2 - 40), "Happy birthday!", fill=0, anchor="mm", font=ImageFont.load_default(size=64))
    d.text((w // 2, h // 2 + 50), "Fabyn test sticker", fill=0, anchor="mm", font=ImageFont.load_default(size=36))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, dpi=(300, 300))


class OfferIn(BaseModel):
    machine_id: str
    asset_url: str = "/assets/test_sticker.png"
    preview_url: str | None = None
    quantity: int = Field(1, ge=1)
    process: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class JobRef(BaseModel):
    machine_id: str
    job_id: str


class MachineRef(BaseModel):
    machine_id: str


def create_app() -> FastAPI:
    gw = Gateway()
    events: deque[dict[str, Any]] = deque(maxlen=500)
    ids = itertools.count(1)

    def record(type_: str, data: dict[str, Any]) -> None:
        events.append({"type": type_, "data": data})
        brief = {k: data.get(k) for k in ("machine_id", "job_id", "state", "progress", "reason", "error") if data.get(k) is not None}
        log.info("event %-16s %s", type_, brief)

    gw.subscribe(record)
    publisher = ConvexPublisher.from_env()
    if publisher:
        gw.subscribe(publisher.handle)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if not (ASSETS / "test_sticker.png").exists():
            make_test_sticker(ASSETS / "test_sticker.png")
        gw.start()
        publishing = asyncio.create_task(publisher.run()) if publisher else None
        log.info("live view: %s", publisher.url if publisher else "off (set CONVEX_URL and FABYN_PUBLISH_SECRET)")
        yield
        await gw.stop()
        if publishing:
            publishing.cancel()
            await publisher.aclose()

    app = FastAPI(title="Fabyn dev hub", lifespan=lifespan)
    app.state.gateway = gw
    app.include_router(gw.router)
    ASSETS.mkdir(parents=True, exist_ok=True)
    app.mount("/assets", StaticFiles(directory=ASSETS), name="assets")

    @app.get("/machines")
    def machines() -> list[dict[str, Any]]:
        return gw.machines()

    @app.post("/dev/offer")
    async def offer(body: OfferIn) -> dict[str, Any]:
        conn = gw.nodes.get(body.machine_id)
        if not conn:
            raise HTTPException(404, f"{body.machine_id} never connected")
        n = next(ids)
        job = {
            "job_id": f"job_dev_{n:04d}",
            "order_id": "ord_dev",
            "item_id": f"it_{n}",
            "machine_id": body.machine_id,
            "process": body.process or conn.manifest["process"],
            "quantity": body.quantity,
            "asset_url": body.asset_url,
            "preview_url": body.preview_url or body.asset_url,
            "params": body.params,
            "state": "offered",
            "progress": 0.0,
            "eta_s": None,
            "escrow": "held",
        }
        try:
            await gw.offer_job(job)
        except LookupError as e:
            raise HTTPException(409, str(e))
        return job

    @app.post("/dev/cancel")
    async def cancel(body: JobRef) -> dict[str, str]:
        await gw.cancel_job(body.machine_id, body.job_id)
        return {"ok": "sent"}

    @app.post("/dev/check")
    async def check(body: MachineRef) -> dict[str, Any]:
        """The node connects to its machine once, printing nothing: {machine_id, ok, detail}."""
        if body.machine_id not in gw.nodes:
            raise HTTPException(404, f"{body.machine_id} never connected")
        try:
            return await gw.check_machine(body.machine_id)
        except LookupError as e:
            raise HTTPException(409, str(e))
        except asyncio.TimeoutError:
            return {"machine_id": body.machine_id, "ok": False, "detail": "the node did not answer in time"}

    @app.post("/dev/plate-cleared")
    async def plate_cleared(body: MachineRef) -> dict[str, str]:
        try:
            await gw.plate_cleared(body.machine_id)
        except LookupError as e:
            raise HTTPException(409, str(e))
        return {"ok": "sent"}

    @app.get("/dev/events")
    def get_events(limit: int = 50) -> list[dict[str, Any]]:
        return list(events)[-limit:]

    return app


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname).1s %(name)s: %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per Convex publish otherwise
    uvicorn.run(create_app(), host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
