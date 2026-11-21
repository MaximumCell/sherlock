"""Collector module contract.

A module takes one target (a username, an email, a domain, ...) and returns
finding rows. Modules are deterministic, do no correlation and never call an LLM.

To add a source: subclass `Module`, decorate it with `@register`, put the file in
`sherlock_core/modules/`. The worker, the gateway's `GET /modules` and the UI pick
it up from the registry.
"""
from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, ClassVar

import httpx

from sherlock_core.models import ModuleInfo, make_finding

DEFAULT_UA = "sherlock-osint/2.0 (+https://github.com/MaximumCell/sherlock)"


@dataclass(frozen=True)
class Target:
    type: str
    value: str
    params: dict[str, Any] = field(default_factory=dict)


ProgressFn = Callable[[int, str | None], Awaitable[None]]


async def _no_progress(pct: int, note: str | None = None) -> None:
    return None


@dataclass
class ModuleContext:
    """Everything a module may touch. Tests pass a fake `http` (respx) and no progress."""

    case_id: str
    http: httpx.AsyncClient
    job_id: str | None = None
    progress: ProgressFn = _no_progress
    log: logging.Logger = field(default_factory=lambda: logging.getLogger("sherlock.module"))
    max_concurrency: int = 20

    def finding(self, module: Module, target: Target, *, platform: str, **kw: Any) -> dict[str, Any]:
        """Build a finding for `target` attributed to `module` (see models.make_finding)."""
        kw.setdefault("source_tool", module.name)
        return make_finding(
            case_id=self.case_id,
            identifier_type=target.type,
            identifier_value=target.value,
            platform=platform,
            module=module.name,
            **kw,
        )


class Module(ABC):
    name: ClassVar[str]                    # registry key, snake_case
    title: ClassVar[str]                   # shown in the UI
    description: ClassVar[str]
    inputs: ClassVar[tuple[str, ...]]      # target types it accepts
    queue: ClassVar[str]                   # identity | infra | media
    requires_env: ClassVar[tuple[str, ...]] = ()
    source_url: ClassVar[str | None] = None
    timeout_s: ClassVar[float] = 120.0     # hard cap enforced by the worker
    # Memory-heavy (hundreds of MB): a worker runs at most one heavy job at a time.
    heavy: ClassVar[bool] = False

    def available(self) -> bool:
        return all(os.getenv(k) for k in self.requires_env)

    def info(self) -> ModuleInfo:
        return ModuleInfo(
            name=self.name, title=self.title, description=self.description,
            inputs=list(self.inputs), queue=self.queue,  # type: ignore[arg-type]
            requires_env=list(self.requires_env), available=self.available(),
            source_url=self.source_url,
        )

    @abstractmethod
    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        """Return finding rows. Raise on total failure; the worker records it and retries."""


def new_http_client(timeout: float = 15.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=timeout, follow_redirects=True, headers={"User-Agent": DEFAULT_UA},
        limits=httpx.Limits(max_connections=40, max_keepalive_connections=10),
    )
