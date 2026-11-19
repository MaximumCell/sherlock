"""Rows that describe a scan (coverage summaries, search links) are not evidence."""
from sherlock_core.correlation import correlate
from sherlock_core.models import make_finding


def _row(i, **kw):
    f = make_finding(case_id="c", identifier_type="username", identifier_value="ada", **kw)
    return {**f, "id": f"f{i}"}


def test_summary_and_search_link_rows_are_ignored():
    link = "https://example.org/shared-page"
    rows = [
        _row(1, source_tool="whatsmyname", platform="whatsmyname", meta={"summary": True}, extra={"links": link}),
        _row(2, source_tool="reverse_image_links", platform="search-links", extra={"links": link}),
    ]
    assert correlate("c", rows) == []


def test_name_search_rows_do_not_correlate_on_the_searched_name():
    rows = []
    for i, platform in enumerate(("openalex", "orcid", "wikidata", "web")):
        f = make_finding(case_id="c", identifier_type="name", identifier_value="Ada Fixture",
                         source_tool=f"person_{platform}", platform=platform, extra={"fullname": "Ada Fixture"})
        rows.append({**f, "id": f"n{i}"})
    assert [c for c in correlate("c", rows) if c["type"] == "shared_display_name"] == []
