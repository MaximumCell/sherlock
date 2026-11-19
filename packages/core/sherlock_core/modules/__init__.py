"""Module registry."""
from __future__ import annotations

import importlib
import logging
import pkgutil

from sherlock_core.modules.base import Module, ModuleContext, Target, new_http_client

log = logging.getLogger(__name__)
_REGISTRY: dict[str, Module] = {}
_loaded = False


def register(cls: type[Module]) -> type[Module]:
    inst = cls()
    if inst.name in _REGISTRY and type(_REGISTRY[inst.name]) is not cls:
        raise ValueError(f"duplicate module name: {inst.name}")
    _REGISTRY[inst.name] = inst
    return cls


def load_builtin() -> None:
    """Import every module file in this package. A module whose optional
    dependency is missing is skipped (it belongs to another worker image)."""
    global _loaded
    if _loaded:
        return
    for m in pkgutil.walk_packages(__path__, prefix=f"{__name__}."):
        if m.name.rsplit(".", 1)[-1] in ("base",):
            continue
        try:
            importlib.import_module(m.name)
        except ImportError as e:
            log.info("module file %s skipped: %s", m.name, e)
    _loaded = True


def all_modules() -> list[Module]:
    load_builtin()
    return sorted(_REGISTRY.values(), key=lambda m: (m.queue, m.name))


def get_module(name: str) -> Module | None:
    load_builtin()
    return _REGISTRY.get(name)


def modules_for(target_type: str, *, only_available: bool = True) -> list[Module]:
    return [
        m for m in all_modules()
        if target_type in m.inputs and (m.available() or not only_available)
    ]


__all__ = [
    "Module", "ModuleContext", "Target", "all_modules", "get_module",
    "load_builtin", "modules_for", "new_http_client", "register",
]
