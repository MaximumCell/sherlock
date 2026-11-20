"""Operator-panel storage contract (visitor_sessions, search_log, app_settings), run against BOTH stores.

`SupabaseStore` runs on a small in-memory PostgREST fake that applies the same column defaults,
the `trg_search_log_counts` trigger and the `purge_old_search_log` function as 0002_admin.sql.
"""
from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

import pytest
from sherlock_core.models import make_finding, now_iso
from sherlock_core.store import MemoryStore, SupabaseStore, aggregate_searches, safe_query

U1 = "00000000-0000-4000-8000-000000000001"
U2 = "00000000-0000-4000-8000-000000000002"
U3 = "00000000-0000-4000-8000-000000000003"


# ----------------------------------------------------------------------------- PostgREST fake
class _Res:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class _Query:
    def __init__(self, db: _DB, table: str):
        self.db, self.table, self.op, self.payload, self.filters = db, table, "select", None, []
        self.cols: list[str] | None = None
        self.count = None
        self.order_by: list[tuple[str, bool]] = []
        self.window: tuple[int, int] | None = None
        self.on_conflict = ""

    # builders
    def select(self, *cols, count=None, head=None):
        self.op, self.count = "select", count
        joined = ",".join(cols)
        self.cols = None if joined in ("", "*") else [c.strip() for c in joined.split(",")]
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def upsert(self, payload, *, on_conflict="", default_to_null=True, **_):
        self.op, self.payload, self.on_conflict = "upsert", payload, on_conflict
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    # filters
    def _f(self, fn):
        self.filters.append(fn)
        return self

    def eq(self, k, v):
        return self._f(lambda r: r.get(k) == v)

    def gte(self, k, v):
        return self._f(lambda r: r.get(k) is not None and r[k] >= v)

    def lt(self, k, v):
        return self._f(lambda r: r.get(k) is not None and r[k] < v)

    def in_(self, k, vs):
        return self._f(lambda r: r.get(k) in vs)

    def ilike(self, k, pattern):
        rx = re.compile("^" + re.escape(pattern).replace("%", ".*") + "$", re.I)
        return self._f(lambda r: bool(rx.match(str(r.get(k) or ""))))

    def or_(self, expr):
        tests = []
        for part in expr.split(","):
            col, op, val = part.split(".", 2)
            if op == "eq":
                tests.append(lambda r, c=col, v=val: str(r.get(c)) == v)
            elif op == "ilike":
                rx = re.compile("^" + re.escape(val).replace(r"\*", ".*") + "$", re.I)
                tests.append(lambda r, c=col, x=rx: bool(x.match(str(r.get(c) or ""))))
            else:
                raise AssertionError(f"fake does not know {op}")
        return self._f(lambda r: any(t(r) for t in tests))

    def order(self, col, desc=False):
        self.order_by.append((col, desc))
        return self

    def range(self, a, b):
        self.window = (a, b + 1)
        return self

    def limit(self, n):
        self.window = (0, n)
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op in ("insert", "upsert"):
            out = []
            for p in self.payload if isinstance(self.payload, list) else [self.payload]:
                key = self.on_conflict
                old = next((r for r in rows if key and r.get(key) == p.get(key)), None) if self.op == "upsert" else None
                if old is not None:
                    old.update(p)
                    out.append(dict(old))
                    continue
                new = {**self.db.defaults(self.table), **p}
                rows.append(new)
                self.db.after_insert(self.table, new)
                out.append(dict(new))
            return _Res(out)
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in match:
                r.update(self.payload)
            return _Res([dict(r) for r in match])
        if self.op == "delete":
            rows[:] = [r for r in rows if r not in match]
            return _Res(match)
        for col, desc in reversed(self.order_by):
            match.sort(key=lambda r, c=col: (r.get(c) is None, r.get(c)), reverse=desc)
        total = len(match)
        if self.window:
            match = match[self.window[0]:self.window[1]]
        data = [dict(r) if self.cols is None else {c: r.get(c) for c in self.cols} for r in match]
        return _Res(data, total if self.count else None)


class _DB:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.seq = 0

    def defaults(self, table):
        if table == "visitor_sessions":
            return {"first_seen": now_iso(), "last_seen": now_iso(), "is_anonymous": True, "email": None,
                    "ip_hash": None, "country": None, "user_agent": None, "search_count": 0, "refused_count": 0,
                    "blocked": False, "blocked_at": None, "blocked_reason": None}
        if table == "search_log":
            self.seq += 1
            return {"id": self.seq, "created_at": now_iso()}
        if table == "app_settings":
            return {"updated_at": now_iso(), "updated_by": None}
        return {}

    def after_insert(self, table, row):
        if table == "search_log":        # trg_search_log_counts
            for s in self.tables.get("visitor_sessions", []):
                if s["user_id"] == row["user_id"]:
                    s["search_count" if row["outcome"] == "accepted" else "refused_count"] += 1

    def rpc(self, name, params):
        assert name == "purge_old_search_log"
        cutoff = (datetime.now(UTC) - timedelta(days=max(params["p_days"], 1))).isoformat()
        rows = self.tables.setdefault("search_log", [])
        keep = [r for r in rows if r["created_at"] >= cutoff]
        n = len(rows) - len(keep)
        rows[:] = keep
        return type("RPC", (), {"execute": lambda self: _Res(n)})()


def _supabase() -> SupabaseStore:
    db = _DB()
    s = SupabaseStore.__new__(SupabaseStore)
    s.c = type("C", (), {"table": lambda self, name: _Query(db, name), "rpc": lambda self, n, p: db.rpc(n, p)})()
    s._db = db  # type: ignore[attr-defined]
    return s


@pytest.fixture(params=["memory", "supabase"])
def s(request):
    return MemoryStore() if request.param == "memory" else _supabase()


def _age(s, days: float) -> None:
    """Make every stored search row `days` older (test helper reaching into either store)."""
    rows = s.search_log if isinstance(s, MemoryStore) else s._db.tables["search_log"]
    for r in rows:
        r["created_at"] = (datetime.fromisoformat(r["created_at"]) - timedelta(days=days)).isoformat()


def _search(s, user, value, outcome="accepted", type_="username", **extra):
    return s.log_search({"user_id": user, "target_type": type_, "target_value": value, "outcome": outcome,
                         "ip_hash": "abc123abc123abc1", "is_anonymous": True, **extra})


# ----------------------------------------------------------------------------- sessions
def test_touch_session_creates_then_refreshes_without_resetting(s):
    s.touch_session(U1, is_anonymous=True, ip_hash="h1", country="DE", user_agent="x" * 500)
    first = s.get_session(U1)
    assert first["is_anonymous"] is True and first["ip_hash"] == "h1" and first["country"] == "DE"
    assert len(first["user_agent"]) == 300 and first["search_count"] == 0 and first["blocked"] is False
    _search(s, U1, "octocat")
    s.set_session_blocked(U1, True, "harvesting")
    s.touch_session(U1, is_anonymous=False, email="a@example.com")          # origin fields not given
    row = s.get_session(U1)
    assert row["first_seen"] == first["first_seen"] and row["last_seen"] >= first["last_seen"]
    assert row["email"] == "a@example.com" and row["is_anonymous"] is False
    assert row["ip_hash"] == "h1" and row["country"] == "DE"                # kept
    assert row["search_count"] == 1 and row["blocked"] is True             # never reset by a touch
    assert s.get_session(U2) is None and s.get_session("not-a-uuid") is None


def test_block_and_unblock(s):
    assert s.set_session_blocked(U1, True, "x") is None                    # unknown visitor
    s.touch_session(U1, is_anonymous=True)
    row = s.set_session_blocked(U1, True, "many targets")
    assert row["blocked"] is True and row["blocked_reason"] == "many targets" and row["blocked_at"]
    row = s.set_session_blocked(U1, False)
    assert row["blocked"] is False and row["blocked_at"] is None and row["blocked_reason"] is None


def test_list_sessions_filters_and_pages(s):
    for uid, email, ip in ((U1, None, "aaaa"), (U2, "Kit@Example.com", "bbbb"), (U3, None, "aaaa")):
        s.touch_session(uid, is_anonymous=email is None, email=email, ip_hash=ip)
    s.set_session_blocked(U3, True, "spam")
    assert [r["user_id"] for r in s.list_sessions()] == [U3, U2, U1]        # most recent first
    assert [r["user_id"] for r in s.list_sessions(limit=2)] == [U3, U2]
    assert [r["user_id"] for r in s.list_sessions(limit=2, offset=2)] == [U1]
    assert [r["user_id"] for r in s.list_sessions(q="kit@exa")] == [U2]
    assert [r["user_id"] for r in s.list_sessions(q="aaaa")] == [U3, U1]
    assert [r["user_id"] for r in s.list_sessions(q=U1)] == [U1]
    assert [r["user_id"] for r in s.list_sessions(blocked=True)] == [U3]
    assert [r["user_id"] for r in s.list_sessions(user_ids=[U1, U2])] == [U2, U1]
    assert s.list_sessions(user_ids=[]) == []
    assert s.list_sessions(q="a),or(x.eq.1") == []                          # filter syntax is stripped


# ----------------------------------------------------------------------------- search log
def test_log_search_counts_and_rejects_unknown_outcomes(s):
    s.touch_session(U1, is_anonymous=True)
    a = _search(s, U1, "octocat", modules=["handles"], case_id=U3)
    _search(s, U1, "Ada Lovelace", outcome="forbidden", type_="name", detail="needs sign-in")
    _search(s, U1, "x", outcome="rate_limited")
    assert a["id"] and a["created_at"] and a["modules"] == ["handles"] and a["case_id"] == U3
    row = s.get_session(U1)
    assert row["search_count"] == 1 and row["refused_count"] == 2
    with pytest.raises(ValueError):
        _search(s, U1, "x", outcome="maybe")
    _search(s, U2, "no-session-row")                                       # logging never needs a visitor row
    assert s.get_session(U2) is None


def test_list_searches_filters_and_keyset_pagination(s):
    for i in range(5):
        _search(s, U1 if i % 2 else U2, f"user{i}", outcome="accepted" if i < 3 else "rate_limited")
    _search(s, U1, "a@example.com", type_="email")
    rows = s.list_searches()
    assert [r["target_value"] for r in rows] == ["a@example.com", "user4", "user3", "user2", "user1", "user0"]
    page1 = s.list_searches(limit=2)
    page2 = s.list_searches(limit=2, before_id=page1[-1]["id"])
    assert [r["target_value"] for r in page1 + page2] == ["a@example.com", "user4", "user3", "user2"]
    assert {r["target_value"] for r in s.list_searches(outcome="rate_limited")} == {"user3", "user4"}
    assert [r["target_value"] for r in s.list_searches(target_type="email")] == ["a@example.com"]
    assert [r["target_value"] for r in s.list_searches(q="USER1")] == ["user1"]
    assert {r["user_id"] for r in s.list_searches(user_id=U1)} == {U1}
    assert s.list_searches(since=(datetime.now(UTC) + timedelta(minutes=1)).isoformat()) == []


def test_search_log_survives_case_deletion(s):
    case = s.create_case([{"type": "username", "value": "octocat"}], owner_id=U1, title="t") \
        if isinstance(s, MemoryStore) else {"id": U3}
    _search(s, U1, "octocat", case_id=case["id"])
    if isinstance(s, MemoryStore):
        s.delete_case(case["id"])
    else:
        s.detach_case_searches(case["id"])
    [row] = s.list_searches()
    assert row["case_id"] is None and row["target_value"] == "octocat"


def test_purge_keeps_recent_rows(s):
    _search(s, U1, "old")
    _age(s, 91)
    _search(s, U1, "new")
    assert s.purge_search_log(90) == 1
    assert [r["target_value"] for r in s.list_searches()] == ["new"]
    assert s.purge_search_log(90) == 0


def test_search_stats(s):
    _search(s, U1, "octocat")
    _search(s, U2, "octocat")
    _search(s, U2, "octocat", outcome="rate_limited")
    _search(s, U1, "example.com", type_="domain")
    stats = s.search_stats((datetime.now(UTC) - timedelta(days=1)).isoformat())
    today = datetime.now(UTC).date().isoformat()
    assert stats["rows"] == 4 and stats["truncated"] is False
    assert stats["by_day"] == {today: {"accepted": 3, "rate_limited": 1}}
    assert stats["by_type"] == {"username": 3, "domain": 1}
    assert stats["by_outcome"] == {"accepted": 3, "rate_limited": 1}
    assert stats["targets"][0] == {"target_type": "username", "target_value": "octocat", "count": 3, "sessions": 2}
    assert s.search_stats(today, max_rows=2)["truncated"] is True


def test_aggregate_searches_empty():
    assert aggregate_searches([]) == {"rows": 0, "truncated": False, "by_day": {}, "by_type": {}, "by_outcome": {},
                                      "targets": []}


def test_safe_query_strips_filter_syntax():
    assert safe_query("a,b.(c)*%") == "ab.c"
    assert safe_query(None) == "" and len(safe_query("x" * 500)) == 120


# ----------------------------------------------------------------------------- settings, quota, counts
def test_settings(s):
    assert s.get_setting("scans_paused", False) is False
    s.set_setting("scans_paused", True, "op@example.com")
    assert s.get_setting("scans_paused") is True
    s.set_setting("scans_paused", False, "op@example.com")
    assert s.get_setting("scans_paused", True) is False


def test_rate_limit_count_reads_without_counting():
    s = MemoryStore()
    assert s.rate_limit_count("scan:global", 86400) == 0
    s.hit_rate_limit("scan:global", 86400, 10)
    s.hit_rate_limit("scan:global", 86400, 10)
    assert s.rate_limit_count("scan:global", 86400) == 2 == s.rate_limit_count("scan:global", 86400)


def test_rate_limit_count_supabase_reads_current_window():
    s = _supabase()
    from sherlock_core.store import _window_start
    s._db.tables["rate_limits"] = [{"key": "scan:global", "window_start": _window_start(86400).isoformat(), "count": 7},
                                   {"key": "scan:global", "window_start": "2000-01-01T00:00:00+00:00", "count": 99}]
    assert s.rate_limit_count("scan:global", 86400) == 7 and s.rate_limit_count("other", 86400) == 0


def test_case_overview_is_metadata_only():
    s = MemoryStore()
    cid = s.create_case([{"type": "username", "value": "octocat"}], owner_id=U1, title="Me")["id"]
    s.create_case([{"type": "username", "value": "x"}], owner_id=U2, title="Other")
    s.enqueue_jobs([{"case_id": cid, "queue": "identity", "module": "m", "target_type": "username",
                     "target_value": "octocat"}])
    s.upsert_findings([make_finding(case_id=cid, identifier_type="username", identifier_value="octocat",
                                    source_tool="t", platform="github")], cid)
    [row] = s.case_overview(U1)
    assert set(row) == {"id", "title", "identifiers", "status", "created_at", "archived_at", "job_count",
                        "found_count"}
    assert row["job_count"] == 1 and row["found_count"] == 1
    assert s.count_cases() == 2 and s.count_active_jobs() == 1


def test_case_overview_supabase():
    s = _supabase()
    t = s._db.tables
    t["cases"] = [{"id": "c1", "owner_id": U1, "title": "Me", "identifiers": [], "status": "new",
                   "created_at": "2026-01-01", "archived_at": None, "notes": "secret", "is_demo": False},
                  {"id": "c2", "owner_id": U2, "title": "x", "identifiers": [], "status": "new",
                   "created_at": "2026-01-02", "archived_at": None, "is_demo": True}]
    t["jobs"] = [{"id": "j1", "case_id": "c1", "status": "running"}, {"id": "j2", "case_id": "c1", "status": "succeeded"}]
    t["raw_findings"] = [{"id": "f1", "case_id": "c1", "status": "found"}, {"id": "f2", "case_id": "c1", "status": "error"}]
    [row] = s.case_overview(U1)
    assert "notes" not in row and row["job_count"] == 2 and row["found_count"] == 1
    assert s.count_cases() == 1 and s.count_active_jobs() == 1
