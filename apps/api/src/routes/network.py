"""Network data endpoints.

All static network reads are served from the in-memory cache in
``src.network.cache`` (parsed once at startup) rather than re-reading YAML on
every request — this is what keeps read-load p95 low under concurrency.
"""

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from src.network import cache
from src.network.stress_test import (
    DEFAULT_AIRPORTS,
    DEFAULT_EVENT_KINDS,
    run_stress_test,
)

router = APIRouter()

# Static network data is immutable for the process lifetime, so clients may
# cache it briefly and revalidate cheaply with the ETag.
_NETWORK_CACHE_CONTROL = "public, max-age=60"


@router.get("/network")
async def get_network(request: Request):
    """Return the full Nimbus Air network.

    Served from pre-serialized JSON bytes with a strong ETag; an
    ``If-None-Match`` that matches is answered with a 304 so dashboard polls
    don't re-transfer the ~95 KB payload.
    """
    body, etag = cache.get_network_json()
    if request.headers.get("if-none-match") == etag:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": _NETWORK_CACHE_CONTROL},
        )
    return Response(
        content=body,
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": _NETWORK_CACHE_CONTROL},
    )


@router.get("/airports")
async def get_airports():
    return {"airports": cache.get_airports()}


@router.get("/airports/{airport_id}")
async def get_airport(airport_id: str):
    for ap in cache.get_airports():
        if ap["id"] == airport_id.upper():
            return ap
    raise HTTPException(status_code=404, detail=f"Airport {airport_id} not found")


@router.get("/aircraft")
async def get_aircraft():
    return {"aircraft": cache.get_aircraft()}


@router.get("/aircraft/{tail}")
async def get_single_aircraft(tail: str):
    for ac in cache.get_aircraft():
        if ac["id"] == tail.upper():
            return ac
    raise HTTPException(status_code=404, detail=f"Aircraft {tail} not found")


@router.get("/flights")
async def get_flights(
    status: str | None = None, origin: str | None = None, destination: str | None = None
):
    flights = cache.get_flights()
    if status:
        flights = [f for f in flights if f.get("status") == status]
    if origin:
        flights = [f for f in flights if f.get("origin") == origin.upper()]
    if destination:
        flights = [f for f in flights if f.get("destination") == destination.upper()]
    return {"flights": flights, "count": len(flights)}


@router.get("/flights/{flight_id}")
async def get_flight(flight_id: str):
    for f in cache.get_flights():
        if f["id"] == flight_id.upper():
            return f
    raise HTTPException(status_code=404, detail=f"Flight {flight_id} not found")


@router.get("/crews")
async def get_crews():
    return {
        "crew_members": cache.get_crew_members(),
        "crew_pairings": cache.get_crew_pairings(),
    }


@router.get("/schedule")
async def get_schedule(request: Request):
    """Return current schedule with live state from simulation engine."""
    engine = request.app.state.engine
    if engine:
        return {"flights": engine.get_schedule_snapshot()}
    return {"flights": cache.get_flights()}


class StressTestRequest(BaseModel):
    airports: list[str] | None = None
    event_kinds: list[str] | None = None
    iterations_per_airport: int = 5
    seed: int | None = 42


@router.post("/network/stress-test")
def post_stress_test(payload: StressTestRequest, request: Request):
    """
    Network vulnerability stress test — Slice 6.

    Runs a Monte-Carlo sweep of single-airport disruptions across the
    Nimbus Air schedule and returns a ranked vulnerability heatmap. Used
    by `/simulator/stress-test` to surface the most fragile hubs before
    a real disruption hits.
    """
    predictor = getattr(request.app.state, "predictor", None)
    if predictor is None:
        raise HTTPException(status_code=503, detail="Cascade predictor not initialised")

    flights = cache.get_flights()
    aircraft = cache.get_aircraft()

    return run_stress_test(
        flights=flights,
        aircraft=aircraft,
        predictor=predictor,
        airports=payload.airports or DEFAULT_AIRPORTS,
        event_kinds=payload.event_kinds or DEFAULT_EVENT_KINDS,
        iterations_per_airport=max(1, min(20, payload.iterations_per_airport)),
        seed=payload.seed,
    )
