"""Hub <-> node message shapes (design doc, Shared contracts §4 and §5).

These mirror contracts/models.py, which the consumer owns. Until that file lands,
the node keeps its own copy of the only two shapes it needs: the job and the
message envelope. Swap these for imports from contracts.models once it exists.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# node -> hub
HELLO = "hello"
HEARTBEAT = "heartbeat"
JOB_ACCEPT = "job.accept"
JOB_REJECT = "job.reject"
JOB_PROGRESS = "job.progress"
JOB_RESULT = "job.result"

# hub -> node
WELCOME = "welcome"
JOB_OFFER = "job.offer"
JOB_CANCEL = "job.cancel"
PLATE_CLEARED = "plate.cleared"  # a person took the last print off the machine

HEARTBEAT_INTERVAL_S = 5
OFFLINE_AFTER_S = 15


class Job(BaseModel):
    """One job per assignment; the only thing a node ever sees."""

    model_config = ConfigDict(extra="allow")

    job_id: str
    order_id: str
    item_id: str
    machine_id: str
    process: str
    quantity: int = Field(ge=1)
    asset_url: str | None = None
    preview_url: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    state: str = "offered"
    progress: float = 0.0
    eta_s: int | None = None
    escrow: str | None = None
    verification: dict[str, Any] | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def envelope(type_: str, data: dict[str, Any]) -> dict[str, Any]:
    """Same {"type", "ts", "data"} envelope the hub uses on /ws/events."""
    return {"type": type_, "ts": now_iso(), "data": data}
