"""Finding rows in the REAL shapes the collectors write (see correlation/facts.py)."""
import itertools

import pytest

CASE = "case-1"


class Shapes:
    """Builders for DB-like finding rows. Each call gets a fresh, sortable id."""

    def __init__(self) -> None:
        self._n = itertools.count(1)

    def _row(self, itype, ivalue, tool, platform, meta, status="found", fid=None):
        n = next(self._n)
        return {
            "id": fid or f"f{n:05d}", "case_id": CASE, "identifier_type": itype, "identifier_value": ivalue,
            "source_tool": tool, "module": tool, "platform": platform, "status": status,
            "finding_key": f"key{n:05d}", "extra_metadata": meta, "curated": False,
            "collected_at": "2026-01-01T00:00:00+00:00",
        }

    # legacy user-scanner / <site name>
    def site(self, username, platform, extra=None, *, url=None, status="found", itype="username", media=None, fid=None):
        meta = {"category": "social", "url": url, "reason": None, "extra": extra if extra is not None else {},
                "media": media or {}}
        return self._row(itype, username, "user-scanner", platform, meta, status, fid)

    # legacy user-scanner / hudson-rock (no `extra`)
    def hudson(self, identifier, family="RedLine", date="2024-03-01T10:00:00.000Z", itype="email"):
        meta = {"stealer_family": family, "date_compromised": date, "operating_system": "Windows 10",
                "antiviruses": ["Windows Defender"]}
        return self._row(itype, identifier, "user-scanner", "hudson-rock", meta)

    # legacy xposedornot / breach (top-level meta)
    def breach(self, email, name, tool="xposedornot"):
        meta = {"breach_name": name, "breach_date": None, "data_classes": [], "description": ""}
        return self._row("email", email, tool, "breach", meta)

    # legacy gravatar
    def gravatar(self, email, **extra):
        meta = {"extra": {"gravatar_id": "0" * 32, **extra}, "url": "https://gravatar.com/" + "0" * 32}
        return self._row("email", email, "gravatar", "gravatar", meta)

    # legacy spiderfoot / <event type>
    def spiderfoot(self, domain, event_type, data):
        meta = {"event_type": event_type, "data": data, "source_module": "sfp_x", "confidence": 100}
        return self._row("domain", domain, "spiderfoot", event_type, meta)

    # legacy firecrawl / scraped:<host>
    def scrape(self, url, *, description=None, emails=None, handles=None, urls=None, title="A page"):
        host = url.split("/")[2].lower()
        extra = {"scraped_url": url, "scraped_at": "2026-01-01T00:00:00+00:00", "title": title,
                 "description": description, "og_image": None, "language": "en", "author": None,
                 "markdown_length": 10, "markdown_preview": "# hello"}
        if emails:
            extra["emails_in_page"] = emails
        if handles:
            extra["handles_in_page"] = handles
        if urls:
            extra["urls_in_page"] = urls
        return self._row("scraped_url", url, "firecrawl", f"scraped:{host}", {"extra": extra, "url": url})

    # v2 canonical (models.make_finding)
    def v2(self, itype, ivalue, platform, extra=None, *, url=None, tool="mod", status="found", **meta):
        return self._row(itype, ivalue, tool, platform, {"url": url, "extra": extra or {}, **meta}, status)


@pytest.fixture
def S() -> Shapes:
    return Shapes()


def of_type(corrs, rule):
    return [c for c in corrs if c["type"] == rule]


@pytest.fixture
def by_type():
    return of_type
