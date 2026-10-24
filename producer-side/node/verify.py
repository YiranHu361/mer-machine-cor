"""Webcam check after a job (design doc, Producer side).

Now:   grab one frame from the machine's webcam and upload it to POST /nodes/{id}/frames,
       so the sender and pickup pages get the finished-item photo.
Later: send the frame and the job's preview_url to Claude, asking {"pass": bool, "reason": str}.
       Until then verification.pass is None, meaning "needs manual approval"; never fake a pass.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from .protocol import Job

log = logging.getLogger(__name__)


def _grab_opencv(index: int, warmup_frames: int) -> bytes | None:
    import cv2  # opencv-python, optional

    cap = cv2.VideoCapture(index)
    try:
        if not cap.isOpened():
            return None
        frame = None
        for _ in range(max(1, warmup_frames)):  # let auto-exposure settle
            ok, frame = cap.read()
            if not ok:
                return None
        ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
        return jpg.tobytes() if ok else None
    finally:
        cap.release()


async def capture_frame(camera: dict[str, Any] | None) -> bytes | None:
    if not camera or camera.get("index") is None:
        return None
    if delay := camera.get("delay_s"):
        await asyncio.sleep(float(delay))  # let the sticker finish feeding out
    try:
        return await asyncio.to_thread(_grab_opencv, int(camera["index"]), int(camera.get("warmup_frames", 8)))
    except ImportError:
        log.warning("camera configured but opencv-python is not installed")
    except Exception as e:
        log.warning("camera capture failed: %s", e)
    return None


async def upload_frame(http: httpx.AsyncClient, hub: str, machine_id: str, job_id: str, jpeg: bytes) -> str | None:
    try:
        r = await http.post(
            f"{hub}/nodes/{machine_id}/frames",
            data={"job_id": job_id},
            files={"file": (f"{job_id}.jpg", jpeg, "image/jpeg")},
        )
        r.raise_for_status()
        return r.json().get("photo_url")
    except Exception as e:
        log.warning("frame upload failed: %s", e)
        return None


async def verify_job(
    http: httpx.AsyncClient, hub: str, machine_id: str, job: Job, camera: dict[str, Any] | None
) -> tuple[str | None, dict[str, Any]]:
    """Return (photo_url, verification)."""
    frame = await capture_frame(camera)
    if frame is None:
        return None, {"pass": None, "reason": "no camera frame; needs manual approval"}
    photo_url = await upload_frame(http, hub, machine_id, job.job_id, frame)
    # TODO(check 3): Claude vision check against job.preview_url.
    return photo_url, {"pass": None, "reason": "vision check not enabled; needs manual approval"}
