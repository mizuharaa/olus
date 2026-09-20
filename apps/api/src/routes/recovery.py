"""Recovery optimizer endpoints."""

import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.network import cache
from src.optimizer.crew_overbooking import CrewOverbookingOptimizer
from src.optimizer.explain import explain_plan

router = APIRouter()

_crew_ob_optimizer = CrewOverbookingOptimizer()


class SolveRequest(BaseModel):
    event_ids: list[str] = []
    disrupted_flight_ids: list[str] = []


class ExplainRequest(BaseModel):
    plan_id: str
    top_n: int = 6


class ApplyRequest(BaseModel):
    """Commit a plan onto the simulation state. Empty plan_id (or `null`) is
    treated as an unapply / revert."""

    plan_id: str | None = None


def _load_network(engine=None):
    """Network tuple (read-only; the optimizer does not mutate the schedule).

    Prefers the ENGINE's working schedule/aircraft when available — the
    engine may have been reseeded from live ADS-B traffic, and solving
    against the static YAML cache would silently ignore that. Crew data
    always comes from the cache (live traffic carries no pairings; the
    optimizer tolerates flights without pairings)."""
    if engine is not None:
        return (
            list(engine.schedule.values()),
            list(engine.aircraft.values()),
            cache.get_crew_pairings(),
            cache.get_crew_members(),
        )
    return (
        cache.get_flights(),
        cache.get_aircraft(),
        cache.get_crew_pairings(),
        cache.get_crew_members(),
    )


@router.post("/recovery/solve")
def solve_recovery(payload: SolveRequest, request: Request):
    """Run the recovery optimizer and return 3 plans."""
    optimizer = request.app.state.optimizer
    predictor = request.app.state.predictor
    weather = request.app.state.weather
    engine = request.app.state.engine

    if not optimizer:
        raise HTTPException(status_code=503, detail="Optimizer not initialized")

    # Get schedule + active constraints
    flights, aircraft, crews, _ = _load_network(engine)
    active_events = engine.state.active_events if engine else []
    constraints = []
    for ev in active_events:
        kind = ev.get("kind", "")
        params = ev.get("params", {})
        if kind in ("weather_closure", "ground_stop", "security_event"):
            constraints.append(
                {
                    "type": "airport_unavailable",
                    "airport": params.get("airport", ""),
                    "start": "",
                    "end": "",
                }
            )
        elif kind == "mechanical_aog":
            constraints.append(
                {"type": "aircraft_grounded", "aircraft_tail": params.get("aircraft_tail", "")}
            )

    # Get cascade predictions
    disrupted = payload.disrupted_flight_ids or (
        list(engine.state.flight_states.keys()) if engine else []
    )
    metar_data = weather.get_all_cached() if weather else {}
    event = active_events[0] if active_events else {}
    predictions = (
        predictor.predict(flights, event, metar_data, datetime.datetime.now(datetime.timezone.utc))
        if predictor
        else {}
    )

    plans = optimizer.solve(
        schedule=flights,
        aircraft=aircraft,
        crews=crews,
        events=constraints,
        disrupted_flights=disrupted,
        cascade_predictions=predictions,
    )

    return {
        "plans": [
            {
                "plan_id": p.plan_id,
                "objective_label": p.objective_label,
                "status": p.status,
                "solve_time_ms": p.solve_time_ms,
                "cancelled_flights": p.cancelled_flights,
                "delayed_flights": p.delayed_flights,
                "aircraft_swaps": p.aircraft_swaps,
                "crew_reassignments": p.crew_reassignments,
                "total_cost_usd": p.total_cost_usd,
                "total_passenger_delay_minutes": p.total_passenger_delay_minutes,
                "crew_violations": p.crew_violations,
                "aircraft_out_of_position": p.aircraft_out_of_position,
                "cost_breakdown": p.cost_breakdown,
                "total_co2_kg": p.total_co2_kg,
                "eu_ets_cost_usd": p.eu_ets_cost_usd,
                "carbon_breakdown": p.carbon_breakdown,
                "summary": p.summary,
            }
            for p in plans
        ]
    }


@router.get("/recovery/plans")
async def get_current_plans(request: Request):
    """Return most recent recovery plans from the simulation engine."""
    engine = request.app.state.engine
    if engine:
        return {"plans": engine.state.recovery_plans}
    return {"plans": []}


@router.post("/recovery/explain")
def explain_recovery_plan(payload: ExplainRequest, request: Request):
    """
    Counterfactual explainer — Slice 5.

    Given a plan_id from the most recent solve, re-evaluate each high-impact
    decision with a single flip ("what if we had kept NB123 alive?") and
    return per-flight deltas in cost, pax-minutes, and CO₂. Powers the
    "Why this plan?" panel on the plan-detail page.
    """
    engine = request.app.state.engine
    predictor = request.app.state.predictor
    weather = request.app.state.weather

    plans: list[dict] = []
    if engine:
        plans = engine.state.recovery_plans or []
    plan = next((p for p in plans if p.get("plan_id") == payload.plan_id), None)
    if not plan:
        raise HTTPException(
            status_code=404, detail=f"Plan {payload.plan_id} not found — solve first."
        )

    flights, aircraft, _, _ = _load_network(engine)
    active_events = engine.state.active_events if engine else []
    event_kind = active_events[0].get("kind", "") if active_events else ""

    metar_data = weather.get_all_cached() if weather else {}
    active_ev = active_events[0] if active_events else {}
    predictions = (
        predictor.predict(
            flights, active_ev, metar_data, datetime.datetime.now(datetime.timezone.utc)
        )
        if predictor
        else {}
    )

    return explain_plan(
        plan=plan,
        flights=flights,
        aircraft=aircraft,
        predictions=predictions,
        event_kind=event_kind,
        top_n=payload.top_n,
    )


@router.post("/recovery/apply")
async def apply_recovery_plan(payload: ApplyRequest, request: Request):
    """
    Commit a recovery plan onto the live simulation state.

    Mutates `engine.state.flight_states` to materialise the plan's
    cancellations / delays / swaps, recomputes the cascade summary, and
    broadcasts a `plan_applied` update so every connected client (cascade,
    carbon, crew, passengers, plans) reflects the committed action set.

    Pass `plan_id=null` (or omit it) to revert to the pre-apply snapshot.
    """
    engine = getattr(request.app.state, "engine", None)
    if engine is None:
        raise HTTPException(status_code=503, detail="Simulation engine not running.")
    if not payload.plan_id:
        return await engine.unapply_plan()
    try:
        return await engine.apply_plan(payload.plan_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/recovery/crew-overbooking")
def solve_crew_overbooking(request: Request):
    """
    Run the crew overbooking MILP.

    Detects which flights lack legal crew due to the active disruption,
    finds the maximum-coverage reassignment of available crew, and returns
    compensation obligations per uncovered flight.
    """
    engine = getattr(request.app.state, "engine", None)
    predictor = getattr(request.app.state, "predictor", None)
    weather = getattr(request.app.state, "weather", None)

    flights, aircraft, crews, members = _load_network(engine)
    flights_by_id = {f["id"]: f for f in flights}

    active_events: list[dict] = engine.state.active_events if engine else []
    flight_states: dict = engine.state.flight_states if engine else {}
    event_kind = active_events[0].get("kind", "") if active_events else ""

    # Cascade predictions
    metar_data = weather.get_all_cached() if weather else {}
    active_ev = active_events[0] if active_events else {}
    predictions = (
        predictor.predict(
            flights, active_ev, metar_data, datetime.datetime.now(datetime.timezone.utc)
        )
        if predictor
        else {}
    )

    # Determine which crew are affected
    affected_pct = 0.0
    for ev in active_events:
        if ev.get("kind") == "crew_sickout":
            affected_pct = float(ev.get("params", {}).get("percentage", 30)) / 100.0

    all_captain_ids = {m["id"] for m in members if m.get("role") == "captain"}
    affected_count = max(1, int(len(all_captain_ids) * affected_pct)) if affected_pct else 0

    # Naive: mark the first N captains as unavailable (in a real system, engine tracks this)
    sorted_caps = sorted(all_captain_ids)
    unavailable_caps = set(sorted_caps[:affected_count])
    available_caps = all_captain_ids - unavailable_caps

    # Identify open flights (disrupted + status not cancelled by engine already)
    open_flights: list[dict] = []
    disrupted_ids: list[str] = []
    for fid, fstate in flight_states.items():
        if fstate.get("cascade_order", -1) < 0:
            continue
        disrupted_ids.append(fid)
        flight = flights_by_id.get(fid)
        if not flight:
            continue
        # Check if original pairing uses an unavailable captain
        pairing = next((p for p in crews if p.get("flight_id") == fid), None)
        if pairing and pairing.get("captain_id") in unavailable_caps:
            open_flights.append({**flight, "aircraft_type": ""})
        elif not pairing and event_kind in {"crew_sickout"}:
            open_flights.append({**flight, "aircraft_type": ""})

    result = _crew_ob_optimizer.solve(
        open_flights=open_flights,
        crew_members=members,
        existing_pairings=crews,
        available_crew_ids=available_caps,
        event_kind=event_kind,
        disrupted_flight_ids=disrupted_ids,
        predictions=predictions,
    )

    return result.to_dict()
