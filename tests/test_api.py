"""End-to-end API smoke test against real Supabase. Runs all endpoints via TestClient.
Skips real collectors (user-scanner/xposedornot/spiderfoot) — those are network-bound.
Cleans up its own case at the end.
"""
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `import api` works

from fastapi.testclient import TestClient

from api.main import app
from core import db

client = TestClient(app)
TEST_VALUE = f"smoketest_{uuid.uuid4().hex[:8]}"
created_case_id = None


def _ok(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}{(' — ' + detail) if detail else ''}")
    if not cond:
        sys.exit(1)


def main():
    global created_case_id

    print(f"test identifier: {TEST_VALUE}")

    # 1. health
    print("\n1. GET /health")
    r = client.get("/health")
    _ok("200", r.status_code == 200, str(r.json()))

    # 2. create case
    print("\n2. POST /cases")
    r = client.post("/cases", json={"identifiers": [{"type": "username", "value": TEST_VALUE}]})
    _ok("201", r.status_code == 201, str(r.status_code))
    created_case_id = r.json()["id"]
    _ok("status=new", r.json()["status"] == "new")
    _ok("identifier stored", r.json()["identifiers"][0]["value"] == TEST_VALUE)
    print(f"  case_id: {created_case_id}")

    # 3. list cases
    print("\n3. GET /cases")
    r = client.get("/cases")
    _ok("200", r.status_code == 200)
    _ok("includes our case", any(c["id"] == created_case_id for c in r.json()))

    # 4. get one case
    print("\n4. GET /cases/{id}")
    r = client.get(f"/cases/{created_case_id}")
    _ok("200", r.status_code == 200)
    _ok("matches", r.json()["id"] == created_case_id)

    # 4b. 404 path
    print("\n4b. GET /cases/{nonexistent} (404 check)")
    r = client.get("/cases/00000000-0000-0000-0000-000000000000")
    _ok("404", r.status_code == 404)

    # 5. seed findings directly (bypass collectors), then run correlate
    print("\n5. Seed findings + correlate (skipping real collectors)")
    findings = [
        {"identifier_type": "username", "identifier_value": TEST_VALUE,
         "source_tool": "user-scanner", "platform": "github", "status": "found",
         "extra_metadata": {"bio": "security researcher, OSINT tools"},
         "collected_at": "2026-08-06T00:00:00Z"},
        {"identifier_type": "username", "identifier_value": TEST_VALUE,
         "source_tool": "user-scanner", "platform": "twitter", "status": "found",
         "extra_metadata": {"bio": "security researcher, OSINT tools"},
         "collected_at": "2026-08-06T00:00:00Z"},
        {"identifier_type": "email", "identifier_value": f"{TEST_VALUE}@x.local",
         "source_tool": "xposedornot", "platform": "breach", "status": "found",
         "extra_metadata": {"breach_name": "Adobe"},
         "collected_at": "2026-08-06T00:00:00Z"},
        {"identifier_type": "email", "identifier_value": f"{TEST_VALUE}@x.local",
         "source_tool": "hudson-rock", "platform": "breach", "status": "found",
         "extra_metadata": {"breach_name": "Adobe"},
         "collected_at": "2026-08-06T00:00:00Z"},
    ]
    db.upsert_findings(findings, created_case_id)
    from core import correlate
    corrs = correlate.correlate(created_case_id, db.list_findings(created_case_id))
    db.insert_correlations(corrs, created_case_id)
    print(f"  seeded {len(findings)} findings, {len(corrs)} correlations")

    # 6. list findings
    print("\n6. GET /cases/{id}/findings")
    r = client.get(f"/cases/{created_case_id}/findings")
    _ok("200", r.status_code == 200)
    _ok(f"count={len(findings)}", len(r.json()) == len(findings))

    # 7. list correlations (all)
    print("\n7. GET /cases/{id}/correlations")
    r = client.get(f"/cases/{created_case_id}/correlations")
    _ok("200", r.status_code == 200)
    all_corrs = r.json()
    _ok(f"count={len(corrs)}", len(all_corrs) == len(corrs))
    _ok("all unreviewed", all(not c["reviewed"] for c in all_corrs))

    # 8. list correlations filtered ?reviewed=false
    print("\n8. GET /cases/{id}/correlations?reviewed=false")
    r = client.get(f"/cases/{created_case_id}/correlations?reviewed=false")
    _ok("200", r.status_code == 200)
    _ok(f"count={len(corrs)}", len(r.json()) == len(corrs))

    # 9. list correlations filtered ?reviewed=true (should be empty)
    print("\n9. GET /cases/{id}/correlations?reviewed=true (empty)")
    r = client.get(f"/cases/{created_case_id}/correlations?reviewed=true")
    _ok("200", r.status_code == 200)
    _ok("empty", len(r.json()) == 0)

    # 10. approve one correlation
    print("\n10. POST /correlations/{id}/review (approve)")
    target = all_corrs[0]
    r = client.post(f"/correlations/{target['id']}/review", json={"decision": "approve", "note": "looks legit"})
    _ok("200", r.status_code == 200, str(r.json()))
    _ok("decision=approve", r.json()["decision"] == "approve")

    # verify the approval stuck
    r = client.get(f"/cases/{created_case_id}/correlations?reviewed=true")
    _ok("now 1 reviewed", len(r.json()) == 1)
    _ok("has note", r.json()[0].get("review_note") == "looks legit")

    # 11. reject another correlation
    print("\n11. POST /correlations/{id}/review (reject)")
    target2 = all_corrs[1]
    r = client.post(f"/correlations/{target2['id']}/review", json={"decision": "reject", "note": "noise"})
    _ok("200", r.status_code == 200)
    _ok("decision=reject", r.json()["decision"] == "reject")

    # verify the rejected one is gone
    r = client.get(f"/cases/{created_case_id}/correlations")
    remaining_ids = {c["id"] for c in r.json()}
    _ok("rejected one deleted", target2["id"] not in remaining_ids)

    # 12. 404 on bogus correlation id
    print("\n12. POST /correlations/{bogus}/review (404 check)")
    r = client.post("/correlations/00000000-0000-0000-0000-000000000000/review", json={"decision": "approve"})
    _ok("404", r.status_code == 404)

    # 13. generate report
    print("\n13. POST /cases/{id}/report")
    r = client.post(f"/cases/{created_case_id}/report")
    _ok("200", r.status_code == 200)
    _ok("content-type=md", "text/plain" in r.headers.get("content-type", ""))
    _ok("has title", r.text.startswith("# Investigation Report"))
    _ok("mentions identifier", TEST_VALUE in r.text)

    # 14. GET report (regenerate)
    print("\n14. GET /cases/{id}/report")
    r = client.get(f"/cases/{created_case_id}/report")
    _ok("200", r.status_code == 200)
    _ok("same content", "Investigation Report" in r.text)

    # 15. audit log
    print("\n15. GET /audit?case_id=...")
    r = client.get(f"/audit?case_id={created_case_id}")
    _ok("200", r.status_code == 200)
    actions = {e["action"] for e in r.json()}
    _ok("has case_deleted? not yet", "case_deleted" not in actions)
    _ok("has correlation_review", "correlation_review" in actions)
    _ok("has report", "report" in actions)

    # 16. delete case
    print("\n16. DELETE /cases/{id}")
    r = client.delete(f"/cases/{created_case_id}")
    _ok("204", r.status_code == 204)
    r = client.get(f"/cases/{created_case_id}")
    _ok("now 404", r.status_code == 404)

    print("\nALL API ENDPOINTS GREEN.")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        # best-effort cleanup on any failure
        if created_case_id:
            try:
                db._client().table("cases").delete().eq("id", created_case_id).execute()
                print(f"\ncleanup: deleted case {created_case_id}")
            except Exception:
                pass
        print(f"\nFAIL: {type(e).__name__}: {e}")
        raise
