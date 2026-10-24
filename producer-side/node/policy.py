"""Owner policy. The node enforces it itself, so the hub can't override it."""
from __future__ import annotations

from datetime import datetime, time
from typing import Any

from .protocol import Job


def _in_hours(window: str, now: time) -> bool:
    """window is "HH:MM-HH:MM" in the node's local time; may wrap past midnight."""
    start_s, end_s = window.split("-")
    start = time.fromisoformat(start_s)
    end = time(23, 59, 59) if end_s == "24:00" else time.fromisoformat(end_s)
    if start <= end:
        return start <= now <= end
    return now >= start or now <= end


def requested_size_mm(job: Job) -> tuple[float, float] | None:
    """Target print size, if the job states one (params.width_mm/height_mm or params.size_mm)."""
    p = job.params
    if "size_mm" in p and isinstance(p["size_mm"], (list, tuple)) and len(p["size_mm"]) >= 2:
        return float(p["size_mm"][0]), float(p["size_mm"][1])
    if "width_mm" in p:
        return float(p["width_mm"]), float(p.get("height_mm", 0))
    return None


def check(
    job: Job,
    manifest: dict[str, Any],
    *,
    machine_state: str,
    queued: int,
    max_queue: int,
    now: datetime | None = None,
) -> str | None:
    """Return a reject reason, or None to accept."""
    if job.machine_id != manifest["machine_id"]:
        return f"wrong_machine: offered to {job.machine_id}"
    if job.process != manifest["process"]:
        return f"wrong_process: this machine does {manifest['process']}"
    if machine_state == "error":
        return "machine_error"
    if queued >= max_queue:
        return "busy: queue full"

    limits = manifest.get("limits", {})
    now = now or datetime.now()
    if hours := limits.get("hours"):
        if not _in_hours(hours, now.time()):
            return f"outside_hours: {hours}"

    size = requested_size_mm(job)
    max_size = limits.get("max_size_mm")
    if size and max_size:
        w, h = size
        if w > max_size[0] or (max_size[1] and h > max_size[1]):
            return f"too_large: {w}x{h} mm exceeds {max_size[0]}x{max_size[1]} mm"

    tm = manifest.get("time_model", {})
    max_min = limits.get("max_job_minutes")
    if max_min and tm:
        est_min = (tm.get("setup_s", 0) + tm.get("per_unit_s", 0) * job.quantity) / 60
        if est_min > max_min:
            return f"too_long: about {est_min:.0f} min exceeds {max_min} min"

    media = manifest.get("media_loaded") or {}
    remaining = media.get("remaining_est")
    if remaining is not None and remaining < job.quantity:
        return f"out_of_media: {remaining} left, {job.quantity} needed"

    return None
