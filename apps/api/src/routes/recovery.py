"""Recovery optimizer endpoints."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.costs.calculator import economic_event_kind
from src.events.catalog import constraint_kind_for
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
            list(engine.crews.values()),
            engine.crew_members or [],
        )
    return (
        cache.get_flights(),
        cache.get_aircraft(),
        cache.get_crew_pairings(),
        cache.get_crew_members(),
    )


@router.post("/recovery/solve")
async def solve_recovery(payload: SolveRequest, request: Request):
    """Re-solve all active constraints; selecting a subset must never drop a safety constraint."""
    optimizer = request.app.state.optimizer
    predictor = request.app.state.predictor
    weather = request.app.state.weather
    engine = request.app.state.engine

    if not all((optimizer, predictor, weather, engine)):
        raise HTTPException(status_code=503, detail="Optimizer not initialized")
    active_ids = {event["id"] for event in engine.state.active_events}
    if payload.event_ids and set(payload.event_ids) != active_ids:
        raise HTTPException(
            422, "Solve includes all active events; cancel an event before excluding it"
        )
    if set(payload.disrupted_flight_ids) - set(engine.schedule):
        raise HTTPException(422, "Unknown disrupted flight")
    try:
        update = await engine.solve_current(
            predictor, optimizer, weather, payload.disrupted_flight_ids
        )
    except ValueError as error:
        raise HTTPException(422, str(error))
    except RuntimeError as error:
        raise HTTPException(409, str(error))
    return {"plans": update["recovery_plans"], "cascade_summary": update["cascade_summary"]}


@router.get("/recovery/plans")
async def get_current_plans(request: Request):
    """Return most recent recovery plans from the simulation engine."""
    engine = request.app.state.engine
    if engine:
        return {"plans": engine.state.recovery_plans}
    return {"plans": []}


@router.post("/recovery/explain")
async def explain_recovery_plan(payload: ExplainRequest, request: Request):
    """
    Counterfactual explainer — Slice 5.

    Given a plan_id from the most recent solve, re-evaluate each high-impact
    decision with a single flip ("what if we had kept NB123 alive?") and
    return per-flight deltas in cost, pax-minutes, and CO₂. Powers the
    "Why this plan?" panel on the plan-detail page.
    """
    engine = request.app.state.engine

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
    event_kind = economic_event_kind(active_events)

    predictions = engine.state.predictions if engine else {}

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
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/recovery/crew-overbooking")
async def solve_crew_overbooking(request: Request):
    """
    Run the crew overbooking MILP.

    Detects which flights lack legal crew due to the active disruption,
    finds the maximum-coverage reassignment of available crew, and returns
    compensation obligations per uncovered flight.
    """
    engine = getattr(request.app.state, "engine", None)

    flights, aircraft, crews, members = _load_network(engine)
    flights_by_id = {f["id"]: f for f in flights}

    active_events: list[dict] = engine.state.active_events if engine else []
    flight_states: dict = engine.state.flight_states if engine else {}
    event_kind = economic_event_kind(active_events)

    # Cascade predictions
    predictions = engine.state.predictions if engine else {}

    # Determine which crew are affected
    affected_pct = 0.0
    for ev in active_events:
        if constraint_kind_for(ev.get("kind", "")) == "crew_sickout":
            params = ev.get("params", {})
            affected_pct = max(
                affected_pct,
                float(params.get("callout_pct", params.get("percent_affected", 30))) / 100.0,
            )

    all_captain_ids = {m["id"] for m in members if m.get("role") == "captain"}
    affected_count = max(1, int(len(all_captain_ids) * affected_pct)) if affected_pct else 0

    # Naive: mark the first N captains as unavailable (in a real system, engine tracks this)
    sorted_caps = sorted(all_captain_ids)
    unavailable_caps = set(sorted_caps[:affected_count])
    available_crew = {member["id"] for member in members} - unavailable_caps

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
        elif not pairing and affected_pct > 0:
            open_flights.append({**flight, "aircraft_type": ""})

    result = _crew_ob_optimizer.solve(
        open_flights=open_flights,
        crew_members=members,
        existing_pairings=crews,
        available_crew_ids=available_crew,
        event_kind=event_kind,
        disrupted_flight_ids=disrupted_ids,
        predictions=predictions,
    )

    return result.to_dict()
