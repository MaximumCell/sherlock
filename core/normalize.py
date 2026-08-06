"""Per-collector raw output -> common schema.

Common schema (plan Section 3):
{case_id, identifier_type, identifier_value, source_tool, platform,
 status, extra_metadata, collected_at}
status: found | not_found | error
"""
from datetime import datetime, timezone


def _ts():
    return datetime.now(timezone.utc).isoformat()


def from_user_scanner(result, case_id, identifier_type, identifier_value):
    status = {0: "found", 1: "not_found", 2: "error"}.get(result.status.value)
    if status is None:  # skipped -> drop
        return None
    return {
        "case_id": case_id,
        "identifier_type": identifier_type,
        "identifier_value": identifier_value,
        "source_tool": "user-scanner",
        "platform": result.site_name,
        "status": status,
        "extra_metadata": {
            "category": result.category,
            "url": result.url,
            "reason": str(result.reason) if result.reason else None,
            "extra": result.extra or {},
            "media": result.media or {},
        },
        "collected_at": _ts(),
    }


def from_hudson_rock(hit, case_id, identifier_type, identifier_value):
    return {
        "case_id": case_id,
        "identifier_type": identifier_type,
        "identifier_value": identifier_value,
        "source_tool": "user-scanner",
        "platform": "hudson-rock",
        "status": "found",
        "extra_metadata": {
            "stealer_family": hit.get("stealer_family"),
            "date_compromised": hit.get("date_compromised"),
            "operating_system": hit.get("operating_system"),
            "antiviruses": hit.get("antiviruses", []),
        },
        "collected_at": _ts(),
    }


def from_hibp(breach, case_id, identifier_value):
    return {
        "case_id": case_id,
        "identifier_type": "email",
        "identifier_value": identifier_value,
        "source_tool": "hibp",
        "platform": "breach",
        "status": "found",
        "extra_metadata": {
            "breach_name": breach.get("Name"),
            "breach_date": breach.get("BreachDate"),
            "data_classes": breach.get("DataClasses", []),
            "description": breach.get("Description", "")[:500],
        },
        "collected_at": _ts(),
    }


def from_spiderfoot(event, case_id, identifier_value):
    return {
        "case_id": case_id,
        "identifier_type": "domain",
        "identifier_value": identifier_value,
        "source_tool": "spiderfoot",
        "platform": event.get("type", "unknown"),
        "status": "found",
        "extra_metadata": {
            "event_type": event.get("type"),
            "data": event.get("data", ""),
            "source_module": event.get("source_module"),
            "confidence": event.get("confidence"),
        },
        "collected_at": _ts(),
    }


if __name__ == "__main__":
    class _Fake:
        status = type("S", (), {"value": 0})()

    r = _Fake()
    r.status.value = 0
    r.site_name = "GitHub"
    r.category = "social"
    r.url = "https://github.com/x"
    r.reason = None
    r.extra = {"followers": 1}
    r.media = {}
    out = from_user_scanner(r, "c1", "username", "wintrmute")
    assert out["status"] == "found" and out["platform"] == "GitHub"
    assert from_user_scanner(r, "c1", "username", "x")["collected_at"]
    r.status.value = 3
    assert from_user_scanner(r, "c1", "username", "x") is None
    assert from_hibp({"Name": "Adobe", "DataClasses": ["emails"]}, "c1", "a@b.c")["status"] == "found"
    print("normalize OK")
