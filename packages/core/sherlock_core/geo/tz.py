"""The local time zone of a coordinate, worked out offline (no weather service needed).

Uses the optional `timezonefinder` package (pure Python, offline, MIT; installed with the
`media` extra) in its file-backed mode (`in_memory=False`), so the zone polygons stay on disk
and are only memory-mapped. Without the package `zone_name_at` returns None and the caller falls
back to the weather response's zone, the claim's own offset, or an approximate solar time.
"""
from __future__ import annotations

import logging
import threading
from typing import Any

log = logging.getLogger("sherlock.geo.tz")

_finder: Any = None
_finder_failed = False
_lock = threading.Lock()


def _get_finder() -> Any:
    global _finder, _finder_failed
    if _finder is not None or _finder_failed:
        return _finder
    with _lock:
        if _finder is None and not _finder_failed:
            try:
                from timezonefinder import TimezoneFinder

                _finder = TimezoneFinder(in_memory=False)
            except Exception as e:  # noqa: BLE001 - missing package or data: fall back, never fail
                log.info("offline time zone lookup unavailable: %s", type(e).__name__)
                _finder_failed = True
    return _finder


def zone_name_at(lat: float, lon: float) -> str | None:
    """IANA zone name ('Europe/Paris') at a point, or None (package missing, open sea, bad input)."""
    finder = _get_finder()
    if finder is None:
        return None
    try:
        name = finder.timezone_at(lng=float(lon), lat=float(lat))
    except Exception:  # noqa: BLE001 - out of range or corrupt data: no zone
        return None
    # open-sea "Etc/GMT+1" style zones are nautical offsets, not a place's local time
    if not isinstance(name, str) or not name or name.startswith("Etc/"):
        return None
    return name
