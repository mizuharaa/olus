"""
Shared cache layer for the live-flight feeds.

``OpenSkyClient`` and ``AdsbClient`` differ only in *where* the aircraft come
from. The stale-while-revalidate cache, the 60 s attempt gate, the callsign
search and the icao24 lookup on top of the cached list are identical, so they
live here and each client only implements ``_fetch_flights``.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from src.data.airlines import parse_flight_query

logger = logging.getLogger(__name__)

# Empty cache + a fetch attempted this recently → return [] rather than block.
ATTEMPT_GATE_SEC = 60


class LiveFlightFeed:
    """Stale-while-revalidate cache over a provider-specific fetch."""

    def __init__(self, cache_ttl: float) -> None:
        self._cache_ttl = cache_ttl
        self._cache: list[dict] = []
        self._cache_ts: float = 0.0
        self._last_fetch_attempt: float = 0.0  # last attempt (success or failure)
        self._lock = asyncio.Lock()
        self._last_error: Optional[str] = None
        self._refresh_task: asyncio.Task | None = None

    # ── Provider hook ─────────────────────────────────────────────────────────

    async def _fetch_flights(self) -> Optional[list[dict]]:
        """Fetch + normalise the feed. ``None`` on failure (keeps stale cache)."""
        raise NotImplementedError

    # ── Public API ────────────────────────────────────────────────────────────

    async def get_us_flights(self, force: bool = False) -> list[dict]:
        """
        Return all tracked flights over US airspace.

        Stale-while-revalidate: if any cached data exists (even past TTL),
        return it immediately and kick off a background refresh. This keeps
        the endpoint fast even when the upstream feed is slow or blocked.

        If the cache is empty AND a fetch was attempted recently (within 60s),
        return [] immediately instead of blocking again — avoids hammering a
        blocked connection on every request.

        Only blocks synchronously on the very first call (truly empty cache,
        no recent attempt).
        """
        now = time.monotonic()
        age = now - self._cache_ts
        attempt_age = now - self._last_fetch_attempt

        # Fresh cache — return immediately.
        if not force and self._cache and age < self._cache_ttl:
            return self._cache

        # Stale non-empty cache — return now, refresh in background.
        if self._cache and not force:
            logger.debug("feed: stale cache (%ds old) — refreshing in background", int(age))
            if (
                not self._lock.locked()
                and attempt_age >= ATTEMPT_GATE_SEC
                and (self._refresh_task is None or self._refresh_task.done())
            ):
                self._refresh_task = asyncio.create_task(self._do_refresh())
            return self._cache

        # Empty cache but we tried recently — return [] rather than blocking.
        if not force and self._last_fetch_attempt > 0 and attempt_age < ATTEMPT_GATE_SEC:
            logger.debug("feed: no cache, last attempt %ds ago — skipping fetch", int(attempt_age))
            return []

        # Must fetch synchronously (first call or forced).
        if not force and self._lock.locked():
            return self._cache
        async with self._lock:
            # Re-check after acquiring lock.
            now = time.monotonic()
            age = now - self._cache_ts
            attempt_age = now - self._last_fetch_attempt
            if not force and self._cache and age < self._cache_ttl:
                return self._cache
            if not force and self._last_fetch_attempt > 0 and attempt_age < ATTEMPT_GATE_SEC:
                return self._cache

            await self._refresh_locked()
            return self._cache

    async def _do_refresh(self) -> None:
        """Background cache refresh — holds the write lock while fetching."""
        async with self._lock:
            now = time.monotonic()
            if now - self._last_fetch_attempt < ATTEMPT_GATE_SEC:
                return
            if self._cache and now - self._cache_ts < self._cache_ttl:
                return
            await self._refresh_locked()

    async def _refresh_locked(self) -> None:
        self._last_fetch_attempt = time.monotonic()
        flights = await self._fetch_flights()
        if flights is not None:
            self._cache = flights
            self._cache_ts = time.monotonic()
            self._last_error = None
            logger.debug("feed: cached %d flights", len(self._cache))
        else:
            logger.warning("feed: fetch failed — keeping cache (%d flights)", len(self._cache))

    async def search(self, query: str) -> list[dict]:
        """Search live flights by IATA/ICAO flight number (e.g. 'AA123', 'UAL456')."""
        flights = await self.get_us_flights()
        q = query.strip().upper()
        if not q:
            return []

        icao_prefix, iata_code, num = parse_flight_query(q)
        results: list[dict] = []

        if icao_prefix:
            target = icao_prefix + num
            results = [f for f in flights if f["callsign"].startswith(target)]

        if not results and iata_code:
            target = iata_code + num
            results = [f for f in flights if (f.get("flight_iata") or "").startswith(target)]

        if not results:
            results = [f for f in flights if q in f["callsign"]]

        return results[:20]

    async def get_by_icao24(self, icao24: str) -> Optional[dict]:
        """Look up a single aircraft by ICAO 24-bit transponder hex."""
        flights = await self.get_us_flights()
        target = icao24.lower().strip()
        return next((f for f in flights if f["icao24"] == target), None)

    def status(self) -> dict:
        now = time.monotonic()
        return {
            "cached_flights": len(self._cache),
            "cache_age_sec": round(now - self._cache_ts, 1) if self._cache_ts else None,
            "last_attempt_age_sec": round(now - self._last_fetch_attempt, 1)
            if self._last_fetch_attempt
            else None,
            "last_error": self._last_error,
        }
