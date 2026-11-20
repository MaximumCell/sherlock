"""Exposure score: pure, deterministic, capped, monotone (see sherlock_core/scoring.py)."""
import itertools
import random

from sherlock_core import scoring
from sherlock_core.models import make_finding
from sherlock_core.scoring import score_exposure

_n = itertools.count(1)
EMAIL = "ada@example.net"


def _f(itype, value, platform, *, tool="test", module=None, url=None, extra=None, meta=None, disc="",
       status="found"):
    row = make_finding(case_id="c1", identifier_type=itype, identifier_value=value, source_tool=tool,
                       platform=platform, status=status, url=url, extra=extra, meta=meta, discriminator=disc,
                       module=module)
    row["id"] = f"f{next(_n):05d}"
    row["collected_at"] = "2026-01-01T00:00:00+00:00"
    return row


def account(platform, handle="ada", **extra):
    return _f("username", handle, platform, tool="whatsmyname", url=f"https://{platform}.example/{handle}",
              extra=extra)


def breach(name, date=None, classes=(), email=EMAIL):
    return _f("email", email, "breach", tool="leakcheck_public", disc=name,
              meta={"breach_name": name, "breach_date": date, "data_classes": list(classes)})


def stealer(email=EMAIL, family="RedLine", date="2025-06-01T10:00:00.000Z"):
    return _f("email", email, "hudson-rock", tool="hudson_rock", disc=date,
              meta={"stealer_family": family, "date_compromised": date})


def corr(ids, type_="shared_email", status="approved", value="ada@example.net", key=None):
    return {"id": f"c-{key or value}-{type_}", "type": type_, "corr_key": key or f"{type_}|{value}",
            "matched_value": value, "entities_involved": list(ids), "confidence": 0.9, "evidence": [],
            "priority": 1.0, "status": status}


def factor(result, key):
    return next((f for f in result["factors"] if f["key"] == key), None)


def test_weights_add_up_to_100():
    assert scoring.TOTAL_MAX == 100
    assert (scoring.BREACH_COUNT_MAX + scoring.BREACH_RECENCY_MAX + scoring.BREACH_SENSITIVITY_MAX
            + scoring.INFOSTEALER_MAX) == scoring.BREACH_MAX
    assert (scoring.INFRA_PORTS_MAX + scoring.INFRA_VULNS_MAX + scoring.INFRA_MAIL_MAX
            + scoring.INFRA_SUBDOMAINS_MAX) == scoring.INFRA_MAX


def test_empty_case_scores_zero_and_says_why():
    for findings in ([], None, [account("github") | {"status": "not_found"}]):
        out = score_exposure(findings, [])
        assert out["score"] == 0 and out["band"] == "low" and out["factors"] == []
        assert out["computed_from"] == {"findings": 0, "approved_correlations": 0}
        assert "nothing to score" in out["method"]


def test_breach_only_case():
    adobe = breach("Adobe", "2013-10-04", ["Email addresses", "Password hints", "Passwords"])
    linkedin = breach("LinkedIn", "2021-04", ["Phone numbers", "Physical addresses"])
    out = score_exposure([adobe, linkedin], [])
    assert [f["key"] for f in out["factors"]] == ["breach_exposure"]
    f = out["factors"][0]
    assert f["max_points"] == 30 and 0 < f["points"] <= 30 and out["score"] == round(f["points"])
    assert "2 distinct breaches" in f["detail"] and "LinkedIn (2021-04)" in f["detail"]
    assert "passwords" in f["detail"] and "phone numbers" in f["detail"]
    assert f["evidence_finding_ids"] == sorted([adobe["id"], linkedin["id"]])
    assert any(EMAIL in s and "Adobe (2013-10-04)" in s and "two-factor" in s for s in f["remediation"])
    assert out["computed_from"] == {"findings": 2, "approved_correlations": 0}
    assert "pending and rejected correlations contribute nothing" in out["method"]


def test_breach_without_dates_or_classes_says_so_and_invents_nothing():
    f = score_exposure([breach("Canva")], [])["factors"][0]
    assert "gave no dates" in f["detail"] and "did not say which data types" in f["detail"]
    assert len(f["remediation"]) == 1 and "Canva breach" in f["remediation"][0]


def test_same_breach_from_two_sources_counts_once():
    one = score_exposure([breach("Adobe")], [])
    two = score_exposure([breach("Adobe"), breach("adobe")], [])
    assert one["score"] == two["score"] and "1 distinct breach " in two["factors"][0]["detail"]


def test_recency_and_sensitivity_and_infostealers_weigh_more():
    old = score_exposure([breach("Old", "2012-01-01")], [])["factors"][0]["points"]
    new = score_exposure([breach("New", "2025-09-01")], [])["factors"][0]["points"]
    assert new > old
    plain = score_exposure([breach("B", None, ["Email addresses", "IP addresses"])], [])["factors"][0]["points"]
    sensitive = score_exposure([breach("B", None, ["Passwords", "Credit cards"])], [])["factors"][0]["points"]
    assert sensitive > plain == score_exposure([breach("B")], [])["factors"][0]["points"]
    log = score_exposure([stealer()], [])["factors"][0]
    assert log["points"] > score_exposure([breach("B", "2025-06-01")], [])["factors"][0]["points"]
    assert "RedLine" in log["remediation"][0] and "2025-06-01" in log["remediation"][0]


def test_adding_a_breach_never_lowers_the_score():
    findings = [account("github"), account("gitlab")]
    last = score_exposure(findings, [])["score"]
    pool = [breach(f"Breach {i}", date, classes) for i, (date, classes) in enumerate([
        (None, []), ("2010-01-01", []), ("2025-12-01", ["Passwords"]), (None, ["Phone numbers"]),
        ("2019", ["Government issued IDs"]), ("2024-02", []),
    ] * 6)] + [stealer(date=f"2025-0{i}-01T00:00:00Z") for i in range(1, 6)]
    for b in pool:
        findings.append(b)
        now = score_exposure(findings, [])
        assert now["score"] >= last and factor(now, "breach_exposure")["points"] <= 30
        last = now["score"]


def test_adding_an_approved_correlation_never_lowers_the_score():
    accounts = [account(p) for p in ("github", "gitlab", "reddit", "twitter", "mastodon", "keybase")]
    corrs, last = [], score_exposure(accounts, [])["score"]
    types = ["shared_email", "avatar_match", "shared_display_name", "shared_bio_text", "shared_external_handle",
             "something_new"]
    for i, (a, b) in enumerate(itertools.combinations(accounts, 2)):
        corrs.append(corr([a["id"], b["id"]], types[i % len(types)], value=f"v{i}"))
        now = score_exposure(accounts, corrs)
        assert now["score"] >= last and factor(now, "identity_linkability")["points"] <= 15
        assert now["computed_from"]["approved_correlations"] == i + 1
        last = now["score"]
    assert last > score_exposure(accounts, [])["score"]


def test_pending_and_rejected_correlations_do_not_count():
    a, b, c = account("github"), account("gitlab"), account("reddit")
    base = score_exposure([a, b, c], [])
    waiting = [corr([a["id"], b["id"]], status="pending"), corr([b["id"], c["id"]], status="rejected", value="x")]
    out = score_exposure([a, b, c], waiting)
    link = factor(out, "identity_linkability")
    assert out["score"] == base["score"] and factor(base, "identity_linkability") is None
    assert link["points"] == 0 and link["evidence_finding_ids"] == [] and link["remediation"] == []
    assert "2 pending or rejected links not counted" in link["detail"]
    assert out["computed_from"]["approved_correlations"] == 0

    approved = score_exposure([a, b, c], [corr([a["id"], b["id"]]), waiting[1]])
    link = factor(approved, "identity_linkability")
    assert link["points"] > 0 and link["evidence_finding_ids"] == sorted([a["id"], b["id"]])
    assert "github and gitlab" in link["remediation"][0] and "ada@example.net" in link["remediation"][0]


def test_caps_hold_with_a_thousand_platforms():
    findings = [account(f"site{i}", email=f"u{i}@example.net", phone=f"+1555{i:07d}") for i in range(1000)]
    findings += [breach(f"B{i}", "2025-12-01", ["Passwords", "Credit cards", "Passport numbers", "Phone numbers",
                                                "Physical addresses", "Dates of birth"]) for i in range(300)]
    findings += [stealer(date=f"2025-01-{d:02d}T00:00:00Z") for d in range(1, 20)]
    findings += [
        _f("ip", "203.0.113.9", "internetdb", module="internetdb", disc="203.0.113.9",
           meta={"ip": "203.0.113.9", "ports": list(range(1, 101)), "vulns": [f"CVE-2024-{i:04d}" for i in range(100)]}),
        _f("domain", "example.net", "dns", module="dns_records", meta={"has_spf": False, "has_dmarc": False}),
        _f("domain", "example.net", "crt.sh", module="crtsh", meta={"subdomains": [], "subdomain_count": 5000}),
    ]
    findings += [_f("image", f"https://img.example/{i}.jpg", "image", module="image_meta",
                    url=f"https://img.example/{i}.jpg", meta={"exif": {"gps_present": True}, "gps_present": True})
                 for i in range(10)]
    ids = [f["id"] for f in findings[:60]]
    corrs = [corr([a, b], value=f"v{i}") for i, (a, b) in enumerate(itertools.combinations(ids, 2))][:500]
    out = score_exposure(findings, corrs)
    assert out["score"] == 100 and out["band"] == "severe"
    assert len(out["factors"]) == 7 and sum(f["max_points"] for f in out["factors"]) == 100
    for f in out["factors"]:
        assert f["points"] == f["max_points"], f["key"]
        assert len(f["evidence_finding_ids"]) <= scoring.EVIDENCE_LIMIT
        assert len(f["remediation"]) <= scoring.REMEDIATION_LIMIT
    assert "1000 distinct platforms" in factor(out, "account_footprint")["detail"]


def test_diminishing_returns():
    def footprint(n):
        return factor(score_exposure([account(f"site{i}") for i in range(n)], []), "account_footprint")["points"]

    assert footprint(2) - footprint(1) > footprint(21) - footprint(20) > 0


def test_account_footprint_contacts_and_handle_reuse():
    gh = account("github", email="ada.public@example.net", fullname="Ada L")
    gl = account("gitlab", email="ada.public@example.net")
    rd = account("reddit", handle="countess")
    noise = [  # not accounts: a LeakCheck summary row and an error row
        _f("username", "ada", "leakcheck", tool="leakcheck_public", meta={"exposed_fields": []}),
        _f("username", "ada", "twitter", status="error"),
    ]
    out = score_exposure([gh, gl, rd, *noise], [])
    foot, contact, reuse = (factor(out, k) for k in ("account_footprint", "exposed_contact_details", "handle_reuse"))
    assert "3 distinct platforms (github, gitlab and reddit)" in foot["detail"]
    assert foot["evidence_finding_ids"] == sorted([gh["id"], gl["id"], rd["id"]])
    assert "1 email address (ada.public@example.net)" in contact["detail"]
    assert contact["remediation"] == ["Remove the email address ada.public@example.net from github and gitlab, "
                                      "or replace it with a contact form or an alias you can retire."]
    assert "'ada' is used on 2 platforms (github and gitlab)" in reuse["detail"]
    assert reuse["evidence_finding_ids"] == sorted([gh["id"], gl["id"]]) and "'ada'" in reuse["remediation"][0]

    alone = score_exposure([rd], [])
    assert factor(alone, "handle_reuse")["points"] == 0 and factor(alone, "exposed_contact_details")["points"] == 0
    assert "No email address or phone number" in factor(alone, "exposed_contact_details")["detail"]


def test_looked_up_email_is_not_a_published_contact():
    row = _f("email", EMAIL, "gravatar", tool="gravatar", extra={"emails": EMAIL})
    assert factor(score_exposure([row], []), "exposed_contact_details")["points"] == 0


def test_infrastructure_case():
    host = _f("domain", "example.net", "internetdb", module="internetdb", disc="203.0.113.9",
              url="https://www.shodan.io/host/203.0.113.9",
              meta={"ip": "203.0.113.9", "ports": [22, 443, 3389], "hostnames": [], "cpes": [],
                    "vulns": ["CVE-2021-41773", "CVE-2023-0001"], "tags": []})
    dns = _f("domain", "example.net", "dns", module="dns_records",
             meta={"records": {"A": ["203.0.113.9"]}, "has_spf": True, "has_dmarc": False, "failed_lookups": 0})
    certs = _f("domain", "example.net", "crt.sh", module="crtsh",
               meta={"subdomains": ["a.example.net", "b.example.net"], "subdomain_count": 42})
    out = score_exposure([host, dns, certs], [])
    assert [f["key"] for f in out["factors"]] == ["infrastructure_exposure"]
    f = out["factors"][0]
    assert f["max_points"] == 15 and 0 < f["points"] <= 15
    assert "3 open ports on 1 address and 2 known vulnerabilities" in f["detail"]
    assert "no DMARC record on example.net" in f["detail"] and "SPF" not in f["detail"]
    assert "42 subdomains" in f["detail"]
    steps = " ".join(f["remediation"])
    assert "CVE-2021-41773" in steps and "22, 443 and 3389" in steps and "_dmarc.example.net" in steps
    assert "SPF" not in steps and "42 subdomains of example.net" in steps
    assert f["evidence_finding_ids"] == sorted([host["id"], dns["id"], certs["id"]])

    clean_dns = _f("domain", "example.dev", "dns", module="dns_records", meta={"has_spf": True, "has_dmarc": True})
    clean = score_exposure([clean_dns], [])["factors"][0]
    assert clean["points"] == 0 and clean["remediation"] == [] and "SPF and DMARC records present" in clean["detail"]
    assert score_exposure([host, dns, certs, clean_dns], [])["score"] >= out["score"]


def test_media_gps():
    def image(n, gps):
        url = f"https://img.example/{n}.jpg"
        exif = {"gps_present": True, "gps_lat": 48.86, "gps_lon": 2.35} if gps else {"gps_present": False}
        return _f("image", url, "image", module="image_meta", url=url,
                  extra={"avatar_phash": "ff00ff00ff00ff00"}, meta={"exif": exif, "gps_present": gps})

    none = score_exposure([image(1, False)], [])["factors"][0]
    assert none["key"] == "media_location" and none["points"] == 0 and none["remediation"] == []
    tagged = image(2, True)
    one = score_exposure([image(1, False), tagged], [])["factors"][0]
    assert 0 < one["points"] <= 5 and "1 of 2 images" in one["detail"]
    assert one["evidence_finding_ids"] == [tagged["id"]] and "https://img.example/2.jpg" in one["remediation"][0]
    assert "48.86" not in str(one)  # coordinates are not repeated


def test_deterministic_and_order_independent():
    accounts = [account(p, email="shared@example.net") for p in ("github", "gitlab", "reddit", "twitter")]
    findings = accounts + [
        breach("Adobe", "2013-10-04", ["Passwords"]), breach("adobe", "2013-10"), breach("LinkedIn", "2021-04"),
        breach("Canva", None, ["Phone numbers"], email="other@example.net"), stealer(), stealer(family="Lumma"),
        _f("domain", "example.net", "dns", module="dns_records", meta={"has_spf": False, "has_dmarc": False}),
        _f("ip", "203.0.113.9", "internetdb", module="internetdb", meta={"ip": "203.0.113.9", "ports": [80, 22],
                                                                         "vulns": ["CVE-2024-0002", "CVE-2024-0001"]}),
    ]
    corrs = [corr([accounts[0]["id"], accounts[1]["id"]]),
             corr([accounts[2]["id"], accounts[3]["id"]], "avatar_match", value="x"),
             corr([accounts[1]["id"], accounts[2]["id"]], status="pending", value="y")]
    expected = score_exposure(findings, corrs)
    assert expected == score_exposure(findings, corrs)
    rng = random.Random(7)
    for _ in range(25):
        fs, cs = findings[:], [dict(c, entities_involved=c["entities_involved"][::-1]) for c in corrs]
        rng.shuffle(fs)
        rng.shuffle(cs)
        assert score_exposure(fs, cs) == expected
    points = [f["points"] for f in expected["factors"]]
    assert points == sorted(points, reverse=True)


def test_bands():
    assert [scoring._band(s) for s in (0, 19, 20, 44, 45, 69, 70, 100)] == [
        "low", "low", "moderate", "moderate", "high", "high", "severe", "severe"]


def test_odd_input_does_not_raise():
    rows = [None, "x", {}, {"status": "found"}, {"id": "a", "status": "found", "extra_metadata": "nope"},
            {"id": "b", "status": "found", "platform": "internetdb", "module": "internetdb",
             "extra_metadata": {"ports": "22", "vulns": [None, 5, "x y"]}},
            {"id": "c", "status": "found", "platform": "breach",
             "extra_metadata": {"breach_name": "X", "breach_date": "soon", "data_classes": "Passwords"}}]
    out = score_exposure(rows, [None, {"status": "approved"}, {"status": "approved", "entities_involved": "ab"}])
    assert 0 <= out["score"] <= 100
