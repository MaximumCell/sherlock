"""Request bodies and gateway-only response envelopes.

Row shapes (Case, Job, Finding, Correlation, ModuleInfo) live in `sherlock_core.models`.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field
from sherlock_core.models import Case, Identifier, Job, TargetType


# ----------------------------------------------------------------------------- requests
class CaseCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=20)
    identifiers: list[Identifier] = Field(min_length=1, max_length=10)
    scan: bool = True


class CasePatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=20000)
    tags: list[str] | None = Field(default=None, max_length=20)
    archived: bool | None = None


class ScanRequest(BaseModel):
    type: TargetType
    value: str = Field(min_length=1, max_length=2048)
    modules: list[str] | None = Field(default=None, max_length=50)


class CurateRequest(BaseModel):
    curated: bool


class ManualLinkRequest(BaseModel):
    finding_ids: list[str] = Field(min_length=2, max_length=50)
    note: str | None = Field(default=None, max_length=2000)


class ReviewRequest(BaseModel):
    decision: Literal["approve", "reject", "reset"]
    note: str | None = Field(default=None, max_length=2000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


# ----------------------------------------------------------------------------- responses
class Health(BaseModel):
    ok: bool
    service: str


class CaseCreated(BaseModel):
    case: Case
    jobs: list[Job]


class ScanAccepted(BaseModel):
    batch_id: str
    jobs: list[Job]


class WakeResult(BaseModel):
    queues: list[str]


class CorrelateResult(BaseModel):
    correlations: int


class VariationsOut(BaseModel):
    variations: list[str]


class ChatOut(BaseModel):
    text: str
    iterations: int
    tool_calls_made: list[dict[str, Any]]


class ErrorOut(BaseModel):
    detail: str
