"""Misuse flags and chart series: pure functions."""
from datetime import UTC, date, datetime, timedelta

from gateway import insights as I

T0 = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)


def _row(minutes=0, value="kit", type_="username", outcome="accepted", user="u1", ip="h1"):
    return {"created_at": (T0 + timedelta(minutes=minutes)).isoformat(), "target_type": type_,
            "target_value": value, "outcome": outcome, "user_id": user, "ip_hash": ip}


def _flags(rows, ip="h1", targets=None, origins=None):
    return I.session_flags(rows, ip_hash=ip, target_sessions=targets or {}, origin_sessions=origins or {})


def test_quiet_self_check_has_no_flags():
    rows = [_row(0, "kit"), _row(1, "kit@example.com", "email"), _row(3, "kit.example", "domain")]
    assert _flags(rows) == []
    assert _flags([]) == []


def test_burst():
    rows = [_row(i, "kit") for i in range(I.BURST_SEARCHES)]
    [f] = _flags(rows)
    assert f == {"key": "burst", "label": f"{I.BURST_SEARCHES} searches within 10 minutes", "severity": "medium"}
    spread = [_row(i * 3, "kit") for i in range(I.BURST_SEARCHES)]          # 8 searches over 21 minutes
    assert _flags(spread) == []


def test_max_burst_sliding_window():
    assert I.max_burst([]) == 0
    assert I.max_burst([0, 100, 200, 1000, 1001], window_s=600) == 3
    assert I.max_burst([0, 600], window_s=600) == 2


def test_rate_limited():
    rows = [_row(i * 30, "kit", outcome="rate_limited") for i in range(I.RATE_LIMIT_HITS)]
    assert [f["key"] for f in _flags(rows)] == ["rate_limited"]
    assert _flags(rows)[0]["label"] == "Hit the daily limit 3 times"


def test_many_distinct_targets_is_high_and_first():
    rows = [_row(i, f"person{i}") for i in range(I.DISTINCT_TARGETS)]
    flags = _flags(rows)
    assert flags[0]["key"] == "many_targets" and flags[0]["severity"] == "high"
    assert "12 different targets" in flags[0]["label"] and "harvesting" in flags[0]["label"]
    assert "burst" in {f["key"] for f in flags}


def test_refused_name_searches():
    rows = [_row(i * 30, "Ada Lovelace", "name", "forbidden") for i in range(2)]
    assert _flags(rows)[0]["label"] == "Tried 2 name searches without signing in"
    assert _flags(rows[:1]) == []


def test_shared_target_and_shared_origin():
    rows = [_row(0, "kit")]
    flags = _flags(rows, targets={("username", "kit"): 3}, origins={"h1": 4})
    assert [(f["key"], f["label"], f["severity"]) for f in flags] == [
        ("shared_target", "Searched a target that 2 other sessions also searched", "low"),
        ("shared_origin", "Shares an origin with 3 other sessions", "low"),
    ]
    assert _flags(rows, targets={("username", "kit"): 2}, origins={"h1": 2}) == []
    assert _flags(rows, ip=None, origins={"h1": 9}) == []


def test_cross_session_counts():
    rows = [_row(0, "kit", user="a", ip="h1"), _row(1, "kit", user="b", ip="h1"), _row(2, "kit", user="a")]
    assert I.target_session_counts(rows) == {("username", "kit"): 2}
    sessions = [{"user_id": "a", "ip_hash": "h1"}, {"user_id": "c", "ip_hash": "h1"}, {"user_id": "d", "ip_hash": None}]
    assert I.origin_session_counts(sessions, rows) == {"h1": 3}


def test_day_series_zero_fills_every_day_and_outcome():
    series = I.day_series({"2026-11-02": {"accepted": 2, "paused": 1}}, date(2026, 11, 1), 3)
    assert [p["day"] for p in series] == ["2026-11-01", "2026-11-02", "2026-11-03"]
    assert series[1] == {"day": "2026-11-02", "accepted": 2, "rate_limited": 0, "blocked": 0, "paused": 1,
                         "forbidden": 0, "invalid": 0}
    assert sum(series[0][o] for o in I.OUTCOMES) == 0
