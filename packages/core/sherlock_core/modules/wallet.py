"""Public on-chain summary of a wallet address.

Bitcoin: Blockstream Esplora API (keyless): balance, transaction count, first / last seen.
EVM (Ethereum mainnet): Blockscout API v2 (keyless): balance, transaction count, ENS name.
Counterparties and individual transactions are not stored.
"""
from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx

from sherlock_core.modules import register
from sherlock_core.modules._util import (
    UpstreamError,
    clean,
    describe_http_error,
    error_finding,
    fetch_capped,
    json_or_none,
)
from sherlock_core.modules.base import Module, ModuleContext, Target

BTC_API = "https://blockstream.info/api"
ETH_API = "https://eth.blockscout.com/api/v2"
ESPLORA_PAGE = 25           # confirmed transactions returned by /txs, newest first
MAX_TXS_BYTES = 2_000_000

_BTC_LEGACY = re.compile(r"^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$")
_BTC_BECH32 = re.compile(r"^bc1[02-9ac-hj-np-z]{11,71}$")
_EVM = re.compile(r"^0x[0-9a-fA-F]{40}$")


def detect_chain(address: str) -> str | None:
    """'btc', 'evm' or None, from the address format alone."""
    a = address.strip()
    if _EVM.match(a):
        return "evm"
    if _BTC_LEGACY.match(a) or _BTC_BECH32.match(a.lower()):
        return "btc"
    return None


def _units(amount: int, decimals: int) -> str:
    return format((Decimal(amount) / (Decimal(10) ** decimals)).normalize(), "f")


def _block_time(ts: Any) -> str | None:
    try:
        return datetime.fromtimestamp(int(ts), UTC).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


@register
class Wallet(Module):
    name = "wallet"
    title = "Wallet summary"
    description = "Balance, transaction count and activity dates of a Bitcoin address, or balance and transaction count of an Ethereum address."
    inputs = ("wallet",)
    queue = "infra"
    source_url = "https://github.com/Blockstream/esplora/blob/master/API.md"
    timeout_s = 45.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        address = target.value.strip()
        chain = detect_chain(address)
        if chain == "btc":
            return await self._btc(address.lower() if address.lower().startswith("bc1") else address, target, ctx)
        if chain == "evm":
            return await self._evm(address, target, ctx)
        return [error_finding(ctx, self, target, "wallet", "not a recognised Bitcoin or EVM address format")]

    async def _btc(self, address: str, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        r = await ctx.http.get(f"{BTC_API}/address/{address}", timeout=15.0)
        if r.status_code == 400:  # e.g. "base58 error": right shape, bad checksum
            return [error_finding(ctx, self, target, "bitcoin", "not a valid Bitcoin address")]
        if r.status_code in (403, 429):
            return [error_finding(ctx, self, target, "bitcoin", describe_http_error(r))]
        r.raise_for_status()
        body = json_or_none(r)
        if not isinstance(body, dict) or not isinstance(body.get("chain_stats"), dict):
            return [error_finding(ctx, self, target, "bitcoin", "unexpected response format")]
        chain, pool = body["chain_stats"], body.get("mempool_stats") or {}
        tx_count = int(chain.get("tx_count") or 0)
        received = int(chain.get("funded_txo_sum") or 0)
        balance = received - int(chain.get("spent_txo_sum") or 0)
        pending = int(pool.get("funded_txo_sum") or 0) - int(pool.get("spent_txo_sum") or 0)

        first_seen = last_seen = note = None
        if tx_count:
            await ctx.progress(50, "fetching recent transactions")
            try:
                raw, _ = await fetch_capped(
                    ctx.http, f"{BTC_API}/address/{address}/txs",
                    max_bytes=MAX_TXS_BYTES, content_prefix="application/json",
                )
                times = sorted(
                    int(t["status"]["block_time"]) for t in json.loads(raw)
                    if isinstance(t, dict) and isinstance(t.get("status"), dict) and t["status"].get("block_time")
                )
                if times:
                    last_seen = _block_time(times[-1])
                    if tx_count <= ESPLORA_PAGE:  # the single page then holds the whole history
                        first_seen = _block_time(times[0])
                    else:
                        note = "first_seen omitted: history longer than one API page"
            except (UpstreamError, httpx.HTTPError, ValueError, KeyError, TypeError) as e:
                note = f"activity dates unavailable: {str(e) or type(e).__name__}"
        return [ctx.finding(
            self, target, platform="bitcoin", url=f"https://blockstream.info/address/{address}",
            meta=clean({
                "chain": "bitcoin", "address": address,
                "balance_sats": balance, "balance_btc": _units(balance, 8),
                "total_received_btc": _units(received, 8),
                "unconfirmed_sats": pending or None,
                "tx_count": tx_count, "pending_tx_count": int(pool.get("tx_count") or 0) or None,
                "first_seen": first_seen, "last_seen": last_seen, "note": note,
            }),
        )]

    async def _evm(self, address: str, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        r = await ctx.http.get(f"{ETH_API}/addresses/{address}", timeout=15.0)
        if r.status_code == 404:  # never seen on chain
            return []
        if r.status_code in (403, 422, 429):
            return [error_finding(ctx, self, target, "ethereum", describe_http_error(r))]
        r.raise_for_status()
        body = json_or_none(r)
        if not isinstance(body, dict) or "coin_balance" not in body:
            return [error_finding(ctx, self, target, "ethereum", "unexpected response format")]
        wei = int(body.get("coin_balance") or 0)
        tx_count = None
        try:
            c = await ctx.http.get(f"{ETH_API}/addresses/{address}/counters", timeout=15.0)
            counters = json_or_none(c) if c.status_code == 200 else None
            if isinstance(counters, dict):
                tx_count = int(counters.get("transactions_count") or 0)
        except (httpx.HTTPError, ValueError) as e:
            ctx.log.info("wallet counters lookup failed: %s", e)
        return [ctx.finding(
            self, target, platform="ethereum", url=f"https://eth.blockscout.com/address/{address}",
            extra=clean({"ens": body.get("ens_domain_name")}),
            meta=clean({
                "chain": "ethereum", "address": body.get("hash") or address,
                "balance_wei": str(wei), "balance_eth": _units(wei, 18),
                "tx_count": tx_count,
                "is_contract": body.get("is_contract"),
                "has_tokens": body.get("has_tokens"),
                "has_token_transfers": body.get("has_token_transfers"),
                "note": "first/last seen are not collected for EVM addresses",
            }),
        )]
