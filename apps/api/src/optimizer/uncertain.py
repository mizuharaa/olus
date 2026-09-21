"""
Recovery under an UNKNOWN disruption horizon (drone incursion, Slice 6).

The CP-SAT model in `milp.py` assumes the closure length is known: delay
minutes arrive from the cascade predictor as a parameter, and each plan is
optimal for exactly that forecast. A drone incursion has no published end
time — it is a distribution — so a plan that is optimal for a 45-minute
closure can be badly wrong for the 3-hour tail.

This module **extends** that solver rather than replacing it:

  1. Quantile-sample the log-normal closure length into N equal-weight
     scenarios (N=5). Delay minutes scale with closure length, so scenario *s*
     is the same cascade forecast times `s.scale`.
  2. Run the existing `RecoveryOptimizer.solve()` once per scenario. That gives,
     for each of the four objectives, a *perfect-foresight* decision set — what
     you'd have done had you known the duration. Shared aircraft and supported
     crew checks reject known failures; missing crew inputs remain unknown.
  3. Commit, per objective, the candidate solved for the closure length closest
     to the distribution's **mean** — the mean-value problem. Cancellations and
     swaps are here-and-now decisions; delays are whatever the realized closure
     makes them.
  4. Price every committed set under every scenario and report
     `expected_cost_usd`, the cost band, and **regret**.

Why the selection is per objective rather than "cheapest in expectation": the
four plans exist to disagree. Ranking candidates on dollars alone collapses
Minimize-Pax-Impact, Protect-Tomorrow and Green onto Minimize-Cost's answer,
because cancelling is nearly always the pricier choice — the product would ship
four identical cards. Each objective keeps its own solve; the sweep prices it.

Regret is benchmarked in dollars against the cheapest decision set observed
under that scenario (perfect hindsight), so it is non-negative and comparable
across plans: "if the closure runs 3 h, this plan costs $Y more than the best
recovery available had you known". For A that is purely the cost of guessing
the duration wrong; for B/C/D it also contains the premium their objective
deliberately pays.

ponytail: the textbook answer is a two-stage stochastic program — one CP-SAT
model with expectation-weighted cost coefficients over the scenarios. That
needs the objective built inside `_solve_plan` to change for all four plans;
do it if measured regret turns out to be large enough to be worth the rewrite.
"""

from __future__ import annotations

import logging
import math
from dataclasses import replace
from datetime import datetime, timedelta
from statistics import NormalDist

from src.optimizer.feasibility import validate_decision_locks
from src.optimizer.milp import (
    AIRCRAFT_REPOSITION_COST,
    PLAN_WEIGHTS,
    RecoveryOptimizer,
    RecoveryPlan,
)

logger = logging.getLogger(__name__)

SCENARIO_COUNT = 5
_Z95 = NormalDist().inv_cdf(0.95)


# ── The distribution ─────────────────────────────────────────────────────────


def duration_scenarios(
    median_minutes: float,
    p95_minutes: float,
    count: int = SCENARIO_COUNT,
) -> list[dict]:
    """Equal-weight quantile scenarios of a log-normal closure length.

    Quantiles are taken at the midpoint of each 1/N band, so every scenario
    carries weight 1/N and the median scenario (odd N) is exactly the median.
    """
    median = max(1.0, float(median_minutes))
    p95 = max(median * 1.01, float(p95_minutes))
    mu = math.log(median)
    sigma = max(1e-6, (math.log(p95) - mu) / _Z95)
    nd = NormalDist()

    scenarios = []
    for i in range(count):
        q = (i + 0.5) / count
        minutes = math.exp(mu + sigma * nd.inv_cdf(q))
        scenarios.append(
            {
                "minutes": round(minutes, 1),
                "weight": 1.0 / count,
                "scale": minutes / median,
            }
        )
    return scenarios


def horizon_from_constraints(constraints: list[dict]) -> dict | None:
    """Return the duration distribution an event's constraints declare, if any.

    Events with a known end time carry none, and the caller keeps using the
    ordinary solver.
    """
    for constraint in constraints:
        dist = constraint.get("duration_dist")
        if dist and dist.get("median_minutes"):
            return dist
    return None


# ── Solving ──────────────────────────────────────────────────────────────────


def solve_with_uncertain_horizon(
    optimizer: RecoveryOptimizer,
    *,
    schedule: list[dict],
    aircraft: list[dict],
    crews: list[dict],
    events: list[dict],
    disrupted_flights: list[str],
    cascade_predictions: dict[str, dict],
    horizon: dict,
    decision_locks: list[dict] | None = None,
    crew_members: list[dict] | None = None,
) -> list[RecoveryPlan]:
    """Solve the four objectives across sampled closure durations."""
    locks = validate_decision_locks(decision_locks, schedule, aircraft)
    disrupted_flights = list(dict.fromkeys([*disrupted_flights, *(r["flight_id"] for r in locks)]))
    median_predictions = {fid: dict(row) for fid, row in cascade_predictions.items()}
    for lock in locks:
        locked_prediction = median_predictions.setdefault(lock["flight_id"], {})
        locked_prediction["cascade_order"] = max(0, locked_prediction.get("cascade_order", -1))
        locked_prediction["expected_delay_min"] = max(
            locked_prediction.get("expected_delay_min", 0), lock.get("delay_minutes", 0)
        )
    scenarios = duration_scenarios(
        horizon.get("median_minutes", 45.0), horizon.get("p95_minutes", 180.0)
    )

    flights_map = {f["id"]: f for f in schedule}
    aircraft_map = {a["id"]: a for a in aircraft}
    ac_type_map = {
        fid: aircraft_map.get(f.get("aircraft_id", ""), {}).get("type", "")
        for fid, f in flights_map.items()
    }
    event_kind = optimizer._extract_event_kind(events)

    # ── 1. Perfect-foresight solve per scenario ──────────────────────────────
    # The solver's timeout is a whole-request budget, so split it across the
    # scenario solves instead of multiplying the worst case by N.
    base_timeout = optimizer.timeout_secs
    candidates: dict[str, list[RecoveryPlan]] = {pid: [] for pid in PLAN_WEIGHTS}
    try:
        optimizer.timeout_secs = max(1, base_timeout // len(scenarios))
        for scenario in scenarios:
            plans = optimizer.solve(
                schedule=schedule,
                aircraft=aircraft,
                crews=crews,
                events=events,
                disrupted_flights=disrupted_flights,
                cascade_predictions=_scaled(cascade_predictions, scenario["scale"]),
                decision_locks=locks,
                crew_members=crew_members,
            )
            for plan in plans:
                candidates[plan.plan_id].append(plan)
    finally:
        optimizer.timeout_secs = base_timeout

    # ── 2. Price every candidate under every scenario ────────────────────────
    costs: dict[str, list[list[float]]] = {
        plan_id: [
            [
                _cost_under(
                    optimizer,
                    option,
                    s["scale"],
                    flights_map,
                    event_kind,
                    ac_type_map,
                    cascade_predictions,
                    locks,
                    crews,
                    crew_members,
                    aircraft,
                    events,
                    disrupted_flights,
                )
                for s in scenarios
            ]
            for option in options
        ]
        for plan_id, options in candidates.items()
    }
    # Perfect hindsight for scenario i: the cheapest decision set anything
    # produced for that closure length. Regret is measured against this.
    best_per_scenario = [
        min(row[i] for rows in costs.values() for row in rows) for i in range(len(scenarios))
    ]

    # The mean-value problem: commit the solve for the closure length closest to
    # the distribution's mean (a log-normal's mean sits above its median).
    mean_scale = sum(s["weight"] * s["scale"] for s in scenarios)
    commit_index = min(range(len(scenarios)), key=lambda i: abs(scenarios[i]["scale"] - mean_scale))

    # ── 3. Commit one decision set per objective ─────────────────────────────
    committed: list[RecoveryPlan] = []
    for plan_id, weights in PLAN_WEIGHTS.items():
        options = candidates.get(plan_id) or []
        if not options:
            continue

        winner = min(commit_index, len(options) - 1)
        chosen = options[winner]
        row = costs[plan_id][winner]
        if not all(math.isfinite(cost) for cost in row):
            rejected = optimizer._infeasible_plan(plan_id, weights)
            rejected.validation = {
                "status": "fail",
                "issues": ["Committed decisions are infeasible in at least one sampled duration"],
                "scope": "Sampled scenarios only; not full stochastic optimization",
            }
            committed.append(rejected)
            continue
        expected_cost = sum(s["weight"] * c for s, c in zip(scenarios, row))
        regrets = [row[i] - best_per_scenario[i] for i in range(len(scenarios))]

        plan = _rebuild_at_median(
            optimizer,
            chosen,
            weights,
            flights_map,
            aircraft_map,
            crews,
            event_kind,
            ac_type_map,
            disrupted_flights,
            median_predictions,
        )
        plan = optimizer.validate_plan(
            plan,
            schedule,
            aircraft,
            crews,
            events,
            median_predictions,
            {r["flight_id"]: r for r in locks},
            crew_members,
        )
        if plan.status == "infeasible":
            committed.append(plan)
            continue
        plan.solve_time_ms = sum(o.solve_time_ms for o in options)
        plan.uncertainty = {
            "distribution": horizon.get("kind", "lognormal"),
            "median_minutes": round(float(horizon.get("median_minutes", 45.0)), 1),
            "p95_minutes": round(float(horizon.get("p95_minutes", 180.0)), 1),
            "expected_cost_usd": round(expected_cost, 2),
            "cost_low_usd": round(min(row), 2),
            "cost_high_usd": round(max(row), 2),
            "expected_regret_usd": round(
                sum(s["weight"] * r for s, r in zip(scenarios, regrets)), 2
            ),
            "max_regret_usd": round(max(regrets), 2),
            "scenarios": [
                {
                    "minutes": s["minutes"],
                    "weight": round(s["weight"], 4),
                    "cost_usd": round(row[i], 2),
                    "regret_usd": round(regrets[i], 2),
                }
                for i, s in enumerate(scenarios)
            ],
        }
        committed.append(plan)
        logger.info(
            "Plan %s (%s) uncertain horizon: E[cost] $%.0f, E[regret] $%.0f, max regret $%.0f",
            plan_id,
            weights["label"],
            plan.uncertainty["expected_cost_usd"],
            plan.uncertainty["expected_regret_usd"],
            plan.uncertainty["max_regret_usd"],
        )

    return committed


# ── Helpers ──────────────────────────────────────────────────────────────────


def _scaled(predictions: dict[str, dict], scale: float) -> dict[str, dict]:
    """The same cascade forecast at a longer/shorter closure."""
    return {
        fid: {**pred, "expected_delay_min": int(round(pred.get("expected_delay_min", 0) * scale))}
        for fid, pred in predictions.items()
    }


def _cost_under(
    optimizer: RecoveryOptimizer,
    plan: RecoveryPlan,
    scale: float,
    flights_map: dict[str, dict],
    event_kind: str,
    ac_type_map: dict[str, str],
    predictions: dict[str, dict],
    locks: list[dict],
    crews: list[dict],
    crew_members: list[dict] | None,
    aircraft: list[dict],
    events: list[dict],
    active_flights: list[str],
) -> float:
    """Price this plan's decision set as if the closure ran `scale` × median.

    Cancellations and swaps are committed up front and do not change; the
    delays they leave behind stretch with the closure.
    """
    if plan.status == "infeasible":
        return float("inf")
    floors = {r["flight_id"]: r.get("delay_minutes", 0) for r in locks}
    delayed = []
    for fid in active_flights:
        if fid not in flights_map or fid in plan.cancelled_flights:
            continue
        minutes = max(
            floors.get(fid, 0),
            int(round(predictions.get(fid, {}).get("expected_delay_min", 0) * scale)),
        )
        if minutes > 0:
            delayed.append(_delay_row(flights_map[fid], fid, minutes))
    checked = optimizer.validate_plan(
        replace(plan, delayed_flights=delayed),
        list(flights_map.values()),
        aircraft,
        crews,
        events,
        predictions,
        {r["flight_id"]: r for r in locks},
        crew_members,
    )
    if checked.status == "infeasible":
        return float("inf")
    cost = optimizer.calc.portfolio_cost(
        flights=flights_map,
        cancelled=plan.cancelled_flights,
        delayed=delayed,
        event_kind=event_kind,
        aircraft_type_map=ac_type_map,
    )
    return cost["grand_total_usd"] + len(plan.aircraft_swaps) * AIRCRAFT_REPOSITION_COST


def _rebuild_at_median(
    optimizer: RecoveryOptimizer,
    chosen: RecoveryPlan,
    weights: dict,
    flights_map: dict[str, dict],
    aircraft_map: dict[str, dict],
    crews: list[dict],
    event_kind: str,
    ac_type_map: dict[str, str],
    disrupted_flights: list[str],
    predictions: dict[str, dict],
) -> RecoveryPlan:
    """Re-express the committed decision set at the median closure length.

    The candidate was solved under one scenario, so its delay minutes belong to
    that scenario. The plan an operator reads should show the median case, with
    the uncertainty stated separately.
    """
    cancelled = list(chosen.cancelled_flights)
    active = [
        fid
        for fid in disrupted_flights
        if fid in flights_map and predictions.get(fid, {}).get("cascade_order", -1) >= 0
    ]
    delayed = []
    for fid in active:
        if fid in cancelled:
            continue
        minutes = max(0, int(predictions.get(fid, {}).get("expected_delay_min", 0)))
        if minutes > 0:
            delayed.append(_delay_row(flights_map[fid], fid, minutes))

    return optimizer._build_plan(
        chosen.plan_id,
        weights,
        chosen.status,
        cancelled,
        delayed,
        list(chosen.aircraft_swaps),
        flights_map,
        aircraft_map,
        crews,
        event_kind,
        ac_type_map,
    )


def _delay_row(flight: dict, fid: str, minutes: int) -> dict:
    dep_str = flight.get("scheduled_departure", "")
    try:
        new_dep = datetime.fromisoformat(dep_str.replace("Z", "+00:00")) + timedelta(
            minutes=minutes
        )
        new_dep_str = new_dep.isoformat()
    except (ValueError, AttributeError):
        new_dep_str = dep_str
    return {
        "flight_id": fid,
        "delay_minutes": minutes,
        "new_departure": new_dep_str,
        "original_departure": dep_str,
    }
