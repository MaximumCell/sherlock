"""Storage layer. Everything that touches the database goes through a `Store`.

`SupabaseStore` talks to Supabase (PostgREST + RPC) with the service key.
`MemoryStore` implements the same behaviour in memory for offline tests.

Use `get_store()` in application code; tests call `set_store(MemoryStore())`.
"""
from __future__ import annotations

import copy
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sherlock_core import config
from sherlock_core.models import finding_key, now_iso

Row = dict[str, Any]
PAGE = 1000  # PostgREST caps responses at 1000 rows


def _discriminator(f: Row) -> str:
    """Separates multiple rows from one source about one identifier (legacy collectors)."""
    meta = f.get("extra_metadata") or {}
    return str(meta.get("breach_name") or meta.get("date_compromised") or "")


def prepare_finding(f: Row, case_id: str, job_id: str | None = None) -> Row:
    row = {k: v for k, v in f.items() if k not in ("id", "curated")}
    row["case_id"] = case_id
    row.setdefault("module", row.get("source_tool"))
    if not row.get("finding_key"):
        row["finding_key"] = finding_key(
            row["source_tool"], row["platform"], row["identifier_value"], _discriminator(row)
        )
    if job_id:
        row["job_id"] = job_id
    return row


class Store:
    """Interface. Method docs here are the contract for both implementations."""

    # ---- cases
    def create_case(self, identifiers: list[Row], *, owner_id: str | None = None,
                    title: str | None = None, tags: list[str] | None = None) -> Row: raise NotImplementedError
    def get_case(self, case_id: str) -> Row | None: raise NotImplementedError
    def list_cases(self, owner_id: str | None) -> list[Row]: raise NotImplementedError
    def update_case(self, case_id: str, fields: Row) -> Row | None: raise NotImplementedError
    def delete_case(self, case_id: str) -> None: raise NotImplementedError

    # ---- findings
    def upsert_findings(self, findings: list[Row], case_id: str, job_id: str | None = None) -> list[Row]:
        """Insert or update by (case_id, finding_key). Never touches `curated`."""
        raise NotImplementedError
    def list_findings(self, case_id: str, *, status: str | None = None,
                      curated: bool | None = None) -> list[Row]: raise NotImplementedError
    def set_curated(self, finding_id: str, curated: bool) -> Row | None: raise NotImplementedError

    # ---- correlations
    def sync_correlations(self, case_id: str, corrs: list[Row]) -> list[Row]:
        """Make the stored engine correlations match `corrs`, keyed by corr_key.

        New keys are inserted as pending. Existing keys get fresh evidence,
        confidence and members but KEEP status / review_note / reviewed_at.
        Pending rows the engine no longer produces are deleted; approved and
        rejected rows are kept (a human decided on them). Manual links
        (corr_key starting with 'manual:') are never touched. Returns all rows.
        """
        raise NotImplementedError
    def insert_correlation(self, corr: Row, case_id: str) -> Row: raise NotImplementedError
    def list_correlations(self, case_id: str, *, status: str | None = None) -> list[Row]: raise NotImplementedError
    def set_correlation_status(self, correlation_id: str, status: str,
                               note: str | None = None) -> Row | None: raise NotImplementedError

    # ---- entities
    def upsert_entities(self, case_id: str, entities: list[Row]) -> None:
        """Insert by (case_id, kind, value); existing rows are left alone."""
        raise NotImplementedError
    def list_entities(self, case_id: str) -> list[Row]: raise NotImplementedError
    def mark_entity_scanned(self, case_id: str, kind: str, value: str) -> None: raise NotImplementedError

    # ---- jobs
    def enqueue_jobs(self, jobs: list[Row]) -> list[Row]: raise NotImplementedError
    def claim_job(self, queue: str, worker: str) -> Row | None:
        """Atomically take the oldest queued job; requeue/fail jobs with a stale heartbeat."""
        raise NotImplementedError
    def heartbeat(self, job_id: str, progress: int | None = None, note: str | None = None) -> None: raise NotImplementedError
    def complete_job(self, job_id: str, result: Row) -> None: raise NotImplementedError
    def fail_job(self, job_id: str, error: str, *, retry: bool = True, delay_s: int = 15) -> Row | None:
        """retry=True requeues while attempts < max_attempts, otherwise marks failed."""
        raise NotImplementedError
    def get_job(self, job_id: str) -> Row | None: raise NotImplementedError
    def list_jobs(self, case_id: str, *, active_only: bool = False) -> list[Row]: raise NotImplementedError
    def queued_queues(self) -> set[str]:
        """Queues that currently have queued jobs (used to decide which workers to wake)."""
        raise NotImplementedError

    # ---- misc
    def log(self, case_id: str | None, action: str, actor: str, detail: Row | None = None) -> None: raise NotImplementedError
    def list_audit(self, case_id: str | None = None, limit: int = 200) -> list[Row]: raise NotImplementedError
    def hit_rate_limit(self, key: str, window_s: int, limit: int) -> bool:
        """Count one hit; True while the caller is within `limit` for the window."""
        raise NotImplementedError


_CORR_ENGINE_FIELDS = ("type", "matched_value", "entities_involved", "confidence", "evidence", "priority")


class SupabaseStore(Store):
    def __init__(self, url: str | None = None, key: str | None = None):
        url, key = url or config.SUPABASE_URL, key or config.SUPABASE_SERVICE_KEY
        if not url or not key:
            raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY are not set")
        from supabase import create_client
        self.c = create_client(url, key)

    def _t(self, name: str):
        return self.c.table(name)

    @staticmethod
    def _all(query) -> list[Row]:
        rows: list[Row] = []
        start = 0
        while True:
            page = query.range(start, start + PAGE - 1).execute().data or []
            rows.extend(page)
            if len(page) < PAGE:
                return rows
            start += PAGE

    @staticmethod
    def _one(res) -> Row | None:
        return res.data[0] if res.data else None

    # ---- cases
    def create_case(self, identifiers, *, owner_id=None, title=None, tags=None):
        row = {"identifiers": identifiers, "owner_id": owner_id, "title": title, "tags": tags or []}
        return self._t("cases").insert(row).execute().data[0]

    def get_case(self, case_id):
        return self._one(self._t("cases").select("*").eq("id", case_id).execute())

    def list_cases(self, owner_id):
        q = self._t("cases").select("*").order("created_at", desc=True)
        q = q.eq("owner_id", owner_id) if owner_id else q.is_("owner_id", "null")
        return self._all(q)

    def update_case(self, case_id, fields):
        return self._one(self._t("cases").update(fields).eq("id", case_id).execute())

    def delete_case(self, case_id):
        self._t("cases").delete().eq("id", case_id).execute()

    # ---- findings
    def upsert_findings(self, findings, case_id, job_id=None):
        if not findings:
            return []
        dedup: dict[str, Row] = {}
        for f in findings:
            row = prepare_finding(f, case_id, job_id)
            dedup[row["finding_key"]] = row
        rows = list(dedup.values())
        out: list[Row] = []
        for i in range(0, len(rows), 500):
            res = self._t("raw_findings").upsert(rows[i:i + 500], on_conflict="case_id,finding_key").execute()
            out.extend(res.data or [])
        return out

    def list_findings(self, case_id, *, status=None, curated=None):
        q = self._t("raw_findings").select("*").eq("case_id", case_id)
        if status:
            q = q.eq("status", status)
        if curated is not None:
            q = q.eq("curated", curated)
        return self._all(q.order("collected_at"))

    def set_curated(self, finding_id, curated):
        return self._one(self._t("raw_findings").update({"curated": curated}).eq("id", finding_id).execute())

    # ---- correlations
    def sync_correlations(self, case_id, corrs):
        existing = {r["corr_key"]: r for r in self.list_correlations(case_id)}
        wanted = {c["corr_key"]: c for c in corrs}
        new_rows = [
            {**{k: c.get(k) for k in _CORR_ENGINE_FIELDS}, "corr_key": k, "case_id": case_id}
            for k, c in wanted.items() if k not in existing
        ]
        if new_rows:
            self._t("correlations").insert(new_rows).execute()
        for k, c in wanted.items():
            old = existing.get(k)
            if old and any(old.get(f) != c.get(f) for f in _CORR_ENGINE_FIELDS):
                self._t("correlations").update({f: c.get(f) for f in _CORR_ENGINE_FIELDS}).eq("id", old["id"]).execute()
        stale = [
            r["id"] for k, r in existing.items()
            if k not in wanted and r["status"] == "pending" and not k.startswith("manual:")
        ]
        for i in range(0, len(stale), 100):
            self._t("correlations").delete().in_("id", stale[i:i + 100]).execute()
        return self.list_correlations(case_id)

    def insert_correlation(self, corr, case_id):
        return self._t("correlations").insert({**corr, "case_id": case_id}).execute().data[0]

    def list_correlations(self, case_id, *, status=None):
        q = self._t("correlations").select("*").eq("case_id", case_id)
        if status:
            q = q.eq("status", status)
        return self._all(q.order("priority", desc=True))

    def set_correlation_status(self, correlation_id, status, note=None):
        upd: Row = {"status": status, "reviewed_at": None if status == "pending" else now_iso()}
        if note is not None:
            upd["review_note"] = note
        return self._one(self._t("correlations").update(upd).eq("id", correlation_id).execute())

    # ---- entities
    def upsert_entities(self, case_id, entities):
        if not entities:
            return
        rows = [{**e, "case_id": case_id} for e in entities]
        self._t("entities").upsert(rows, on_conflict="case_id,kind,value", ignore_duplicates=True).execute()

    def list_entities(self, case_id):
        return self._all(self._t("entities").select("*").eq("case_id", case_id).order("first_seen"))

    def mark_entity_scanned(self, case_id, kind, value):
        self._t("entities").update({"scanned": True}).eq("case_id", case_id).eq("kind", kind).eq("value", value).execute()

    # ---- jobs
    def enqueue_jobs(self, jobs):
        return self._t("jobs").insert(jobs).execute().data if jobs else []

    def claim_job(self, queue, worker):
        res = self.c.rpc("claim_job", {
            "p_queue": queue, "p_worker": worker, "p_stale_seconds": config.JOB_STALE_SECONDS,
        }).execute()
        return res.data[0] if res.data else None

    def heartbeat(self, job_id, progress=None, note=None):
        upd: Row = {"heartbeat_at": now_iso()}
        if progress is not None:
            upd["progress"] = max(0, min(100, int(progress)))
        if note is not None:
            upd["progress_note"] = note
        self._t("jobs").update(upd).eq("id", job_id).eq("status", "running").execute()

    def complete_job(self, job_id, result):
        self._t("jobs").update({
            "status": "succeeded", "progress": 100, "result": result,
            "finished_at": now_iso(), "locked_by": None,
        }).eq("id", job_id).execute()

    def fail_job(self, job_id, error, *, retry=True, delay_s=15):
        job = self.get_job(job_id)
        if not job:
            return None
        if retry and job["attempts"] < job["max_attempts"]:
            upd: Row = {
                "status": "queued", "error": error[:2000], "locked_by": None,
                "run_after": (datetime.now(UTC) + timedelta(seconds=delay_s * job["attempts"])).isoformat(),
            }
        else:
            upd = {"status": "failed", "error": error[:2000], "finished_at": now_iso(), "locked_by": None}
        return self._one(self._t("jobs").update(upd).eq("id", job_id).execute())

    def get_job(self, job_id):
        return self._one(self._t("jobs").select("*").eq("id", job_id).execute())

    def list_jobs(self, case_id, *, active_only=False):
        q = self._t("jobs").select("*").eq("case_id", case_id)
        if active_only:
            q = q.in_("status", ["queued", "running"])
        return self._all(q.order("created_at", desc=True))

    def queued_queues(self):
        rows = self._t("jobs").select("queue").eq("status", "queued").limit(200).execute().data or []
        return {r["queue"] for r in rows}

    # ---- misc
    def log(self, case_id, action, actor, detail=None):
        self._t("audit_log").insert({
            "case_id": case_id, "action": action, "actor": actor, "detail": detail or {},
        }).execute()

    def list_audit(self, case_id=None, limit=200):
        q = self._t("audit_log").select("*").order("created_at", desc=True).limit(limit)
        if case_id:
            q = q.eq("case_id", case_id)
        return q.execute().data or []

    def hit_rate_limit(self, key, window_s, limit):
        res = self.c.rpc("hit_rate_limit", {"p_key": key, "p_window_seconds": window_s, "p_limit": limit}).execute()
        return bool(res.data)


class MemoryStore(Store):
    """In-memory Store with the same semantics, for offline tests."""

    def __init__(self) -> None:
        self.cases: dict[str, Row] = {}
        self.findings: dict[str, Row] = {}
        self.correlations: dict[str, Row] = {}
        self.entities: dict[tuple[str, str, str], Row] = {}
        self.jobs: dict[str, Row] = {}
        self.audit: list[Row] = []
        self.rate: dict[tuple[str, int], int] = {}
        self.stale_seconds = config.JOB_STALE_SECONDS

    @staticmethod
    def _id() -> str:
        return str(uuid.uuid4())

    @staticmethod
    def _cp(row: Row | None) -> Row | None:
        return copy.deepcopy(row) if row else None

    # ---- cases
    def create_case(self, identifiers, *, owner_id=None, title=None, tags=None):
        row = {
            "id": self._id(), "identifiers": identifiers, "owner_id": owner_id, "title": title,
            "tags": tags or [], "notes": "", "status": "new", "is_demo": False,
            "created_at": now_iso(), "updated_at": now_iso(), "archived_at": None,
        }
        self.cases[row["id"]] = row
        return copy.deepcopy(row)

    def get_case(self, case_id):
        return self._cp(self.cases.get(case_id))

    def list_cases(self, owner_id):
        rows = [c for c in self.cases.values() if c["owner_id"] == owner_id]
        return copy.deepcopy(sorted(rows, key=lambda c: c["created_at"], reverse=True))

    def update_case(self, case_id, fields):
        if case_id not in self.cases:
            return None
        self.cases[case_id].update(fields, updated_at=now_iso())
        return self.get_case(case_id)

    def delete_case(self, case_id):
        self.cases.pop(case_id, None)
        for table in (self.findings, self.correlations, self.jobs):
            for k in [k for k, r in table.items() if r["case_id"] == case_id]:
                del table[k]
        for k in [k for k in self.entities if k[0] == case_id]:
            del self.entities[k]

    # ---- findings
    def upsert_findings(self, findings, case_id, job_id=None):
        out = []
        for f in findings:
            row = prepare_finding(f, case_id, job_id)
            old = next((r for r in self.findings.values()
                        if r["case_id"] == case_id and r["finding_key"] == row["finding_key"]), None)
            if old:
                old.update(row)
                out.append(copy.deepcopy(old))
            else:
                row = {"id": self._id(), "curated": False, "job_id": None, **row}
                self.findings[row["id"]] = row
                out.append(copy.deepcopy(row))
        return out

    def list_findings(self, case_id, *, status=None, curated=None):
        rows = [r for r in self.findings.values() if r["case_id"] == case_id
                and (status is None or r["status"] == status)
                and (curated is None or r["curated"] == curated)]
        return copy.deepcopy(rows)

    def set_curated(self, finding_id, curated):
        if finding_id not in self.findings:
            return None
        self.findings[finding_id]["curated"] = curated
        return self._cp(self.findings[finding_id])

    # ---- correlations
    def _new_corr(self, corr: Row, case_id: str) -> Row:
        row = {
            "id": self._id(), "case_id": case_id, "status": "pending", "review_note": None,
            "reviewed_at": None, "matched_value": None, "created_at": now_iso(), **corr,
        }
        row["reviewed"] = row["status"] == "approved"
        self.correlations[row["id"]] = row
        return row

    def sync_correlations(self, case_id, corrs):
        existing = {r["corr_key"]: r for r in self.correlations.values() if r["case_id"] == case_id}
        wanted = {c["corr_key"]: c for c in corrs}
        for k, c in wanted.items():
            fields = {f: c.get(f) for f in _CORR_ENGINE_FIELDS}
            if k in existing:
                existing[k].update(fields)
            else:
                self._new_corr({**fields, "corr_key": k}, case_id)
        for k, r in existing.items():
            if k not in wanted and r["status"] == "pending" and not k.startswith("manual:"):
                del self.correlations[r["id"]]
        return self.list_correlations(case_id)

    def insert_correlation(self, corr, case_id):
        return copy.deepcopy(self._new_corr(dict(corr), case_id))

    def list_correlations(self, case_id, *, status=None):
        rows = [r for r in self.correlations.values() if r["case_id"] == case_id
                and (status is None or r["status"] == status)]
        return copy.deepcopy(sorted(rows, key=lambda r: r.get("priority") or 0, reverse=True))

    def set_correlation_status(self, correlation_id, status, note=None):
        r = self.correlations.get(correlation_id)
        if not r:
            return None
        r.update(status=status, reviewed=status == "approved",
                 reviewed_at=None if status == "pending" else now_iso())
        if note is not None:
            r["review_note"] = note
        return copy.deepcopy(r)

    # ---- entities
    def upsert_entities(self, case_id, entities):
        for e in entities:
            key = (case_id, e["kind"], e["value"])
            if key not in self.entities:
                self.entities[key] = {
                    "id": self._id(), "case_id": case_id, "platform": None, "source_finding_id": None,
                    "is_seed": False, "scanned": False, "first_seen": now_iso(), **e,
                }

    def list_entities(self, case_id):
        return copy.deepcopy([e for k, e in self.entities.items() if k[0] == case_id])

    def mark_entity_scanned(self, case_id, kind, value):
        if (case_id, kind, value) in self.entities:
            self.entities[(case_id, kind, value)]["scanned"] = True

    # ---- jobs
    def enqueue_jobs(self, jobs):
        out = []
        for j in jobs:
            row = {
                "id": self._id(), "batch_id": None, "params": {}, "status": "queued", "progress": 0,
                "progress_note": None, "attempts": 0, "max_attempts": 3, "locked_by": None,
                "heartbeat_at": None, "run_after": now_iso(), "result": None, "error": None,
                "created_at": now_iso(), "started_at": None, "finished_at": None, **j,
            }
            self.jobs[row["id"]] = row
            out.append(copy.deepcopy(row))
        return out

    def claim_job(self, queue, worker):
        now = datetime.now(UTC)
        for j in self.jobs.values():
            if (j["queue"] == queue and j["status"] == "running" and j["heartbeat_at"]
                    and datetime.fromisoformat(j["heartbeat_at"]) < now - timedelta(seconds=self.stale_seconds)):
                if j["attempts"] >= j["max_attempts"]:
                    j.update(status="failed", error="worker lost: no heartbeat", finished_at=now_iso(), locked_by=None)
                else:
                    j.update(status="queued", locked_by=None)
        ready = [j for j in self.jobs.values() if j["queue"] == queue and j["status"] == "queued"
                 and datetime.fromisoformat(j["run_after"]) <= now]
        if not ready:
            return None
        j = min(ready, key=lambda r: r["created_at"])
        j.update(status="running", locked_by=worker, attempts=j["attempts"] + 1,
                 started_at=j["started_at"] or now_iso(), heartbeat_at=now_iso(), error=None)
        return copy.deepcopy(j)

    def heartbeat(self, job_id, progress=None, note=None):
        j = self.jobs.get(job_id)
        if not j or j["status"] != "running":
            return
        j["heartbeat_at"] = now_iso()
        if progress is not None:
            j["progress"] = max(0, min(100, int(progress)))
        if note is not None:
            j["progress_note"] = note

    def complete_job(self, job_id, result):
        if job_id in self.jobs:
            self.jobs[job_id].update(status="succeeded", progress=100, result=result,
                                     finished_at=now_iso(), locked_by=None)

    def fail_job(self, job_id, error, *, retry=True, delay_s=15):
        j = self.jobs.get(job_id)
        if not j:
            return None
        if retry and j["attempts"] < j["max_attempts"]:
            run_after = datetime.now(UTC) + timedelta(seconds=delay_s * j["attempts"])
            j.update(status="queued", error=error[:2000], locked_by=None, run_after=run_after.isoformat())
        else:
            j.update(status="failed", error=error[:2000], finished_at=now_iso(), locked_by=None)
        return copy.deepcopy(j)

    def get_job(self, job_id):
        return self._cp(self.jobs.get(job_id))

    def list_jobs(self, case_id, *, active_only=False):
        rows = [j for j in self.jobs.values() if j["case_id"] == case_id
                and (not active_only or j["status"] in ("queued", "running"))]
        return copy.deepcopy(sorted(rows, key=lambda j: j["created_at"], reverse=True))

    def queued_queues(self):
        return {j["queue"] for j in self.jobs.values() if j["status"] == "queued"}

    # ---- misc
    def log(self, case_id, action, actor, detail=None):
        self.audit.append({"id": len(self.audit) + 1, "case_id": case_id, "action": action,
                           "actor": actor, "detail": detail or {}, "created_at": now_iso()})

    def list_audit(self, case_id=None, limit=200):
        rows = [a for a in self.audit if case_id is None or a["case_id"] == case_id]
        return copy.deepcopy(rows[::-1][:limit])

    def hit_rate_limit(self, key, window_s, limit):
        bucket = (key, int(datetime.now(UTC).timestamp() // window_s))
        self.rate[bucket] = self.rate.get(bucket, 0) + 1
        return self.rate[bucket] <= limit


_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        _store = SupabaseStore()
    return _store


def set_store(store: Store | None) -> None:
    global _store
    _store = store
