"""Adapter registry: the manifest's adapter.type picks the class.

Each machine family lives in its own package (node/adapters/<family>/) and is imported
lazily, so a node only needs the libraries for the machine it actually drives.
"""
from __future__ import annotations

from importlib import import_module
from typing import Any

from .base import Adapter, AdapterError, Progress

# adapter.type -> "package:Class"
REGISTRY: dict[str, str] = {
    "phomemo_m02pro": "phomemo:PhomemoM02Pro",
    # "instax_mini": "instax:InstaxMini",       # photo_print, TODO
    # "bambu_a1mini": "bambu:BambuA1Mini",      # fdm_print, TODO
    # "sim": "sim:SimAdapter",                  # every simulated process, TODO
}


def make_adapter(manifest: dict[str, Any]) -> Adapter:
    cfg = manifest.get("adapter") or {}
    kind = cfg.get("type")
    if kind not in REGISTRY:
        raise ValueError(f"no adapter for type {kind!r}; known: {', '.join(REGISTRY)}")
    package, cls = REGISTRY[kind].split(":")
    adapter_cls = getattr(import_module(f"{__name__}.{package}"), cls)
    return adapter_cls(manifest, cfg)


__all__ = ["Adapter", "AdapterError", "Progress", "REGISTRY", "make_adapter"]
