"""Pydantic models for the API surface. Kept thin — db rows map 1:1."""
from typing import Literal, Optional
from pydantic import BaseModel


class IdentifierIn(BaseModel):
    type: Literal["username", "email", "domain"]
    value: str


class CaseCreate(BaseModel):
    identifiers: list[IdentifierIn]


class CaseOut(BaseModel):
    id: str
    identifiers: list[IdentifierIn]
    status: str
    created_at: str


class FindingOut(BaseModel):
    id: str
    case_id: str
    identifier_type: str
    identifier_value: str
    source_tool: str
    platform: str
    status: str
    extra_metadata: dict
    collected_at: str


class CorrelationOut(BaseModel):
    id: str
    case_id: str
    type: str
    entities_involved: list
    confidence: float
    evidence: list
    priority: float
    reviewed: bool
    review_note: Optional[str] = None
    created_at: str


class ReviewIn(BaseModel):
    decision: Literal["approve", "reject"]
    note: Optional[str] = None


class AuditOut(BaseModel):
    id: int
    case_id: Optional[str] = None
    action: str
    actor: str
    detail: dict
    created_at: str


class ChatIn(BaseModel):
    message: str


class ChatOut(BaseModel):
    text: str
    iterations: int
    tool_calls_made: list[dict]
