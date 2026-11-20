"""People-search / data-broker sites that are never used as a source.

Product rule (docs/CONTRACTS.md, Boundaries): Sherlock reports a person's PUBLIC online
and professional footprint. Aggregators that sell home addresses, phone numbers, relatives
and background reports are excluded outright: their pages are dropped from search results
before anything is stored, and no module queries them.

Matching is on the registrable host and its subdomains (`www.spokeo.com`, `uk.pipl.com`).
"""
from __future__ import annotations

from urllib.parse import urlsplit

BROKER_DOMAINS: frozenset[str] = frozenset({
    "spokeo.com", "whitepages.com", "beenverified.com", "truepeoplesearch.com", "fastpeoplesearch.com",
    "radaris.com", "mylife.com", "peekyou.com", "intelius.com", "zabasearch.com", "thatsthem.com",
    "pipl.com", "peoplefinders.com", "peoplefinder.com", "instantcheckmate.com", "truthfinder.com",
    "usphonebook.com", "nuwber.com", "clustrmaps.com", "anywho.com", "addresses.com", "411.com",
    "peoplelooker.com", "checkpeople.com", "publicrecordsnow.com", "searchpeoplefree.com",
    "smartbackgroundchecks.com", "cyberbackgroundchecks.com", "familytreenow.com", "ussearch.com",
    "privateeye.com", "advancedbackgroundchecks.com", "peoplesearchnow.com", "idcrawl.com",
    "voterrecords.com", "rehold.com", "neighbor.report", "officialusa.com", "unmask.com",
    "socialcatfish.com", "information.com", "persopo.com", "spyfly.com", "veripages.com",
    "peoplewhiz.com", "golookup.com", "infotracer.com", "recordsfinder.com", "centeda.com",
    "locatefamily.com", "192.com", "yasni.com", "lusha.com", "rocketreach.co", "contactout.com",
    "signalhire.com", "zoominfo.com", "apollo.io", "ancestry.com", "myheritage.com", "findagrave.com",
    "homemetry.com", "blockshopper.com", "peoplebyname.com", "dataveria.com", "kiwisearches.com",
    "numlookup.com", "truecaller.com", "sync.me", "spydialer.com", "revealname.com",
})


def host_of(url: str) -> str:
    value = str(url or "").strip()
    if "://" not in value:
        value = "https://" + value
    try:
        return (urlsplit(value).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""


def is_denied(url: str) -> bool:
    """True when `url` (or a bare host) belongs to a people-search / data-broker site."""
    host = host_of(url)
    return bool(host) and any(host == d or host.endswith("." + d) for d in BROKER_DOMAINS)
