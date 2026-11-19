"""Offline phone-number metadata from the `phonenumbers` library.

Validity, numbering-plan region, original carrier, line type and time zones only.
There is deliberately no owner, subscriber or account lookup of any kind.
"""
from __future__ import annotations

import asyncio
from typing import Any

import phonenumbers  # optional dep: ImportError => module skipped by the registry
from phonenumbers import carrier, geocoder, timezone

from sherlock_core.modules import register
from sherlock_core.modules._util import clean, error_finding
from sherlock_core.modules.base import Module, ModuleContext, Target

_LINE_TYPES = {
    phonenumbers.PhoneNumberType.FIXED_LINE: "fixed_line",
    phonenumbers.PhoneNumberType.MOBILE: "mobile",
    phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE: "fixed_line_or_mobile",
    phonenumbers.PhoneNumberType.TOLL_FREE: "toll_free",
    phonenumbers.PhoneNumberType.PREMIUM_RATE: "premium_rate",
    phonenumbers.PhoneNumberType.SHARED_COST: "shared_cost",
    phonenumbers.PhoneNumberType.VOIP: "voip",
    phonenumbers.PhoneNumberType.PERSONAL_NUMBER: "personal_number",
    phonenumbers.PhoneNumberType.PAGER: "pager",
    phonenumbers.PhoneNumberType.UAN: "uan",
    phonenumbers.PhoneNumberType.VOICEMAIL: "voicemail",
}


def describe(value: str, default_region: str | None = None) -> dict[str, Any]:
    """Metadata for one number. Raises phonenumbers.NumberParseException when unparsable."""
    num = phonenumbers.parse(value, default_region)
    e164 = phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.E164)
    return clean({
        "e164": e164,
        "international": phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.INTERNATIONAL),
        "valid": phonenumbers.is_valid_number(num),
        "possible": phonenumbers.is_possible_number(num),
        "country_code": num.country_code,
        "region": phonenumbers.region_code_for_number(num),
        "region_description": geocoder.description_for_number(num, "en"),
        # carrier the number range was originally assigned to; ported numbers are not tracked
        "carrier": carrier.name_for_number(num, "en"),
        "line_type": _LINE_TYPES.get(phonenumbers.number_type(num), "unknown"),
        "timezones": [t for t in timezone.time_zones_for_number(num) if t != "Etc/Unknown"],
    })


@register
class PhoneMeta(Module):
    name = "phone_meta"
    title = "Phone number metadata"
    description = "Validity, country, original carrier, line type and time zones of a phone number. No owner lookup."
    inputs = ("phone",)
    queue = "identity"
    source_url = "https://github.com/daviddrysdale/python-phonenumbers"
    timeout_s = 15.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        region = target.params.get("region") or None
        try:
            # the first call loads the metadata tables; keep the event loop free meanwhile
            meta = await asyncio.to_thread(describe, target.value.strip(), region)
        except phonenumbers.NumberParseException as e:
            return [error_finding(ctx, self, target, "phone", f"not a parsable phone number: {e}")]
        return [ctx.finding(
            self, target, platform="phone",
            status="found" if meta.get("valid") else "not_found",
            extra={"phone": meta["e164"]}, meta=meta,
        )]
