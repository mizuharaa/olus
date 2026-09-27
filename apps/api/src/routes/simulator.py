"""Simulator control endpoints."""

import math
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.events.catalog import normalize_event_params
from src.network import cache

router = APIRouter()

SCENARIOS_DIR = Path(__file__).parent.parent.parent.parent.parent / "data" / "scenarios"


class TriggerRequest(BaseModel):
    kind: str
    params: dict[str, Any] = Field(default_factory=dict)


@router.post("/simulator/trigger")
async def trigger_disruption(payload: TriggerRequest, request: Request):
    """Trigger a disruption event and run full cascade + recovery analysis."""
    engine = request.app.state.engine
    predictor = request.app.state.predictor
    optimizer = request.app.state.optimizer
    weather = request.app.state.weather

    if not engine:
        raise HTTPException(status_code=503, detail="Simulation engine not initialized")

    try:
        merged = normalize_event_params(payload.kind, payload.params)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    event = {
        "id": str(uuid.uuid4()),
        "kind": payload.kind,
        "triggered_at": datetime.now(timezone.utc).isoformat(),
        "params": merged,
    }
    result = await engine.trigger_event(event, predictor, optimizer, weather)
    return result


@router.post("/simulator/reset")
async def reset_simulator(request: Request):
    """Reset simulation to clean state."""
    engine = request.app.state.engine
    if engine:
        engine.reset()
    return {"status": "reset", "message": "Simulation reset to initial schedule"}


# ── Reseed the simulator from live ADS-B traffic ──────────────────────────
#
# The frontend posts its current live-flight snapshot; each aircraft becomes
# a schedule entry with origin/destination estimated by projecting its track
# backward/forward onto the nearest network airports. Events, cascade, and
# recovery plans then run over REAL current traffic instead of the static
# Nimbus YAML. POST with an empty flight list to restore the YAML network.


class LiveFlightIn(BaseModel):
    callsign: str
    airline_iata: str | None = None
    lat: float
    lon: float
    heading: float | None = None
    velocity_kt: float | None = None
    altitude_ft: float | None = None


class ReseedRequest(BaseModel):
    flights: list[LiveFlightIn] = Field(default_factory=list)


def _haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 3440.065
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _project_nm(lat: float, lon: float, bearing_deg: float, dist_nm: float) -> tuple[float, float]:
    """Flat-earth projection — fine at CONUS scale for airport snapping."""
    b = math.radians(bearing_deg)
    dlat = dist_nm * math.cos(b) / 60.0
    dlon = dist_nm * math.sin(b) / (60.0 * max(0.2, math.cos(math.radians(lat))))
    return lat + dlat, lon + dlon


def _nearest_airport(
    airports: list[dict], lat: float, lon: float, exclude: str | None = None
) -> dict | None:
    best, best_d = None, float("inf")
    for ap in airports:
        if exclude and ap["id"] == exclude:
            continue
        d = _haversine_nm(lat, lon, ap["lat"], ap["lon"])
        if d < best_d:
            best, best_d = ap, d
    return best


@router.post("/simulator/reseed-live")
async def reseed_from_live(payload: ReseedRequest, request: Request):
    """Rebuild the working schedule from a live ADS-B snapshot (or restore
    the static YAML network when the flight list is empty)."""
    engine = request.app.state.engine
    if not engine:
        raise HTTPException(status_code=503, detail="Simulation engine not initialized")

    # Empty list → restore the canonical YAML network.
    if not payload.flights:
        engine.reseed(cache.get_flights(), cache.get_aircraft())
        return {
            "status": "restored",
            "source": "network-yaml",
            "flights": len(engine.schedule),
            "schedule": engine.get_schedule_snapshot(),
        }

    airports = list(cache.get_airports())
    if not airports:
        raise HTTPException(status_code=503, detail="Airport network not loaded")

    now = datetime.now(timezone.utc)
    schedule: list[dict] = []
    fleet: list[dict] = []
    seen: set[str] = set()

    for lf in payload.flights[:150]:
        cs = lf.callsign.strip()
        if not cs or cs in seen:
            continue
        seen.add(cs)

        hdg = lf.heading if lf.heading is not None else 90.0
        # Track-projected endpoints: where it plausibly came from / is going.
        o_lat, o_lon = _project_nm(lf.lat, lf.lon, (hdg + 180.0) % 360.0, 300.0)
        d_lat, d_lon = _project_nm(lf.lat, lf.lon, hdg, 300.0)
        origin = _nearest_airport(airports, o_lat, o_lon)
        if origin is None:
            continue
        dest = _nearest_airport(airports, d_lat, d_lon, exclude=origin["id"])
        if dest is None:
            continue

        dist_to_dest = _haversine_nm(lf.lat, lf.lon, dest["lat"], dest["lon"])
        speed = lf.velocity_kt or 440.0
        eta_h = max(0.4, dist_to_dest / max(120.0, speed))
        dep = now - timedelta(minutes=45)
        arr = now + timedelta(hours=eta_h)

        tail = f"LV-{cs}"
        schedule.append(
            {
                "id": cs,
                "aircraft_id": tail,
                "origin": origin["id"],
                "destination": dest["id"],
                "scheduled_departure": dep.isoformat().replace("+00:00", "Z"),
                "scheduled_arrival": arr.isoformat().replace("+00:00", "Z"),
                "passengers": 160,
                "status": "scheduled",
                "delay_minutes": 0,
                # provenance — the UI labels live-derived rows honestly
                "source": "live-adsb",
                "airline_iata": lf.airline_iata,
                "live_position": {"lat": lf.lat, "lon": lf.lon, "heading": lf.heading},
            }
        )
        fleet.append(
            {
                "id": tail,
                "type": "B737-800",
                "seats": 162,
                "range_nm": 3000,
                "base_airport_id": origin["id"],
                "min_turn_minutes": 45,
            }
        )

    if not schedule:
        raise HTTPException(
            status_code=422, detail="No usable flights in snapshot (need callsign + position)"
        )

    engine.reseed(schedule, fleet)
    return {
        "status": "reseeded",
        "source": "live-adsb",
        "flights": len(schedule),
        "note": "Origins/destinations are track-projected estimates onto the network's airports; each aircraft is a single-leg rotation (no live rotation data), so cascade depth is shallower than the YAML network.",
        "schedule": engine.get_schedule_snapshot(),
    }


@router.get("/simulator/state")
async def get_simulator_state(request: Request):
    """Return current simulation state."""
    engine = request.app.state.engine
    if not engine:
        return {"status": "not_initialized"}
    return {
        "sim_time": engine.state.sim_time.isoformat()
        if hasattr(engine.state, "sim_time")
        else None,
        "active_events": engine.state.active_events,
        "flight_states": engine.state.flight_states,
        "recovery_plans": engine.state.recovery_plans,
        "cascade_summary": engine.state.cascade_summary,
        "applied_plan_id": engine.state.applied_plan_id,
        "schedule": engine.get_schedule_snapshot(),
    }


@router.get("/simulator/schedule")
async def get_simulator_schedule(request: Request):
    """Return the current flight schedule with per-flight states."""
    engine = request.app.state.engine
    if not engine:
        return {"flights": []}
    return {"flights": engine.get_schedule_snapshot()}


@router.get("/simulator/scenarios")
async def list_scenarios():
    """Return available canned scenarios."""
    scenarios = []
    try:
        for f in SCENARIOS_DIR.glob("*.yaml"):
            with open(f) as fh:
                s = yaml.safe_load(fh)
                if s:
                    scenarios.append(s)
    except Exception:
        pass
    return {"scenarios": scenarios}


@router.post("/simulator/scenarios/{scenario_name}/load")
async def load_scenario(scenario_name: str, request: Request):
    """Load and trigger a canned scenario."""
    engine = request.app.state.engine
    predictor = request.app.state.predictor
    optimizer = request.app.state.optimizer
    weather = request.app.state.weather

    scenario_file = SCENARIOS_DIR / f"{scenario_name}.yaml"
    if not scenario_file.exists():
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_name}' not found")

    with open(scenario_file) as f:
        scenario = yaml.safe_load(f)

    # Reset first
    if engine:
        engine.reset()

    results = []
    for ev_def in scenario.get("events", []):
        try:
            params = normalize_event_params(ev_def["kind"], ev_def.get("params", {}))
        except (KeyError, TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Scenario ''{scenario_name}'' contains an invalid event: {exc}",
            ) from exc
        event = {
            "id": str(uuid.uuid4()),
            "kind": ev_def["kind"],
            "triggered_at": datetime.now(timezone.utc).isoformat(),
            "params": params,
            "scenario": scenario_name,
        }
        if engine:
            result = await engine.trigger_event(event, predictor, optimizer, weather)
            results.append(result)

    return {
        "scenario": scenario_name,
        "display_name": scenario.get("display_name", scenario_name),
        "events_triggered": len(results),
        "result": results[-1] if results else {},
    }
