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
