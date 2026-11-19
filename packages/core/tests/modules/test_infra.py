"""Infra-queue modules: happy path + empty / error path each, offline."""
import json

import httpx
import pytest
from sherlock_core.modules.crtsh import MAX_SUBDOMAINS
from sherlock_core.modules.wallet import detect_chain

DOH = "https://dns.google/resolve"
CRT = "https://crt.sh/"
CDX = "https://web.archive.org/cdx/search/cdx"
BTC = "https://blockstream.info/api"
ETH = "https://eth.blockscout.com/api/v2"
GENESIS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
ETH_ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"


def _doh(fx, respx_mock):
    doh = fx("doh")

    def answer(request: httpx.Request) -> httpx.Response:
        name, rtype = request.url.params["name"], request.url.params["type"]
        return httpx.Response(200, json=doh.get(name, {}).get(rtype) or doh["nxdomain"])

    return respx_mock.get(DOH).mock(side_effect=answer)


# ------------------------------------------------------------------ crtsh
async def test_crtsh_subdomains(respx_mock, run, fx, meta):
    route = respx_mock.get(CRT).respond(json=fx("crtsh"))
    (row,) = await run("crtsh", "domain", "Example.com")
    assert route.calls.last.request.url.params["q"] == "%.example.com"
    m = meta(row)
    assert row["platform"] == "crt.sh"
    assert {"example.com", "www.example.com"} <= set(m["subdomains"])
    assert m["subdomains"] == sorted(set(m["subdomains"]), key=lambda n: (n.count("."), n))  # de-duplicated
    assert all(n == "example.com" or n.endswith(".example.com") for n in m["subdomains"])
    assert not any("@" in n or "*" in n for n in m["subdomains"])
    assert m["subdomain_count"] == len(m["subdomains"]) and m["truncated"] is False


async def test_crtsh_caps_results(respx_mock, run, meta):
    rows = [{"name_value": f"h{i}.example.com\nother.org", "common_name": "example.com"} for i in range(700)]
    respx_mock.get(CRT).respond(json=rows)
    (row,) = await run("crtsh", "domain", "example.com")
    m = meta(row)
    assert len(m["subdomains"]) == MAX_SUBDOMAINS and m["subdomain_count"] == 701 and m["truncated"] is True


async def test_crtsh_retries_once_then_fails(respx_mock, run, fx, monkeypatch):
    async def no_sleep(_):
        return None

    monkeypatch.setattr("sherlock_core.modules.crtsh.asyncio.sleep", no_sleep)
    route = respx_mock.get(CRT).mock(side_effect=[httpx.Response(502), httpx.Response(200, json=fx("crtsh"))])
    assert len(await run("crtsh", "domain", "example.com")) == 1 and route.call_count == 2
    route.mock(side_effect=[httpx.Response(503), httpx.ReadTimeout("slow")])
    with pytest.raises(RuntimeError, match="crt.sh unavailable"):
        await run("crtsh", "domain", "example.com")


async def test_crtsh_empty_and_bad_input(respx_mock, run, meta):
    respx_mock.get(CRT).respond(json=[])
    assert await run("crtsh", "domain", "example.com") == []
    (err,) = await run("crtsh", "domain", "not a domain")
    assert err["status"] == "error"


# ------------------------------------------------------------------ rdap
async def test_rdap_domain(respx_mock, run, fx, meta):
    respx_mock.get("https://rdap.org/domain/example.com").respond(
        302, headers={"location": "https://rdap.verisign.com/com/v1/domain/example.com"},
    )
    respx_mock.get("https://rdap.verisign.com/com/v1/domain/example.com").respond(json=fx("rdap_domain"))
    (row,) = await run("rdap", "domain", "example.com")
    m = meta(row)
    assert m["registrar"] == "RESERVED-Internet Assigned Numbers Authority" and m["registrar_iana_id"] == "376"
    assert m["created_at"] == "1995-08-14T04:00:00Z" and m["expires_at"] == "2027-08-13T04:00:00Z"
    assert m["updated_at"] == "2026-08-14T08:01:43Z"
    assert m["nameservers"] == ["elliott.ns.cloudflare.com", "hera.ns.cloudflare.com"]
    assert "client transfer prohibited" in m["status"] and m["dnssec"] is True
    assert row["extra_metadata"]["extra"] == {}


async def test_rdap_ip_keeps_org_level_fields_only(respx_mock, run, fx, meta):
    respx_mock.get("https://rdap.org/ip/1.1.1.1").respond(json=fx("rdap_ip"))
    (row,) = await run("rdap", "ip", "1.1.1.1")
    m = meta(row)
    assert m["network_name"] == "APNIC-LABS" and m["country"] == "AU" and m["cidr"] == ["1.1.1.0/24"]
    assert m["organization"] == "APNIC Research and Development"
    blob = json.dumps(row)
    assert "@" not in blob and "+61" not in blob and "Cordelia" not in blob  # no contact vCard data
    assert "email" not in row["extra_metadata"]["extra"]


async def test_rdap_unregistered_and_limited(respx_mock, run, meta):
    respx_mock.get("https://rdap.org/domain/nx-zzq-918273.com").respond(404, json={"errorCode": 404})
    assert await run("rdap", "domain", "nx-zzq-918273.com") == []
    respx_mock.get("https://rdap.org/ip/8.8.8.8").respond(429)
    (err,) = await run("rdap", "ip", "8.8.8.8")
    assert err["status"] == "error" and "429" in meta(err)["reason"]
    (bad,) = await run("rdap", "ip", "999.1.1.1")
    assert bad["status"] == "error"


# ------------------------------------------------------------------ dns_records
async def test_dns_records(respx_mock, run, fx, meta):
    route = _doh(fx, respx_mock)
    (row,) = await run("dns_records", "domain", "example.com")
    m = meta(row)
    assert route.call_count == 7  # six record types + _dmarc
    assert set(m["records"]) == {"A", "AAAA", "MX", "NS", "TXT"}  # no CNAME at the apex
    assert m["records"]["MX"] == ["0 ."]  # null MX
    assert "hera.ns.cloudflare.com" in m["records"]["NS"]
    assert m["has_spf"] is True and m["spf_record"] == "v=spf1 -all"
    assert m["has_dmarc"] is True and m["dmarc_record"].startswith("v=DMARC1")


async def test_dns_records_nxdomain_and_resolver_down(respx_mock, run, fx):
    respx_mock.get(DOH).respond(json=fx("doh")["nxdomain"] | {"Status": 3})
    assert await run("dns_records", "domain", "nx-zzq-918273.example.com") == []
    respx_mock.get(DOH).mock(side_effect=httpx.ConnectError("down"))
    with pytest.raises(RuntimeError, match="resolver unreachable"):
        await run("dns_records", "domain", "example.com")


async def test_dns_resolve_keeps_only_the_asked_type(respx_mock, http, fx):
    from sherlock_core.modules.dns_records import resolve

    respx_mock.get(DOH).respond(json=fx("doh")["cname_chain"])
    status, data = await resolve(http, "www.python.org", "A")
    assert status == 0 and data == ["167.82.48.223"]  # the CNAME in the answer chain is dropped


# ------------------------------------------------------------------ internetdb
async def test_internetdb_ip(respx_mock, run, fx, meta):
    respx_mock.get("https://internetdb.shodan.io/1.1.1.1").respond(json=fx("internetdb"))
    (row,) = await run("internetdb", "ip", "1.1.1.1")
    m = meta(row)
    assert 443 in m["ports"] and "one.one.one.one" in m["hostnames"]
    assert m["cpes"] == ["cpe:/a:cloudflare:cloudflare"] and m["vulns"] == [] and m["tags"] == ["pqc"]


async def test_internetdb_domain_resolves_a_records(respx_mock, run, fx, meta):
    _doh(fx, respx_mock)
    ips = [a["data"] for a in fx("doh")["example.com"]["A"]["Answer"]]
    respx_mock.get(f"https://internetdb.shodan.io/{ips[0]}").respond(json=fx("internetdb") | {"ip": ips[0]})
    respx_mock.get(f"https://internetdb.shodan.io/{ips[1]}").respond(404, json={"detail": "No information available"})
    rows = await run("internetdb", "domain", "example.com")
    assert [meta(r)["ip"] for r in rows] == [ips[0]]


async def test_internetdb_no_information_and_private_ip(respx_mock, run):
    respx_mock.get("https://internetdb.shodan.io/9.9.9.9").respond(404, json={"detail": "No information available"})
    assert await run("internetdb", "ip", "9.9.9.9") == []
    assert await run("internetdb", "ip", "10.0.0.1") == []  # private address: not even queried


# ------------------------------------------------------------------ wayback
def _cdx(fx, respx_mock, *, sample=None):
    def answer(request: httpx.Request) -> httpx.Response:
        p = request.url.params
        if p.get("showGroupCount"):
            return httpx.Response(200, json=fx("wayback_years"))
        if p.get("matchType") == "domain":
            return sample or httpx.Response(200, json=fx("wayback_urls"))
        return httpx.Response(200, json=fx("wayback_last" if p.get("limit") == "-1" else "wayback_first"))

    return respx_mock.get(CDX).mock(side_effect=answer)


async def test_wayback_history(respx_mock, run, fx, meta):
    route = _cdx(fx, respx_mock)
    (row,) = await run("wayback", "domain", "example.com")
    m = meta(row)
    assert route.call_count == 3  # the first capture comes from the per-year query
    assert m["first_capture"] == "2002-01-20T14:25:10Z" and m["last_capture"] == "2026-11-19T16:42:10Z"
    assert m["captures_by_year"]["2002"] == 51 and m["total_captures"] == sum(m["captures_by_year"].values())
    assert m["sample_urls"][0] == {
        "url": "http://example.com:80/", "captured_at": "2002-01-20T14:25:10Z", "mimetype": "text/html",
        "archived_url": "https://web.archive.org/web/20020120142510/http://example.com:80/",
    }
    assert "partial" not in m


async def test_wayback_partial_never_archived_and_down(respx_mock, run, fx, meta):
    _cdx(fx, respx_mock, sample=httpx.Response(504))
    (row,) = await run("wayback", "domain", "example.com")
    assert "sample_urls" not in meta(row) and "504" in meta(row)["partial"]
    respx_mock.get(CDX).respond(json=[])
    assert await run("wayback", "domain", "never-archived.example") == []
    respx_mock.get(CDX).respond(503)
    with pytest.raises(RuntimeError, match="CDX API unavailable"):
        await run("wayback", "domain", "example.com")


# ------------------------------------------------------------------ ripestat
async def test_ripestat(respx_mock, run, fx, meta):
    route = respx_mock.get("https://stat.ripe.net/data/prefix-overview/data.json").respond(
        json=fx("ripestat_prefix_overview"),
    )
    respx_mock.get("https://stat.ripe.net/data/rir-geo/data.json").respond(json=fx("ripestat_rir_geo"))
    (row,) = await run("ripestat", "ip", "1.1.1.1")
    assert route.calls.last.request.url.params["resource"] == "1.1.1.1"
    assert meta(row) == {
        "asn": 13335, "holder": "CLOUDFLARENET - Cloudflare, Inc.", "prefix": "1.1.1.0/24",
        "announced": True, "country": "AU", "registry_block": "APNIC (Status: ALLOCATED)",
    }


async def test_ripestat_unannounced_and_down(respx_mock, run):
    empty = {"status": "ok", "data": {"asns": [], "announced": False, "resource": "192.0.2.1", "type": "ip"}}
    respx_mock.get("https://stat.ripe.net/data/prefix-overview/data.json").respond(json=empty)
    respx_mock.get("https://stat.ripe.net/data/rir-geo/data.json").respond(
        json={"status": "ok", "data": {"located_resources": []}},
    )
    assert await run("ripestat", "ip", "192.0.2.1") == []
    respx_mock.get("https://stat.ripe.net/data/prefix-overview/data.json").respond(500)
    respx_mock.get("https://stat.ripe.net/data/rir-geo/data.json").respond(500)
    with pytest.raises(RuntimeError, match="ripestat unavailable"):
        await run("ripestat", "ip", "1.1.1.1")


# ------------------------------------------------------------------ wallet
def test_wallet_format_detection():
    assert detect_chain(GENESIS) == "btc"
    assert detect_chain("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq") == "btc"
    assert detect_chain("BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ") == "btc"
    assert detect_chain(ETH_ADDR) == "evm"
    assert detect_chain("0x1234") is None and detect_chain("hello") is None


async def test_wallet_bitcoin(respx_mock, run, fx, meta):
    respx_mock.get(f"{BTC}/address/{GENESIS}").respond(json=fx("blockstream_address"))
    respx_mock.get(f"{BTC}/address/{GENESIS}/txs").respond(json=fx("blockstream_txs"))
    (row,) = await run("wallet", "wallet", GENESIS)
    m = meta(row)
    assert row["platform"] == "bitcoin" and m["chain"] == "bitcoin"
    assert m["balance_sats"] == 5771588996 and m["balance_btc"] == "57.71588996" and m["tx_count"] == 67565
    assert m["last_seen"].startswith("20") and "first_seen" not in m and "first_seen omitted" in m["note"]
    assert "txid" not in json.dumps(row)  # individual transactions are not stored


async def test_wallet_bitcoin_short_history_has_first_seen(respx_mock, run, fx, meta):
    addr = fx("blockstream_address")
    addr["chain_stats"]["tx_count"] = 3
    respx_mock.get(f"{BTC}/address/{GENESIS}").respond(json=addr)
    respx_mock.get(f"{BTC}/address/{GENESIS}/txs").respond(json=fx("blockstream_txs"))
    (row,) = await run("wallet", "wallet", GENESIS)
    assert meta(row)["first_seen"] <= meta(row)["last_seen"] and "note" not in meta(row)


async def test_wallet_ethereum(respx_mock, run, fx, meta):
    respx_mock.get(f"{ETH}/addresses/{ETH_ADDR}").respond(json=fx("blockscout_address"))
    respx_mock.get(f"{ETH}/addresses/{ETH_ADDR}/counters").respond(json=fx("blockscout_counters"))
    (row,) = await run("wallet", "wallet", ETH_ADDR)
    m = meta(row)
    assert row["platform"] == "ethereum" and row["extra_metadata"]["extra"] == {"ens": "vitalik.eth"}
    assert m["balance_wei"] == "5798969845714210716" and m["balance_eth"] == "5.798969845714210716"
    assert m["tx_count"] == 78434


async def test_wallet_errors(respx_mock, run, meta):
    (bad,) = await run("wallet", "wallet", "definitely-not-an-address")
    assert bad["status"] == "error" and "format" in meta(bad)["reason"]
    checksum = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb"
    respx_mock.get(f"{BTC}/address/{checksum}").respond(400, text="base58 error")
    (err,) = await run("wallet", "wallet", checksum)
    assert err["status"] == "error" and err["platform"] == "bitcoin"
    respx_mock.get(f"{ETH}/addresses/{ETH_ADDR}").respond(404, json={"message": "Not found"})
    assert await run("wallet", "wallet", ETH_ADDR) == []
