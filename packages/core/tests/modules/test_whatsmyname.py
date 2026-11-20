"""WhatsMyName engine and the module registry, offline."""
import httpx
import pytest
import sherlock_core.modules.whatsmyname as wmn
from sherlock_core.modules import all_modules, get_module, modules_for
from sherlock_core.modules.whatsmyname import build_request, classify, load_sites

SITES = (
    {"name": "Alpha", "uri_check": "https://alpha.example/u/{account}", "e_code": 200, "e_string": "profile-header",
     "m_code": 404, "m_string": "Not Found", "cat": "social"},
    {"name": "Beta", "uri_check": "https://beta.example/api/{account}", "uri_pretty": "https://beta.example/@{account}",
     "e_code": 200, "e_string": '"id":', "m_code": 200, "m_string": "no such user", "cat": "coding"},
    {"name": "Gamma", "uri_check": "https://gamma.example/graphql", "post_body": '{"user":"{account}"}',
     "headers": {"Content-Type": "application/json", "X-Api": "1"}, "e_code": 200, "e_string": "found",
     "m_code": 404, "m_string": "", "cat": "gaming"},
    {"name": "Delta", "uri_check": "https://{account}.delta.example/", "strip_bad_char": ".", "e_code": 200,
     "e_string": "blog", "m_code": 404, "m_string": "missing", "cat": "blog"},
    {"name": "Slow", "uri_check": "https://slow.example/{account}", "e_code": 200, "e_string": "x",
     "m_code": 404, "m_string": "y", "cat": "misc"},
    {"name": "Walled", "uri_check": "https://walled.example/{account}", "e_code": 200, "e_string": "x",
     "m_code": 404, "m_string": "y", "cat": "misc"},
    {"name": "Adult", "uri_check": "https://adult.example/{account}", "e_code": 200, "e_string": "x",
     "m_code": 404, "m_string": "y", "cat": "xx NSFW xx"},
)


@pytest.fixture
def sites(monkeypatch):
    monkeypatch.setattr(wmn, "load_sites", lambda: SITES)


def test_bundled_dataset_loads_and_skips_invalid_entries():
    load_sites.cache_clear()
    sites = load_sites()
    assert len(sites) > 600
    assert all(s.get("valid", True) is not False for s in sites)
    assert "7cup" not in {s["name"] for s in sites}  # marked "valid": false upstream
    assert all("{account}" in s["uri_check"] or "post_body" in s for s in sites)


def test_classify_rules():
    alpha, beta = SITES[0], SITES[1]
    assert classify(alpha, 200, "<div class=profile-header>") == "found"
    assert classify(alpha, 404, "Not Found") == "not_found"
    assert classify(alpha, 404, "") == "not_found"            # the missing status code alone is enough
    assert classify(alpha, 200, "some other page") == "unknown"
    assert classify(alpha, 403, "Just a moment...") == "unknown"
    assert classify(beta, 200, '{"id": 7}') == "found"
    assert classify(beta, 200, '{"error": "no such user", "id": null}'.replace("null", '""')) == "not_found"
    assert classify(beta, 200, "{}") == "unknown"
    assert classify(beta, 404, "") == "not_found"             # plain 404 even if the dataset expected 200


def test_build_request_substitution():
    method, url, headers, body = build_request(SITES[0], "a b/c")
    assert (method, url, body) == ("GET", "https://alpha.example/u/a%20b%2Fc", None)
    assert "Mozilla" in headers["User-Agent"]
    method, url, headers, body = build_request(SITES[2], "exampleuser")
    assert (method, url, body) == ("POST", "https://gamma.example/graphql", '{"user":"exampleuser"}')
    assert headers["X-Api"] == "1" and headers["Content-Type"] == "application/json"
    assert build_request(SITES[3], "ex.ample")[1] == "https://example.delta.example/"


async def test_whatsmyname_found_rows_and_one_summary(respx_mock, run, meta, sites):
    respx_mock.get("https://alpha.example/u/exampleuser").respond(html="<div class=profile-header>")
    respx_mock.get("https://beta.example/api/exampleuser").respond(json={"error": "no such user"})
    gamma = respx_mock.post("https://gamma.example/graphql").respond(text="found")
    respx_mock.get("https://exampleuser.delta.example/").respond(404, text="missing")
    respx_mock.get("https://slow.example/exampleuser").mock(side_effect=httpx.ReadTimeout("slow"))
    respx_mock.get("https://walled.example/exampleuser").respond(403, text="Just a moment...")
    respx_mock.get("https://adult.example/exampleuser").respond(text="x")

    rows = await run("whatsmyname", "username", "exampleuser")
    *found, summary = rows
    assert [(r["platform"], r["status"]) for r in found] == [("Adult", "found"), ("Alpha", "found"), ("Gamma", "found")]
    assert found[1]["extra_metadata"]["url"] == "https://alpha.example/u/exampleuser"
    assert meta(found[1])["category"] == "social"
    assert gamma.calls.last.request.content == b'{"user":"exampleuser"}'
    assert gamma.calls.last.request.headers["x-api"] == "1"
    assert summary["platform"] == "whatsmyname" and summary["status"] == "found"
    assert meta(summary) == {
        "summary": True, "checked": 7, "found": 3, "not_found": 2, "inconclusive": 1, "errors": 1,
    }
    assert len({r["finding_key"] for r in rows}) == len(rows)


async def test_whatsmyname_pretty_url_and_nsfw_opt_out(respx_mock, run, meta, sites):
    respx_mock.get("https://beta.example/api/exampleuser").respond(json={"id": 7})
    respx_mock.route(host__regex=r".*\.example").respond(404, text="Not Found missing y")
    rows = await run("whatsmyname", "username", "exampleuser", skip_nsfw=True)
    assert [r["platform"] for r in rows] == ["Beta", "whatsmyname"]
    assert rows[0]["extra_metadata"]["url"] == "https://beta.example/@exampleuser"  # uri_pretty
    assert meta(rows[1])["checked"] == 6


async def test_whatsmyname_nothing_found_and_total_failure(respx_mock, run, meta, sites):
    route = respx_mock.route(host__regex=r".*\.example").respond(404, text="Not Found missing y")
    (summary,) = await run("whatsmyname", "username", "exampleuser")
    assert summary["status"] == "not_found" and meta(summary)["found"] == 0 and meta(summary)["not_found"] == 7
    route.mock(side_effect=httpx.ConnectError("offline"))
    with pytest.raises(RuntimeError, match="every site check failed"):
        await run("whatsmyname", "username", "exampleuser")
    assert await run("whatsmyname", "username", "  ") == []


# ------------------------------------------------------------------ registry
def test_registry_lists_every_module_with_its_queue():
    by_name = {m.name: m for m in all_modules()}
    expected = {
        "identity": {"hudson_rock", "gravatar", "xposedornot", "leakcheck_public", "whatsmyname", "github",
                     "activity_fingerprint"},
        "infra": {"crtsh", "rdap", "dns_records", "internetdb", "wayback", "ripestat", "wallet"},
        "media": {"reverse_image", "reverse_image_links"},
    }
    for queue, names in expected.items():
        assert names <= set(by_name), names - set(by_name)
        assert all(by_name[n].queue == queue for n in names)
    for name in ("avatar_hash", "scrape", "scrape_profile", "_util", "base"):
        assert get_module(name) is None  # helpers are not scan modules
    for m in by_name.values():
        info = m.info()
        assert info.title and info.description and info.inputs
    assert {m.name for m in modules_for("wallet")} == {"wallet"}
    assert {"rdap", "internetdb", "ripestat"} <= {m.name for m in modules_for("ip")}
    assert "reverse_image" in {m.name for m in modules_for("image", only_available=False)}


def test_optional_dependency_modules_register_when_installed():
    for dep, name, queue in (
        ("user_scanner", "user_scanner", "identity"), ("phonenumbers", "phone_meta", "identity"),
        ("imagehash", "image_meta", "media"),
    ):
        pytest.importorskip(dep)
        assert get_module(name) is not None and get_module(name).queue == queue
