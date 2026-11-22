"""Finding row -> typed facts. The ONLY module that knows each source's data shape.

Rules never look at `extra_metadata`; they read `Fact`s grouped per finding in a
`FindingFacts`. Add a new source shape here and every rule picks it up.

Shapes understood (all live in `finding["extra_metadata"]`):

v2 canonical (`models.make_finding`)
    {url, extra: {fullname, bio, location, email, emails, links, avatar_url,
                  avatar_phash, ...}, ...top-level meta}

legacy user-scanner / <site name>
    {category, url, reason, extra: {site-specific keys}, media}

legacy user-scanner / "hudson-rock"   (infostealer exposure, NOT a social platform)
    {stealer_family, date_compromised, operating_system, antiviruses}     (no `extra`)

legacy xposedornot / "breach"         (also v2 breach rows)
    {breach_name, breach_date, data_classes, description}                 (top level)

legacy gravatar / "gravatar"
    {url, extra: {gravatar_id, username, fullname, bio, location, image, emails, links}}

legacy spiderfoot / <event type>
    {event_type, data, source_module, confidence}

legacy firecrawl / "scraped:<host>"   (identifier_type "scraped_url")
    {url, extra: {scraped_url, title, description, og_image, author, markdown_preview,
                  emails_in_page, handles_in_page, urls_in_page}}
    The *_in_page fields are comma-separated strings.

Fact kinds: handle, email, url, bio, display_name, breach, avatar_hash, location.
Facts are what a finding SAYS (a linked URL, a published email, a named handle).
What a finding IS (its own account handle, its own URL, the email it was looked up
by) is carried on `FindingFacts` (`handle`, `url`, `email`), so a rule can never
mistake the seed identifier for a discovery.
"""
from __future__ import annotations

import contextlib
import re
from dataclasses import dataclass, field
from typing import Any

from sherlock_core.correlation import norm

KINDS = ("handle", "email", "url", "bio", "display_name", "breach", "avatar_hash", "location")


@dataclass(frozen=True, slots=True)
class Fact:
    kind: str
    value: str                 # normalised, comparable
    finding_id: str
    platform: str              # canonical platform the fact is about: for `handle` the platform the
    #                            handle lives on ('' if unknown); otherwise the finding's platform
    field: str                 # where it was read, e.g. "extra.bio"
    raw: Any = None            # original value, for evidence
    subject: str | None = None  # breach facts: the identifier that was exposed


@dataclass(slots=True)
class FindingFacts:
    finding_id: str
    finding_key: str
    platform: str              # canonical
    label: str                 # platform as stored, for display
    source_tool: str
    identifier_type: str
    identifier_value: str
    kind: str                  # account | scrape | breach | infostealer | event
    url: str = ""              # normalised own URL
    handle: str = ""           # own handle (username findings on account platforms)
    email: str = ""            # the email this finding was looked up by
    # (platform, handle) of the account this finding describes, if known. A scrape of
    # github.com/edith and the GitHub profile finding for `edith` share it, which is
    # how a profile is recognised as its own scrape.
    account: tuple[str, str] | None = None
    facts: list[Fact] = field(default_factory=list)

    def of(self, kind: str) -> list[Fact]:
        return [f for f in self.facts if f.kind == kind]

    @property
    def identity(self) -> str:
        """Stable token for 'the same account/page': account, else URL, else the finding."""
        if self.account:
            return f"{self.account[1]}@{self.account[0]}"
        return self.url or self.finding_id

    @property
    def is_rich(self) -> bool:
        """Carries profile data (not merely 'this identifier is registered here')."""
        return any(f.kind in ("display_name", "bio", "location", "avatar_hash", "url") for f in self.facts)


# ----------------------------------------------------------------------------- field names
_EMAIL_FIELDS = ("email", "emails", "business_email", "public_email", "gravatar_email", "contact_email",
                 "emails_in_page")
_URL_FIELDS = ("website", "external_url", "links", "link", "blog", "homepage", "url", "urls", "site",
               "web", "channel_url", "accounts", "urls_in_page")
_NAME_FIELDS = ("fullname", "full_name", "display_name", "displayname", "name", "real_name", "realname")
_BIO_FIELDS = ("bio", "about", "about_me", "aboutme", "description", "intro", "summary", "profile_text",
               "headline", "tagline")
_LOCATION_FIELDS = ("location", "currentlocation", "current_location", "city")
_PHASH_FIELDS = ("avatar_phash", "phash", "avatar_hash", "image_phash")
_HANDLE_SUFFIX = re.compile(r"_(?:username|handle|user|url|profile|account)$")
_HANDLE_FIELD_PLATFORMS = frozenset({
    "twitter", "github", "gitlab", "instagram", "youtube", "tiktok", "linkedin", "telegram", "mastodon",
    "facebook", "twitch", "reddit", "keybase", "bluesky", "medium", "hackerone", "bugcrowd", "threads",
    "snapchat", "soundcloud", "steam", "devto", "kaggle", "pinterest",
})
_SF_EMAIL_BREACH = re.compile(r"^\s*(\S+@\S+?)\s*\[(.+)\]\s*$")
_SF_URL_EVENTS = ("SOCIAL_MEDIA", "ACCOUNT_EXTERNAL_OWNED")
_MAX_TEXT = 5000


def _dict(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def _str(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ("" if v is None or isinstance(v, bool | dict | list) else str(v))


def _lower_keys(d: dict) -> dict[str, Any]:
    return {str(k).lower(): v for k, v in d.items()}


def _first_text(d: dict[str, Any], names: tuple[str, ...]) -> tuple[str, str]:
    for n in names:
        v = d.get(n)
        if isinstance(v, str) and v.strip():
            return n, v.strip()[:_MAX_TEXT]
    return "", ""


class _Builder:
    """Collects de-duplicated facts for one finding."""

    def __init__(self, ff: FindingFacts) -> None:
        self.ff = ff
        self.seen: set[tuple[str, str, str]] = set()

    def add(self, kind: str, value: str | None, field_: str, raw: Any = None, *,
            platform: str | None = None, subject: str | None = None) -> None:
        if not value:
            return
        plat = self.ff.platform if platform is None else platform
        key = (kind, value, plat if kind == "handle" else "")
        if key in self.seen:
            return
        self.seen.add(key)
        self.ff.facts.append(Fact(kind, value, self.ff.finding_id, plat, field_, raw if raw is not None else value,
                                  subject))

    def email(self, raw: Any, field_: str) -> None:
        self.add("email", norm.norm_email(raw), field_, raw)

    def url(self, raw: Any, field_: str) -> None:
        u = norm.norm_url(raw)
        if not u or u == self.ff.url:
            return
        self.add("url", u, field_, raw)
        self.handle_pair(norm.handle_from_url(raw), field_, raw)

    def handle_pair(self, pair: tuple[str, str] | None, field_: str, raw: Any) -> None:
        if not pair or pair == self.ff.account:
            return
        self.add("handle", pair[1], field_, raw, platform=pair[0])

    def text(self, text: str, field_: str) -> None:
        """Pivots written inside free text: emails, URLs, explicitly named handles."""
        for e in norm.find_emails(text):
            self.email(e, field_)
        for u in norm.find_urls(text) + norm.find_bare_profile_urls(text):
            self.url(u, field_)
        for pair in norm.handles_from_text(text):
            self.handle_pair(pair, field_, f"@{pair[1]}")


# ----------------------------------------------------------------------------- per-shape readers
def _read_breach(b: _Builder, meta: dict) -> None:
    name = _str(meta.get("breach_name"))
    if name:
        b.add("breach", norm.norm_text(name), "breach_name", name,
              subject=b.ff.identifier_value.strip().casefold())


def _read_infostealer(b: _Builder, meta: dict) -> None:
    """Hudson Rock: one row per infected machine.

    The fact is `infostealer:<family>`; when the compromise timestamp is known it is
    appended (`infostealer:<family>@<timestamp>`), because only the same family AND
    the same compromise time mean the same stealer log. A stealer family alone
    (RedLine, Lumma, ...) covers millions of unrelated machines.
    """
    family = norm.norm_text(_str(meta.get("stealer_family"))) or "unknown"
    when = _str(meta.get("date_compromised"))
    if family == "unknown" and not when:
        return
    value = f"infostealer:{family}" + (f"@{when.lower()}" if when else "")
    b.add("breach", value, "stealer_family", f"infostealer:{family}" + (f" ({when})" if when else ""),
          subject=b.ff.identifier_value.strip().casefold())


def _read_spiderfoot(b: _Builder, meta: dict) -> None:
    etype = _str(meta.get("event_type")).upper() or b.ff.label.upper()
    data = _str(meta.get("data"))[:_MAX_TEXT]
    if not data:
        return
    if etype == "EMAILADDR_COMPROMISED" and (m := _SF_EMAIL_BREACH.match(data)):
        email = norm.norm_email(m.group(1))
        if email:
            b.add("email", email, "data", m.group(1))
            b.add("breach", norm.norm_text(m.group(2)), "data", m.group(2), subject=email)
    elif etype.startswith("EMAILADDR"):
        for e in norm.find_emails(data):
            b.email(e, "data")
    elif etype.startswith(_SF_URL_EVENTS):
        for u in norm.find_urls(data):
            b.url(u.split("</SFURL>")[0], "data")
    elif etype == "USERNAME" and (h := norm.norm_handle(data)):
        b.add("handle", h, "data", data, platform="")


def _read_profile(b: _Builder, meta: dict) -> None:
    """v2 canonical, user-scanner site rows, gravatar and firecrawl: everything with `extra`."""
    extra = _lower_keys(_dict(meta.get("extra")))
    media = _lower_keys(_dict(meta.get("media")))
    top = _lower_keys(meta)
    own_handle = b.ff.handle or norm.norm_handle(b.ff.identifier_value) or ""

    for name in _EMAIL_FIELDS:
        for piece in norm.split_values(extra.get(name)):
            b.email(piece, f"extra.{name}")
    for name in _URL_FIELDS:
        for piece in norm.split_values(extra.get(name)):
            if norm.norm_email(piece):
                continue
            if "." in piece:
                b.url(piece, f"extra.{name}")

    for key, value in extra.items():
        plat = norm.canonical_platform(_HANDLE_SUFFIX.sub("", key))
        if plat not in _HANDLE_FIELD_PLATFORMS or not isinstance(value, str) or not value.strip():
            continue
        v = value.strip()
        if "/" in v or v.lower().startswith("http"):
            b.url(v, f"extra.{key}")
        elif h := norm.norm_handle(v):
            b.handle_pair((plat, h), f"extra.{key}", v)

    if b.ff.kind != "scrape":
        fname, name = _first_text(extra, _NAME_FIELDS)
        n = norm.norm_name(name)
        # a "display name" that merely echoes the handle says nothing new
        if n and 2 <= len(n) <= 60 and n != own_handle and "@" not in n and not n.startswith("http"):
            b.add("display_name", n, f"extra.{fname}", name)

    fbio, bio = _first_text(extra, _BIO_FIELDS)
    if not bio:
        fbio, bio = _first_text(top, ("bio", "about"))
        fbio = fbio and f"meta.{fbio}"
    else:
        fbio = f"extra.{fbio}"
    if bio:
        b.add("bio", norm.norm_text(bio), fbio, bio)
        b.text(bio, fbio)

    floc, loc = _first_text(extra, _LOCATION_FIELDS)
    if loc:
        b.add("location", norm.norm_text(loc), f"extra.{floc}", loc)

    for src, prefix in ((extra, "extra"), (media, "media"), (top, "meta")):
        for name in _PHASH_FIELDS:
            if h := norm.norm_phash(src.get(name)):
                b.add("avatar_hash", h, f"{prefix}.{name}", src.get(name))

    # firecrawl: bare @mentions on a page. The platform is unknown (and a mention is
    # not ownership), so these are pivot candidates only, never cross-reference input.
    for piece in norm.split_values(extra.get("handles_in_page")):
        if piece.startswith("@") and (h := norm.norm_handle(piece)):
            b.add("handle", h, "extra.handles_in_page", piece, platform="")
    # gravatar publishes the account's own username
    if b.ff.platform == "gravatar" and (h := norm.norm_handle(_str(extra.get("username")))):
        b.ff.account = b.ff.account or ("gravatar", h)


# ----------------------------------------------------------------------------- entry points
def _classify(f: dict, meta: dict, platform: str) -> str:
    tool = _str(f.get("source_tool")).lower()
    raw_platform = _str(f.get("platform")).lower()
    if platform == "breach" or meta.get("breach_name"):
        return "breach"
    if platform == "hudsonrock" or "stealer_family" in meta or "date_compromised" in meta:
        return "infostealer"
    if tool == "spiderfoot" or ("event_type" in meta and "data" in meta):
        return "event"
    if _str(f.get("identifier_type")) == "scraped_url" or raw_platform.startswith("scraped:") or tool == "firecrawl":
        return "scrape"
    return "account"


_NON_EVIDENCE_MODULES = frozenset({"reverse_image_links", "reverse_image", "geo_context", "geo_webcams",
                                   "geo_street_images"})


def facts_for(finding: dict) -> FindingFacts | None:
    """Typed facts for one finding row, or None when the row is unusable."""
    if not isinstance(finding, dict):
        return None
    fid = _str(finding.get("id")) or _str(finding.get("finding_key"))
    if not fid:
        return None
    meta = _dict(finding.get("extra_metadata"))
    # Coverage summaries and ready-made search links describe a scan, not the subject.
    if meta.get("summary") is True or _str(finding.get("module")) in _NON_EVIDENCE_MODULES:
        return None
    label = _str(finding.get("platform"))
    platform = norm.canonical_platform(label)
    kind = _classify(finding, meta, platform)
    if kind == "event":
        platform = "spiderfoot"
    elif kind == "breach":
        platform = "breach"
    elif kind == "infostealer":
        platform = "hudsonrock"
    itype = _str(finding.get("identifier_type")).lower()
    ivalue = _str(finding.get("identifier_value"))
    ff = FindingFacts(
        finding_id=fid, finding_key=_str(finding.get("finding_key")) or fid, platform=platform,
        label=label or platform, source_tool=_str(finding.get("source_tool")), identifier_type=itype,
        identifier_value=ivalue, kind=kind,
    )
    extra = _dict(meta.get("extra"))
    own_url = meta.get("url") or (extra.get("scraped_url") if kind == "scrape" else None)
    if kind == "scrape" and not own_url:
        own_url = ivalue
    ff.url = norm.norm_url(own_url) or ""
    if itype == "email":
        ff.email = norm.norm_email(ivalue) or ""
    if kind == "account" and itype == "username":
        ff.handle = norm.norm_handle(ivalue) or ""
        if ff.handle:
            ff.account = (platform, ff.handle)
    elif kind == "scrape":
        ff.account = norm.handle_from_url(own_url)

    b = _Builder(ff)
    with contextlib.suppress(Exception):  # odd source data must never break a correlation run
        if kind == "breach":
            _read_breach(b, meta)
        elif kind == "infostealer":
            _read_infostealer(b, meta)
        elif kind == "event":
            _read_spiderfoot(b, meta)
        else:
            _read_profile(b, meta)
    if itype == "name":
        # A name search returns rows BECAUSE they carry the searched name, so the name
        # itself is not evidence that two of them are the same person. Telling people
        # apart is the job of sherlock_core.resolve, which uses stronger keys.
        ff.facts = [f for f in ff.facts if f.kind != "display_name"]
    return ff


def extract(findings: list[dict]) -> list[FindingFacts]:
    """Facts for every usable `found` row (de-duplicated by finding id)."""
    out: list[FindingFacts] = []
    seen: set[str] = set()
    for f in findings or []:
        if not isinstance(f, dict) or f.get("status") != "found":
            continue
        ff = facts_for(f)
        if ff and ff.finding_id not in seen:
            seen.add(ff.finding_id)
            out.append(ff)
    return out
