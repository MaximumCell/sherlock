"""Company officer records (UK Companies House public register). Needs `COMPANIES_HOUSE_API_KEY`.

Status on 2026-11-20 (re-checked):
  * Companies House: endpoints and field names taken from the official specification
    (developer-specs.company-information.service.gov.uk: `OfficerSearch`, `appointmentList`);
    a real keyless request confirmed the host and that it answers 401 `Empty Authorization header`
    without a key. The 200
    responses were NOT seen live (no key was available), so the test fixtures are built from
    the documented schema (tests/person/fixtures/companies_house_*.json, marked SYNTHETIC). Free key, rate limit 600 requests / 5 minutes.
      GET https://api.company-information.service.gov.uk/search/officers?q=<name>&items_per_page=10
          (HTTP Basic, key as user name, empty password) -> items[]: title, appointment_count, links.self
      GET https://api.company-information.service.gov.uk/officers/<id>/appointments
          -> items[]: officer_role, appointed_on, resigned_on, appointed_to{company_name, company_number,
             company_status}
  * OpenCorporates: `GET https://api.opencorporates.com/v0.4/officers/search` now answers
    401 "Invalid Api Token" without a key, so it is not used.

Stored per officer: name, and per appointment the role, company name and number, jurisdiction
and dates. NEVER stored (the register publishes them, Sherlock does not want them): the
officer's correspondence address, date of birth, nationality and country of residence.
"""
from __future__ import annotations

import asyncio
import os
import re
from typing import Any

import httpx

from sherlock_core.modules import register
from sherlock_core.modules._util import describe_http_error, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.modules.person_util import MIN_NAME_SCORE, name_gate, person_extra

API = "https://api.company-information.service.gov.uk"
PUBLIC = "https://find-and-update.company-information.service.gov.uk"
MAX_OFFICERS = 3
MAX_APPOINTMENTS = 15
JURISDICTION = "gb"
_OFFICER_PATH = re.compile(r"^/officers/([A-Za-z0-9_\-]+)/appointments$")


def _auth() -> httpx.BasicAuth:
    return httpx.BasicAuth(os.getenv("COMPANIES_HOUSE_API_KEY", "").strip(), "")


def appointment_row(item: dict[str, Any]) -> dict[str, Any] | None:
    """The allow-listed fields of one appointment. Everything else in the record is discarded."""
    company = item.get("appointed_to") or {}
    if not company.get("company_name"):
        return None
    row = {
        "role": item.get("officer_role"), "company": company.get("company_name"),
        "company_number": company.get("company_number"), "company_status": company.get("company_status"),
        "jurisdiction": JURISDICTION, "appointed_on": item.get("appointed_on"),
        "resigned_on": item.get("resigned_on"),
    }
    return {k: v for k, v in row.items() if v}


@register
class PersonCompanies(Module):
    name = "person_companies"
    title = "Company officer records (UK Companies House)"
    description = (
        "Directorships and other officer appointments filed under this name at UK Companies House: "
        "role, company and dates. Addresses and dates of birth are not collected."
    )
    inputs = ("name",)
    queue = "identity"
    requires_env = ("COMPANIES_HOUSE_API_KEY",)
    source_url = "https://developer-specs.company-information.service.gov.uk/"
    timeout_s = 60.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        r = await ctx.http.get(f"{API}/search/officers", params={"q": target.value, "items_per_page": 10},
                               auth=_auth(), timeout=20.0)
        if r.status_code == 401:
            return [error_finding(ctx, self, target, "companies-house",
                                  "Companies House rejected COMPANIES_HOUSE_API_KEY (HTTP 401)")]
        if r.status_code != 200:
            return [error_finding(ctx, self, target, "companies-house", describe_http_error(r))]
        officers = []
        for item in (json_or_none(r) or {}).get("items") or []:
            if not isinstance(item, dict):
                continue
            m = _OFFICER_PATH.match(str((item.get("links") or {}).get("self") or ""))
            match, _ = name_gate(target.value, [str(item.get("title") or "")])
            if m and match.score >= MIN_NAME_SCORE:
                officers.append((match.score, m.group(1), str(item["title"])))
        officers = sorted(officers, key=lambda o: -o[0])[:MAX_OFFICERS]
        await ctx.progress(40, f"{len(officers)} officer record(s)")
        sem = asyncio.Semaphore(min(ctx.max_concurrency, 2))

        async def one(officer_id: str, title: str) -> dict[str, Any] | None:
            async with sem:
                resp = await ctx.http.get(f"{API}/officers/{officer_id}/appointments",
                                          params={"items_per_page": MAX_APPOINTMENTS}, auth=_auth(), timeout=20.0)
            data = json_or_none(resp) if resp.status_code == 200 else None
            rows = [a for a in (appointment_row(i) for i in (data or {}).get("items") or [] if isinstance(i, dict))
                    if a][:MAX_APPOINTMENTS]
            if not rows:
                return None
            active = [a["company"] for a in rows if not a.get("resigned_on")]
            name = str((data or {}).get("name") or title).title()
            extra = person_extra(
                fullname=name,
                ids={"companies-house": officer_id},
                employers=active or [a["company"] for a in rows[:3]],
                appointments=rows,
                appointment_count=len(rows),
                jurisdiction=JURISDICTION,
            )
            return ctx.finding(self, target, platform="companies-house",
                               url=f"{PUBLIC}/officers/{officer_id}/appointments", extra=extra,
                               discriminator=officer_id)

        found = await asyncio.gather(*(one(oid, title) for _, oid, title in officers))
        return [f for f in found if f]
