"""Adapter interface (design doc, Producer side). Only the adapter differs per machine."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

from ..protocol import Job


@dataclass
class Progress:
    state: str  # running | verifying
    progress: float  # 0.0 - 1.0
    eta_s: int | None = None
    message: str | None = None


class AdapterError(Exception):
    """A machine-side failure; the node reports it as job.result ok=false."""


class Adapter(ABC):
    process: str

    def __init__(self, manifest: dict[str, Any], config: dict[str, Any]):
        self.manifest = manifest
        self.config = config

    @abstractmethod
    async def prepare(self, job: Job, asset_path: Path) -> Path:
        """Convert the consumer's machine-agnostic asset into a machine-native file."""

    @abstractmethod
    def run(self, job: Job, native_path: Path) -> AsyncIterator[Progress]:
        """Make the item(s), yielding progress. Return normally only when done."""

    @abstractmethod
    async def status(self) -> dict[str, Any]:
        """{"state": "idle" | "busy" | "error", "media": ..., "detail": ...}"""

    @abstractmethod
    async def cancel(self, job_id: str) -> None:
        """Stop the running job as soon as the machine allows."""

    async def probe(self) -> None:
        """Optional startup check that the machine is reachable. Raise AdapterError if not."""
