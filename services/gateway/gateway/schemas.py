"""Request bodies and gateway-only response envelopes.

Row shapes (Case, Job, Finding, Correlation, ModuleInfo) live in `sherlock_core.models`.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sherlock_core.models import Case, Entity, Identifier, Job, TargetType

# ----------------------------------------------------------------------------- requests
_Hint = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
_Keyword = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class NameHints(BaseModel):
    """Optional disambiguation hints for a name search. They narrow and rank, they are not searched alone.

    City level only: there is deliberately no field for a street address, phone number or relatives.
    """
    model_config = ConfigDict(extra="forbid")

    city: _Hint | None = None
    employer: _Hint | None = None
    school: _Hint | None = None
    keywords: list[_Keyword] = Field(default_factory=list, max_length=8)

    def params(self) -> dict[str, Any]:
        """The job `params` (empty values dropped); modules read them as `Target.params`."""
        return {k: v for k, v in self.model_dump().items() if v}


class CaseCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=20)
    identifiers: list[Identifier] = Field(min_length=1, max_length=10)
    scan: bool = True
    hints: NameHints | None = None        # applies to the `name` identifiers only


class CasePatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=20000)
    tags: list[str] | None = Field(default=None, max_length=20)
    archived: bool | None = None


class ScanRequest(BaseModel):
    type: TargetType
    value: str = Field(min_length=1, max_length=2048)
    modules: list[str] | None = Field(default=None, max_length=50)
    hints: NameHints | None = None        # only with type = "name"


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


class PlatformOut(BaseModel):
    """One entry of `GET /platforms` (see `sherlock_core.platforms`)."""
    key: str
    label: str
    domain: str
    category: Literal["social", "dev", "video", "music", "gaming", "forum", "shopping", "professional", "other"]
    aliases: list[str] = []
    hosts: list[str] = []


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


class ExposureFactor(BaseModel):
    key: str
    label: str
    points: float
    max_points: int
    detail: str
    evidence_finding_ids: list[str]
    remediation: list[str]


class ExposureComputedFrom(BaseModel):
    findings: int
    approved_correlations: int


class ExposureOut(BaseModel):
    """`sherlock_core.scoring.score_exposure` output."""
    score: int = Field(ge=0, le=100)
    band: Literal["low", "moderate", "high", "severe"]
    factors: list[ExposureFactor]
    computed_from: ExposureComputedFrom
    method: str


class CandidateHandle(BaseModel):
    platform: str
    handle: str


class CandidateAttributes(BaseModel):
    names: list[str]
    description: str | None = None
    employers: list[str]
    education: list[str]
    locations: list[str]                  # city / country level only
    handles: list[CandidateHandle]
    emails: list[str]
    links: list[str]
    domains: list[str]
    topics: list[str]
    identifiers: dict[str, str]           # orcid, wikidata, openalex, companieshouse, ...
    sources: list[str]


class CandidateOut(BaseModel):
    """`sherlock_core.resolve.Candidate`: one distinct person among a name search's findings."""
    candidate_id: str
    label: str
    score: float = Field(ge=0, le=1)
    evidence: list[str]
    finding_ids: list[str]
    attributes: CandidateAttributes
    related: list[str] = []


class CandidatesOut(BaseModel):
    name: str
    hints: dict[str, Any]
    candidates: list[CandidateOut]
    unassigned_finding_ids: list[str]     # news / mentions that fit no single candidate


class CandidateConfirmed(BaseModel):
    candidate: CandidateOut
    entities: list[Entity]                # newly added pivot suggestions (not scanned, no scan started)


class ErrorOut(BaseModel):
    detail: str
