"""Shared data contracts. Every service and the generated TypeScript types derive from these.

Rows are passed around as plain dicts that match these models (the storage layer
returns PostgREST JSON); the models are used at API boundaries for validation and
for OpenAPI generation.
"""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

TargetType = Literal["username", "email", "domain", "ip", "image", "phone", "wallet", "name"]
TARGET_TYPES: tuple[str, ...] = ("username", "email", "domain", "ip", "image", "phone", "wallet", "name")

Queue = Literal["identity", "infra", "media"]
QUEUES: tuple[str, ...] = ("identity", "infra", "media")

FindingStatus = Literal["found", "not_found", "error"]
JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
CorrelationStatus = Literal["pending", "approved", "rejected"]


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def finding_key(source_tool: str, platform: str, identifier_value: str, discriminator: str = "") -> str:
    """Stable identity of a finding inside a case.

    `discriminator` separates several rows from one source about one identifier,
    e.g. the breach name, so two breaches for one email are two rows.
    """
    raw = "|".join((source_tool, platform, identifier_value.strip().lower(), discriminator))
    return hashlib.sha256(raw.encode()).hexdigest()


def make_finding(
    *,
    case_id: str,
    identifier_type: str,
    identifier_value: str,
    source_tool: str,
    platform: str,
    status: FindingStatus = "found",
    url: str | None = None,
    extra: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
    discriminator: str = "",
    module: str | None = None,
) -> dict[str, Any]:
    """Build a finding row in the one canonical shape.

    extra_metadata = {"url": <profile/source url>, "extra": {<source fields>}, **meta}
    Profile-like fields (bio, fullname, location, email, links, avatar_url, ...) go in `extra`.
    """
    extra_metadata: dict[str, Any] = {"url": url, "extra": extra or {}}
    if meta:
        extra_metadata.update(meta)
    return {
        "case_id": case_id,
        "identifier_type": identifier_type,
        "identifier_value": identifier_value,
        "source_tool": source_tool,
        "module": module or source_tool,
        "platform": platform,
        "status": status,
        "finding_key": finding_key(source_tool, platform, identifier_value, discriminator),
        "extra_metadata": extra_metadata,
        "collected_at": now_iso(),
    }


# ----------------------------------------------------------------------------- API models
class Identifier(BaseModel):
    type: TargetType
    value: str = Field(min_length=1, max_length=320)


class Case(BaseModel):
    id: str
    title: str | None = None
    notes: str = ""
    tags: list[str] = []
    identifiers: list[Identifier]
    status: str
    owner_id: str | None = None
    is_demo: bool = False
    created_at: str
    updated_at: str | None = None
    archived_at: str | None = None


class Finding(BaseModel):
    id: str
    case_id: str
    identifier_type: str
    identifier_value: str
    source_tool: str
    module: str | None = None
    platform: str
    status: FindingStatus
    finding_key: str
    extra_metadata: dict[str, Any] = {}
    curated: bool = False
    job_id: str | None = None
    collected_at: str


class Correlation(BaseModel):
    id: str
    case_id: str
    type: str  # rule name
    corr_key: str
    matched_value: str | None = None
    entities_involved: list[str]  # finding ids
    confidence: float
    evidence: list[Any]
    priority: float
    status: CorrelationStatus
    reviewed: bool = False
    review_note: str | None = None
    reviewed_at: str | None = None
    created_at: str


class Job(BaseModel):
    id: str
    case_id: str
    batch_id: str | None = None
    queue: Queue
    module: str
    target_type: str
    target_value: str
    params: dict[str, Any] = {}
    status: JobStatus
    progress: int = 0
    progress_note: str | None = None
    attempts: int = 0
    max_attempts: int = 3
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None


class Entity(BaseModel):
    id: str
    case_id: str
    kind: str
    value: str
    platform: str | None = None
    source_finding_id: str | None = None
    is_seed: bool = False
    scanned: bool = False
    first_seen: str


class ModuleInfo(BaseModel):
    name: str
    title: str
    description: str
    inputs: list[str]
    queue: Queue
    requires_env: list[str] = []
    available: bool = True
    source_url: str | None = None
