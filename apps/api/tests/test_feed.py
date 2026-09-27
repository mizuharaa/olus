"""Concurrent stale readers must share one refresh, including on provider failure."""

import asyncio
import time
from unittest.mock import AsyncMock

from src.data.feed import LiveFlightFeed


async def test_stale_readers_share_refresh_and_back_off():
    feed = LiveFlightFeed(cache_ttl=120)
    feed._cache = [{"icao24": "retained"}]
    feed._cache_ts = time.monotonic() - 121
    feed._last_fetch_attempt = time.monotonic() - 61
    feed._fetch_flights = AsyncMock(return_value=None)
    await asyncio.gather(*(feed.get_us_flights() for _ in range(30)))
    await asyncio.sleep(0)
    await asyncio.gather(*(feed.get_us_flights() for _ in range(30)))
    assert feed._fetch_flights.await_count == 1
    assert feed._cache == [{"icao24": "retained"}]

    feed._last_fetch_attempt = time.monotonic() - 61
    feed._fetch_flights.return_value = [{"icao24": "fresh"}]
    await asyncio.gather(*(feed.get_us_flights() for _ in range(30)))
    await asyncio.sleep(0)
    assert feed._fetch_flights.await_count == 2
    assert feed._cache == [{"icao24": "fresh"}]
    feed._cache = []
    feed._last_fetch_attempt = time.monotonic() - 61
    async with feed._lock:
        assert await asyncio.wait_for(feed.get_us_flights(), timeout=0.1) == []
