"""Request bodies and gateway-only response envelopes.

Row shapes (Case, Job, Finding, Correlation, ModuleInfo) live in `sherlock_core.models`.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sherlock_core.models import Case, Correlation, Entity, Finding, Identifier, Job, TargetType

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


class BatchCancelled(BaseModel):
    batch_id: str
    cancelled: int
    jobs: list[Job]


class QueueStatus(BaseModel):
    """Where a case's search stands in the shared queues. Counts only: never other people's data."""
    case_id: str
    queued: int                # this case's queued jobs
    running: int               # this case's running jobs
    waiting: bool              # queued behind other searches and nothing of it runs yet
    ahead: int                 # other searches that started before it and are still unfinished
    jobs_ahead: int            # their unfinished jobs
    estimated_wait_s: int | None  # rough time until its first job starts (only when waiting)


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


# ----------------------------------------------------------------------------- operator panel (/admin)
SearchOutcome = Literal["accepted", "rate_limited", "blocked", "paused", "forbidden", "invalid",
                        "burst_limited", "active_search", "busy", "sign_in_required"]


class BlockRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


class PauseRequest(BaseModel):
    paused: bool


class AdminMe(BaseModel):
    is_admin: Literal[True]
    email: str


class MisuseFlag(BaseModel):
    key: str
    label: str
    severity: Literal["high", "medium", "low"]


class SessionBrief(BaseModel):
    """Who ran a search, as the feed shows it. `origin` is the ip_hash: never an IP address."""
    user_id: str
    is_anonymous: bool
    email: str | None = None
    user_agent: str | None = None
    country: str | None = None
    origin: str | None = None
    origin_sessions: int = 0           # sessions seen from the same origin, this one included
    blocked: bool = False


class VisitorSession(SessionBrief):
    first_seen: str | None = None
    last_seen: str | None = None
    search_count: int = 0
    refused_count: int = 0
    blocked_at: str | None = None
    blocked_reason: str | None = None
    flags: list[MisuseFlag] = []


class SearchLogRow(BaseModel):
    id: int
    created_at: str
    user_id: str
    case_id: str | None = None
    target_type: str
    target_value: str
    modules: list[str] | None = None
    outcome: SearchOutcome
    detail: str | None = None
    country: str | None = None
    is_anonymous: bool
    session: SessionBrief | None = None


class SearchPage(BaseModel):
    items: list[SearchLogRow]
    next_cursor: str | None = None


class SessionPage(BaseModel):
    items: list[VisitorSession]
    next_cursor: str | None = None


class CaseMeta(BaseModel):
    """A case as metadata only. Findings are never part of the operator panel."""
    id: str
    title: str | None = None
    identifiers: list[Identifier]
    status: str | None = None
    created_at: str | None = None
    archived_at: str | None = None
    job_count: int
    found_count: int


class SessionDetail(BaseModel):
    session: VisitorSession
    searches: list[SearchLogRow]
    cases: list[CaseMeta]


class OverviewTotals(BaseModel):
    searches: int                      # every search attempt in the window, refused ones included
    accepted: int
    refused: int
    sessions: int                      # distinct sessions that searched in the window
    flagged_sessions: int
    cases: int                         # all non-demo cases now
    active_jobs: int                   # queued or running now


class DayPoint(BaseModel):
    day: str
    accepted: int
    rate_limited: int
    blocked: int
    paused: int
    forbidden: int
    invalid: int
    burst_limited: int = 0
    active_search: int = 0
    busy: int = 0
    sign_in_required: int = 0


class TypeCount(BaseModel):
    target_type: str
    count: int


class TargetCount(BaseModel):
    target_type: str
    target_value: str
    count: int
    sessions: int


class Quota(BaseModel):
    global_used_today: int
    global_limit: int
    per_session_limit: int
    name_per_user_limit: int


class Overview(BaseModel):
    days: int
    since: str
    totals: OverviewTotals
    series: list[DayPoint]
    by_type: list[TypeCount]
    top_targets: list[TargetCount]
    quota: Quota
    scans_paused: bool
    retention_days: int
    truncated: bool


class PauseState(BaseModel):
    scans_paused: bool


class AdminCaseView(BaseModel):
    """`GET /admin/cases/{id}`: one visitor's case in full, read-only, for abuse review."""
    case: Case
    findings: list[Finding]
    findings_total: int
    findings_next_offset: int | None
    correlations: list[Correlation]
    entities: list[Entity]
    jobs: list[Job]
    audit: list[dict[str, Any]]
