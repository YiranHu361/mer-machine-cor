"""Fujifilm Instax mini Link printer (process photo_print).

prepare: the consumer's picture -> 600 x 800 RGB (any other size is fitted whole on
         white, never cropped), flipped if the manifest says so -> a JPEG under the
         transfer limit (.jpg) plus a preview PNG of what prints.
run:     connect over Bluetooth by name, send the JPEG once per copy, wait for the
         printer's print confirmation, then for the photo to come out. The film keeps
         developing for about 90 s after that, outside the job.
transport "file" is a dry run: the JPEG is written to out_dir and no printer is touched.
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any, AsyncIterator

from PIL import Image

from ...protocol import Job
from ..base import Adapter, AdapterError, Progress
from .image import fit_to_film, to_jpeg

log = logging.getLogger(__name__)


class InstaxMini(Adapter):
    process = "photo_print"

    def __init__(self, manifest: dict[str, Any], config: dict[str, Any]):
        super().__init__(manifest, config)
        self.transport = config.get("transport", "ble")
        self.ble_name = config.get("ble_name")
        self.ble_address = config.get("ble_address")
        self.max_jpeg_bytes = int(float(config.get("max_jpeg_kb", 55)) * 1000)
        self.flip_vertical = bool(config.get("flip_vertical", False))
        self.scan_s = float(config.get("scan_s", 12))
        self.job_timeout_s = float(config.get("job_timeout_s", 120))
        self.eject_s = float(config.get("eject_s", 15))

        self._state = "idle"
        self._detail: str | None = None
        self._cancel: set[str] = set()
        self._printer_info: dict[str, Any] = {}  # photos_left, battery_pct, charging: from the printer

    async def prepare(self, job: Job, asset_path: Path) -> Path:
        def work() -> Path:
            with Image.open(asset_path) as src:
                src.load()
                film = fit_to_film(src)
            preview = asset_path.with_name(f"{job.job_id}_print_preview.png")
            film.save(preview)
            try:
                data = to_jpeg(film, self.max_jpeg_bytes, bool(job.params.get("flip_vertical", self.flip_vertical)))
            except ValueError as e:
                raise AdapterError(str(e)) from e
            native = asset_path.with_name(f"{job.job_id}.instax.jpg")
            native.write_bytes(data)
            log.info("prepared %s: 600x800 JPEG, %.1f KB -> %s", job.job_id, len(data) / 1000, native.name)
            return native

        return await asyncio.to_thread(work)

    def _link(self):
        from .link import InstaxLink  # imported here: only an Instax node needs simplepyble

        return InstaxLink(self.ble_name, self.ble_address, self.scan_s)

    def _print(self, data: bytes, job_id: str, copies: int, shared: dict[str, Any]) -> None:
        """Blocking: runs in a worker thread."""
        from .link import LinkError

        link = self._link()
        try:
            link.open()
            self._printer_info.update(link.info)
            for copy in range(copies):
                shared["message"] = f"sending copy {copy + 1}/{copies}"

                def progress(frac: float, copy: int = copy) -> None:
                    shared["frac"] = (copy + frac) / copies

                link.print_jpeg(data, progress, lambda: job_id in self._cancel, self.job_timeout_s)
                self._printer_info.update(link.info)
                shared["message"] = f"printing copy {copy + 1}/{copies}"
                time.sleep(self.eject_s)  # confirmation comes before the photo is out
        except LinkError as e:
            raise AdapterError(str(e)) from e
        finally:
            link.close()

    async def run(self, job: Job, native_path: Path) -> AsyncIterator[Progress]:
        data = native_path.read_bytes()
        copies = job.quantity
        per_copy_s = self.manifest.get("time_model", {}).get("per_unit_s", 35)
        self._state, self._detail = "busy", None
        self._cancel.discard(job.job_id)
        try:
            yield Progress("running", 0.0, eta_s=int(per_copy_s * copies), message="connecting")
            if self.transport == "file":
                out = Path(self.config.get("out_dir", ".work/printer_out"))
                out.mkdir(parents=True, exist_ok=True)
                for copy in range(copies):
                    (out / f"{job.job_id}_{copy + 1}.instax.jpg").write_bytes(data)
                    yield Progress("running", round((copy + 1) / copies * 0.9, 3),
                                   message=f"copy {copy + 1}/{copies} (dry run)")
            else:
                shared: dict[str, Any] = {"frac": 0.0, "message": "connecting"}
                task = asyncio.ensure_future(asyncio.to_thread(self._print, data, job.job_id, copies, shared))
                last = None
                while not task.done():
                    await asyncio.sleep(0.5)
                    now = (round(shared["frac"], 2), shared["message"])
                    if now != last:
                        last = now
                        # Bytes sent is not a photo out; keep the last 10% for completion.
                        yield Progress("running", round(shared["frac"] * 0.9, 3), message=shared["message"])
                await task
            media = self.manifest.get("media_loaded") or {}
            if isinstance(self._printer_info.get("photos_left"), int):
                media["remaining_est"] = self._printer_info["photos_left"]
            elif isinstance(media.get("remaining_est"), (int, float)):
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
        # Stops the transfer; a picture the printer already confirmed still prints.
        self._cancel.add(job_id)

    async def probe(self) -> None:
        if self.transport == "file":
            return

        def work() -> None:
            from .link import LinkError

            link = self._link()
            try:
                link.open()
                self._printer_info.update(link.info)
            except LinkError as e:
                raise AdapterError(str(e)) from e
            finally:
                link.close()

        await asyncio.to_thread(work)
        media = self.manifest.get("media_loaded") or {}
        if isinstance(self._printer_info.get("photos_left"), int):
            media["remaining_est"] = self._printer_info["photos_left"]

    def clear_error(self) -> None:
        self._state, self._detail = "idle", None
