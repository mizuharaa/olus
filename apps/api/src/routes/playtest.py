"""
Playtest mode endpoints — Slice 7 (free flight sandbox).

A stateless adjunct to the canonical simulator. The user builds their own
flight set in the browser (origin → destination, aircraft type, departure
time) and posts the list here; we run the cascade predictor + cost
calculator + carbon ledger on that flight set and return the same shape
the dashboard already understands.

Nothing is persisted server-side. Each request is self-contained — the
browser owns the truth. This makes playtest demos repeatable and means we
can scale the route to a stateless edge worker later without rework.
"""

from __future__ import annotations

import datetime
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.costs.calculator import AirlineDelayCalculator
from src.costs.carbon import portfolio_carbon

logger = logging.getLogger(__name__)
router = APIRouter()

_calc = AirlineDelayCalculator()


# ── Wire shapes ──────────────────────────────────────────────────────────────


class PlaytestFlight(BaseModel):
    """A single user-built flight. Mirrors the canonical ScheduledFlight
    shape but every field is required so the predictor has clean inputs."""

    id: str
    aircraft_id: str
    origin: str  # ICAO, e.g. "KORD"
    destination: str
    scheduled_departure: str  # ISO-8601
    scheduled_arrival: str  # ISO-8601
    passengers: int = 150
    status: str = "scheduled"

    # The predictor reads `delay_minutes` to seed propagation from upstream
    # legs. Defaulting to 0 keeps the sandbox clean unless the user is
    # explicitly modelling a delayed inbound.
    delay_minutes: int = 0


class PlaytestAircraft(BaseModel):
    id: str
    type: str = "B737-800"
    seats: int = 162
    base_airport_id: str = "KORD"
    min_turn_minutes: int = 45


class PlaytestEvent(BaseModel):
    """Optional disruption event injected over the user's flight set."""

    kind: str
    params: dict = Field(default_factory=dict)


class PlaytestRequest(BaseModel):
    flights: list[PlaytestFlight] = Field(max_length=2000)
    aircraft: list[PlaytestAircraft] = Field(default_factory=list, max_length=500)
    event: Optional[PlaytestEvent] = None


# ── Endpoint ─────────────────────────────────────────────────────────────────


@router.post("/playtest/cascade")
def post_playtest_cascade(payload: PlaytestRequest, request: Request):
    """
    Run the cascade predictor + cost engine + carbon ledger on a user-built
    flight set. Returns the same predictions / cascade summary / cost
    rollup shape the canonical simulator uses, so the playtest page can
    reuse all the same dashboard primitives.

    This is intentionally stateless — nothing is written to engine.state.
    The browser owns the truth.
    """
    predictor = getattr(request.app.state, "predictor", None)
    weather = getattr(request.app.state, "weather", None)
    if predictor is None:
        raise HTTPException(status_code=503, detail="Cascade predictor not initialised")

    if not payload.flights:
        raise HTTPException(status_code=400, detail="Need at least one flight in the playtest set.")

    flights = [f.model_dump() for f in payload.flights]
    aircraft = (
        [a.model_dump() for a in payload.aircraft] if payload.aircraft else _infer_aircraft(flights)
    )
    event = payload.event.model_dump() if payload.event else {}

    metar_data = weather.get_all_cached() if weather else {}
    now = datetime.datetime.now(datetime.timezone.utc)

    # Run cascade — same physics module that powers the canonical simulator.
    predictions: dict[str, dict] = predictor.predict(flights, event, metar_data, now)

    # Compute cascade summary (direct / order-1 / order-2 buckets) so the
    # frontend can show the same Cascade Timeline strip without rewriting
    # the bucket math.
    summary = _summary(predictions)

    # Synthesize delayed / cancelled lists from predictions so the cost
    # calculator and carbon ledger can score the playtest set the same way
    # they score a real solve.
    cancelled = [fid for fid, p in predictions.items() if p.get("cancelled")]
    delayed = [
        {"flight_id": fid, "delay_minutes": int(p.get("delay_minutes", 0) or 0)}
        for fid, p in predictions.items()
        if not p.get("cancelled") and int(p.get("delay_minutes", 0) or 0) > 0
    ]

    flights_map = {f["id"]: f for f in flights}
    ac_by_id = {a["id"]: a.get("type", "") for a in aircraft}
    ac_type_map = {f["id"]: ac_by_id.get(f.get("aircraft_id", ""), "") for f in flights}

    event_kind = (payload.event.kind if payload.event else "") or ""
    cost = _calc.portfolio_cost(
        flights=flights_map,
        cancelled=cancelled,
        delayed=delayed,
        event_kind=event_kind,
        aircraft_type_map=ac_type_map,
    )
    carbon = portfolio_carbon(
        flights=flights_map,
        cancelled=cancelled,
        delayed=delayed,
        swaps=[],
        aircraft_type_map=ac_type_map,
    )

    return {
        "flight_states": _flight_states(flights, predictions),
        "cascade_summary": summary,
        "predictions": predictions,
        "cost": cost,
        "carbon": carbon,
        "event": event or None,
        "flight_count": len(flights),
    }


# ── Internals ────────────────────────────────────────────────────────────────


def _infer_aircraft(flights: list[dict]) -> list[dict]:
    """If the client didn't supply an aircraft roster, fabricate one from
    the unique `aircraft_id` values on the flights themselves. Lets the
    user POST just a flight list and still get a working cascade."""
    seen: dict[str, dict] = {}
    for f in flights:
        aid = f.get("aircraft_id")
        if not aid or aid in seen:
            continue
        seen[aid] = {
            "id": aid,
            "type": "B737-800",
            "seats": 162,
            "base_airport_id": f.get("origin", "KORD"),
            "min_turn_minutes": 45,
        }
    return list(seen.values())


def _summary(predictions: dict[str, dict]) -> dict:
    """Bucket predictions by cascade order — mirrors engine._compute_cascade_summary."""
    direct = sum(1 for p in predictions.values() if p.get("cascade_order") == 0)
    o1 = sum(1 for p in predictions.values() if p.get("cascade_order") == 1)
    o2 = sum(1 for p in predictions.values() if p.get("cascade_order") == 2)
    total = sum(1 for p in predictions.values() if (p.get("cascade_order") or -1) >= 0)
    total_delay = sum(int(p.get("delay_minutes", 0) or 0) for p in predictions.values())
    return {
        "directly_affected": direct,
        "cascade_1": o1,
        "cascade_2": o2,
        "total_affected": total,
        "total_delay_minutes": total_delay,
    }


def _flight_states(flights: list[dict], predictions: dict[str, dict]) -> dict[str, dict]:
    """Project the raw predictor output into the same shape the WS broadcast
    uses for the real simulator. Lets the playtest page reuse FlightMap and
    CascadeTimeline unchanged."""
    out: dict[str, dict] = {}
    for f in flights:
        fid = f["id"]
        p = predictions.get(fid, {})
        cascade = p.get("cascade_order", -1)
        delay = int(p.get("delay_minutes", 0) or 0)
        cancelled = bool(p.get("cancelled"))
        out[fid] = {
            "flight_id": fid,
            "status": "cancelled" if cancelled else "delayed" if delay > 0 else "scheduled",
            "delay_minutes": delay,
            "cascade_order": cascade if cascade is not None else -1,
            "p_delayed": float(p.get("p_delayed", 0.0) or 0.0),
            "tail": f.get("aircraft_id", ""),
            "origin": f.get("origin", ""),
            "destination": f.get("destination", ""),
        }
    return out
