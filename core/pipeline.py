"""Run a full case: collect -> upsert -> correlate -> insert. One failing tool never aborts."""
from core import db, correlate
from core.collectors import hibp_wrapper, spiderfoot_wrapper, user_scanner_wrapper


def _safe_hibp(email, case_id):
    try:
        return hibp_wrapper.check(email, case_id)
    except Exception as e:
        db.log(case_id, "collector_run", "hibp", {"error": str(e)})
        return []


def _collectors():
    return {
        "username": lambda v, cid: user_scanner_wrapper.scan(v, False, cid),
        "email": lambda v, cid: user_scanner_wrapper.scan(v, True, cid) + _safe_hibp(v, cid),
        "domain": spiderfoot_wrapper.scan,
    }


def run_case(identifiers: list[dict], store=None):
    store = store or db
    case_id = store.create_case(identifiers)
    store.update_case_status(case_id, "running")
    for ident in identifiers:
        itype, ivalue = ident["type"], ident["value"]
        fn = _collectors().get(itype)
        if not fn:
            store.log(case_id, "collector_run", "none", {"error": f"unknown type {itype}"})
            continue
        try:
            findings = fn(ivalue, case_id)
            store.upsert_findings(findings, case_id)
            store.log(case_id, "collector_run", "collector", {"type": itype, "value": ivalue, "findings": len(findings)})
        except Exception as e:
            store.log(case_id, "collector_run", itype, {"value": ivalue, "error": str(e)})
    findings = store.list_findings(case_id)
    corrs = correlate.correlate(case_id, findings)
    store.insert_correlations(corrs, case_id)
    store.log(case_id, "correlation", "engine", {"count": len(corrs)})
    store.update_case_status(case_id, "done")
    return case_id, findings, corrs


if __name__ == "__main__":
    class MemStore:
        def __init__(self):
            self.f = {}; self.c = {}; self.logs = []; self.case = 0
        def create_case(self, ids):
            self.case += 1; return f"case-{self.case}"
        def update_case_status(self, cid, status): pass
        def upsert_findings(self, findings, cid): self.f[cid] = findings
        def insert_correlations(self, corrs, cid): self.c[cid] = corrs
        def list_findings(self, cid): return self.f.get(cid, [])
        def log(self, *a): self.logs.append(a)

    class _FakeScanner:
        @staticmethod
        def scan(v, is_email, cid):
            assert is_email is False
            return [
                {"case_id": cid, "identifier_type": "username",
                 "identifier_value": v, "source_tool": "user-scanner",
                 "platform": p, "status": "found",
                 "extra_metadata": {"bio": b}, "collected_at": ""}
                for p, b in (("github", "hi one"), ("twitter", "hi two"))
            ]

    # patch this module's own global: run_case reads user_scanner_wrapper from these globals
    user_scanner_wrapper = type("W", (), {"scan": staticmethod(_FakeScanner.scan)})()
    s = MemStore()
    cid, findings, corrs = run_case([{"type": "username", "value": "alice"}], store=s)
    assert cid == "case-1" and len(findings) == 2 and len(corrs) == 1
    assert corrs[0]["type"] == "username_reuse" and corrs[0]["reviewed"] is False
    assert any(l[0] == cid and l[2] == "collector" for l in s.logs)
    print("pipeline OK")

