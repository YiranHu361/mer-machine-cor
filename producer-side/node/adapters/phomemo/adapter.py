"""Phomemo M02 Pro sticker printer (process sticker_print).

prepare: the consumer's high-contrast PNG -> scaled to size, dithered to 1-bit,
         centered on the print head -> raster bytes (.bin) plus a preview PNG.
run:     open the transport, stream the bytes once per copy, wait for the printer's
         "print complete" notification (or a fixed settle time if it never comes).
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any, AsyncIterator

from PIL import Image, ImageOps

from ...policy import requested_size_mm
from ...protocol import Job
from ..base import Adapter, AdapterError, Progress
from .raster import encode_raster, mm_to_dots, prepare_image
from .transport import Transport, make_transport

log = logging.getLogger(__name__)


class PhomemoM02Pro(Adapter):
    process = "sticker_print"

    def __init__(self, manifest: dict[str, Any], config: dict[str, Any]):
        super().__init__(manifest, config)
        self.dpi = int(config.get("dpi", 300))
        self.width_dots = int(config.get("print_width_dots", 576))
        self.density = int(config.get("density", 4))
        self.dither = config.get("dither", "floyd")
        self.rotate = bool(config.get("rotate", False))
        self.feed_lines = int(config.get("feed_lines", 2))
        self.completion_timeout_s = float(config.get("completion_timeout_s", 15))
        self.settle_s = float(config.get("settle_s", 3))
        self.connect_attempts = int(config.get("connect_attempts", 3))
        max_len_mm = (manifest.get("limits", {}).get("max_size_mm") or [0, 0])[1]
        self.max_length_dots = mm_to_dots(max_len_mm, self.dpi) if max_len_mm else None

        self._state = "idle"
        self._detail: str | None = None
        self._cancel: set[str] = set()
        self._printer_info: dict[str, Any] = {}  # battery_pct, serial: refreshed after each print

    def _transport(self) -> Transport:
        return make_transport(self.config)

    async def prepare(self, job: Job, asset_path: Path) -> Path:
        def work() -> Path:
            with Image.open(asset_path) as src:
                src.load()
                bw = prepare_image(
                    src,
                    width_dots=self.width_dots,
                    dpi=self.dpi,
                    target_mm=requested_size_mm(job),
                    max_length_dots=self.max_length_dots,
                    rotate=bool(job.params.get("rotate", self.rotate)),
                    dither=job.params.get("dither", self.dither),
                )
            preview = asset_path.with_name(f"{job.job_id}_print_preview.png")
            bw.save(preview)
            native = asset_path.with_name(f"{job.job_id}.phomemo.bin")
            native.write_bytes(encode_raster(bw, density=self.density, feed_lines=self.feed_lines))
            ink = ImageOps.invert(bw.convert("L")).getbbox()
            content_w = (ink[2] - ink[0]) if ink else 0
            log.info("prepared %s: content %.1f mm wide on a %.1f x %.1f mm label -> %s",
                     job.job_id, content_w * 25.4 / self.dpi,
                     bw.width * 25.4 / self.dpi, bw.height * 25.4 / self.dpi, native.name)
            return native

        return await asyncio.to_thread(work)

    async def _connect(self) -> Transport:
        last: Exception | None = None
        for attempt in range(1, self.connect_attempts + 1):
            transport = self._transport()
            try:
                await transport.open()
                return transport
            except Exception as e:
                last = e
                log.warning("connect attempt %d/%d failed: %s", attempt, self.connect_attempts, e)
                await transport.close()
                await asyncio.sleep(1.5 * attempt)
        raise AdapterError(f"could not connect to printer: {last}")

    async def run(self, job: Job, native_path: Path) -> AsyncIterator[Progress]:
        data = native_path.read_bytes()
        copies = job.quantity
        per_copy_s = self.manifest.get("time_model", {}).get("per_unit_s", 20)
        self._state, self._detail = "busy", None
        self._cancel.discard(job.job_id)
        started = time.monotonic()
        try:
            yield Progress("running", 0.0, eta_s=int(per_copy_s * copies), message="connecting")
            transport = await self._connect()
            try:
                step = transport.chunk_bytes
                total = len(data) * copies
                sent = 0
                last_report = 0.0
                for copy in range(copies):
                    for i in range(0, len(data), step):
                        if job.job_id in self._cancel:
                            raise AdapterError("cancelled")
                        await transport.write_chunk(data[i : i + step])
                        sent += min(step, len(data) - i)
                        frac = sent / total
                        if frac - last_report >= 0.1:
                            last_report = frac
                            elapsed = time.monotonic() - started
                            eta = int(elapsed / frac * (1 - frac)) if frac else None
                            # Bytes sent is not paper out; keep the last 10% for completion.
                            yield Progress("running", round(frac * 0.9, 3), eta_s=eta,
                                           message=f"copy {copy + 1}/{copies}")
                    if transport.has_completion_signal:
                        done = await transport.wait_complete(self.completion_timeout_s)
                        if not done:
                            log.info("no print-complete signal for copy %d; assuming done", copy + 1)
                if not transport.has_completion_signal:
                    await asyncio.sleep(self.settle_s)
            finally:
                self._printer_info.update(transport.info)
                await transport.close()
            media = self.manifest.get("media_loaded") or {}
            if isinstance(media.get("remaining_est"), (int, float)):
                media["remaining_est"] = max(0, media["remaining_est"] - copies)
            yield Progress("running", 1.0, eta_s=0, message="printed")
            self._state = "idle"
        except AdapterError as e:
            self._state = "idle" if str(e) == "cancelled" else "error"
            self._detail = str(e)
            raise
        except Exception as e:
            self._state, self._detail = "error", str(e)
            raise AdapterError(str(e)) from e
        finally:
            self._cancel.discard(job.job_id)

    async def status(self) -> dict[str, Any]:
        return {"state": self._state, "media": self.manifest.get("media_loaded"), "detail": self._detail,
                **self._printer_info}

    async def cancel(self, job_id: str) -> None:
        # Stops between chunks; whatever is already in the printer's buffer still prints.
        self._cancel.add(job_id)

    async def probe(self) -> None:
        transport = await self._connect()
        await transport.close()

    def clear_error(self) -> None:
        self._state, self._detail = "idle", None
