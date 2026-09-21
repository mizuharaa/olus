"""
Recovery optimizer — OR-Tools CP-SAT MILP.

Produces 4 recovery plans with distinct strategic objectives:
  Plan A — Minimize Cost        (jointly optimal cancel + swap decisions)
  Plan B — Minimize Pax Impact  (maximize service continuity)
  Plan C — Protect Tomorrow     (free aircraft rotations via early cancellations)
  Plan D — Green Recovery       (minimise EU-ETS-priced net CO₂ — Slice 4)

Each plan runs the CP-SAT solver with a per-plan timeout. Falls back to the
deterministic heuristic if the solver cannot find a feasible solution in time.
Every plan, regardless of objective, is scored against the carbon ledger so
the UI can surface CO₂ alongside dollars on every card.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ortools.sat.python import cp_model

from src.costs.calculator import AIRCRAFT_REPOSITION_COST_USD as AIRCRAFT_REPOSITION_COST
from src.costs.calculator import AirlineDelayCalculator, economic_event_kind
from src.costs.carbon import (
    EU_ETS_USD_PER_TONNE,
    carbon_for_delay,
    carbon_for_ferry,
    portfolio_carbon,
)
from src.optimizer.feasibility import aircraft_available, validate_decision_locks

logger = logging.getLogger(__name__)

MAX_DELAY_MINUTES = 480  # solver upper bound for delay variable
SPARE_POOL_CAP = 20  # cap spare aircraft considered (solver speed)

# Plan D (Green) only. The per-seat carbon+service price of stranding the
# passengers on a cancelled leg. Cancelling defers demand rather than erasing
# it (those pax rebook and the block burn is re-incurred later), so a cancel
# earns NO block-burn credit in the objective. This configurable modeling
# penalty is not a statutory compensation amount or a measured passenger cost.
GREEN_CANCEL_USD_PER_PAX = 11

PLAN_WEIGHTS = {
    "A": {"label": "Minimize Cost", "alpha": 10.0, "beta": 1.0, "gamma": 5.0, "delta": 2.0},
    "B": {
        "label": "Minimize Passenger Impact",
        "alpha": 1.0,
        "beta": 10.0,
        "gamma": 2.0,
        "delta": 1.0,
    },
    "C": {
        "label": "Protect Tomorrow's Schedule",
        "alpha": 2.0,
        "beta": 3.0,
        "gamma": 2.0,
        "delta": 10.0,
    },
    # Plan D trades modeled delay/ferry CO2 against service disruption. Its
    # objective differs from the reported net-emissions accounting ledger.
    "D": {"label": "Green Recovery", "alpha": 1.0, "beta": 2.0, "gamma": 4.0, "delta": 1.0},
}


@dataclass
class RecoveryPlan:
    plan_id: str
    objective_label: str
    status: str  # "optimal" | "feasible" | "heuristic" | "infeasible"
    solve_time_ms: int

    cancelled_flights: list[str] = field(default_factory=list)
    delayed_flights: list[dict] = field(default_factory=list)
    aircraft_swaps: list[dict] = field(default_factory=list)
    crew_reassignments: list[dict] = field(default_factory=list)

    total_cost_usd: float = 0.0
    total_passenger_delay_minutes: int = 0
    crew_violations: int = 0
    aircraft_out_of_position: int = 0
    cost_breakdown: dict = field(default_factory=dict)
    # Carbon ledger (Slice 4 — Plan D). Populated for every plan so the
    # frontend can show CO₂ alongside dollars on every card, regardless of
    # which objective the plan was optimised against.
    total_co2_kg: float = 0.0
    eu_ets_cost_usd: float = 0.0
    carbon_breakdown: dict = field(default_factory=dict)
    # Uncertain-horizon ledger (Slice 6 — drone incursion). Only populated when
    # the disruption's duration is a distribution rather than a fixed value;
    # see src/optimizer/uncertain.py for the shape.
    uncertainty: dict | None = None
    summary: str = ""
    validation: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        from dataclasses import asdict

        return asdict(self)


class RecoveryOptimizer:
    """
    Airline disruption recovery — OR-Tools CP-SAT MILP.

    Decision variables per plan:
      cancel[f]  ∈ {0,1}           — cancel flight f
      swap[f][a] ∈ {0,1}           — assign spare aircraft a to AOG flight f

    Delay minutes are a *parameter* sourced from the cascade predictor,
    not a free variable. The solver optimally chooses cancel/swap assignments
    given those delay forecasts.
    """

    PLAN_WEIGHTS = PLAN_WEIGHTS

    def __init__(
        self,
        timeout_secs: int = 30,
        use_fallback: bool = True,
        deterministic: bool = False,
        progress=None,
    ):
        self.timeout_secs = timeout_secs
        self.use_fallback = use_fallback
        self.calc = AirlineDelayCalculator()
        # CP-SAT's parallel portfolio search (num_search_workers > 1) races
        # worker threads against the wall clock — under a time limit that can
        # return different (still-feasible) solutions run to run. Replay
        # needs the solve itself pinned, not just its inputs, so a
        # deterministic optimizer runs single-threaded with a fixed seed.
        # Production keeps num_search_workers=4 for solve speed; this is
        # opt-in only, so /simulator API responses are unchanged.
        self.deterministic = deterministic
        self.progress = progress
        self._solve_sequence = 0

    # ── Public API ────────────────────────────────────────────────────────────

    def solve(
        self,
        schedule: list[dict],
        aircraft: list[dict],
        crews: list[dict],
        events: list[dict],
        disrupted_flights: list[str],
        cascade_predictions: dict[str, dict],
        decision_locks: list[dict] | None = None,
        crew_members: list[dict] | None = None,
    ) -> list[RecoveryPlan]:
        flights_map = {f["id"]: f for f in schedule}
        aircraft_map = {a["id"]: a for a in aircraft}
        locks = {
            r["flight_id"]: r for r in validate_decision_locks(decision_locks, schedule, aircraft)
        }
        predictions = {fid: dict(row) for fid, row in cascade_predictions.items()}
        disrupted_flights = list(dict.fromkeys([*disrupted_flights, *locks]))
        for fid, lock in locks.items():
            row = predictions.setdefault(fid, {})
            row["cascade_order"] = max(0, row.get("cascade_order", -1))
            row["expected_delay_min"] = max(
                row.get("expected_delay_min", 0), lock.get("delay_minutes", 0)
            )

        # An earlier disrupted rotation does not make a tail unavailable all
        # day. Check its actual windows; prioritize explicit dispatcher locks.
        locked_tails = list(
            dict.fromkeys(r["aircraft_id"] for r in locks.values() if "aircraft_id" in r)
        )
        spare_pool = list(dict.fromkeys([*locked_tails, *aircraft_map]))
        crew_failures = set()
        if crew_members is not None:
            from src.services.crew_audit import assess_plan_crew

            roster_schedule = [
                {**f, "aircraft_type": aircraft_map.get(f.get("aircraft_id"), {}).get("type")}
                for f in schedule
            ]
            assessments = assess_plan_crew(
                roster_schedule,
                crews,
                crew_members,
                {fid: row.get("expected_delay_min", 0) for fid, row in predictions.items()},
                {fid for fid, lock in locks.items() if lock.get("cancel")},
            )
            crew_failures = {fid for fid, result in assessments.items() if result.status == "fail"}

        plans: list[RecoveryPlan] = []
        for plan_id, weights in PLAN_WEIGHTS.items():
            t0 = time.monotonic()
            self._solve_sequence += 1
            if self.progress:
                self.progress(
                    {
                        "type": "plan_started",
                        "plan_id": plan_id,
                        "solve_sequence": self._solve_sequence,
                    }
                )
            plan = self._solve_plan(
                plan_id=plan_id,
                weights=weights,
                flights_map=flights_map,
                aircraft_map=aircraft_map,
                spare_pool=spare_pool[: max(SPARE_POOL_CAP, len(locked_tails))],
                disrupted=disrupted_flights,
                predictions=predictions,
                crews=crews,
                events=events,
                locks=locks,
                crew_failures=crew_failures,
            )
            plan = self.validate_plan(
                plan, schedule, aircraft, crews, events, predictions, locks, crew_members
            )
            plan.solve_time_ms = max(1, int((time.monotonic() - t0) * 1000))
            plans.append(plan)
            if self.progress:
                self.progress(
                    {
                        "type": "plan_completed",
                        "plan_id": plan_id,
                        "solve_sequence": self._solve_sequence,
                        "status": plan.status,
                        "solve_time_ms": plan.solve_time_ms,
                        "cost_usd": plan.total_cost_usd,
                    }
                )
            logger.info(
                "Plan %s (%s) [%s]: %d cancelled, %d delayed, $%.0f — %dms",
                plan_id,
                weights["label"],
                plan.status,
                len(plan.cancelled_flights),
                len(plan.delayed_flights),
                plan.total_cost_usd,
                plan.solve_time_ms,
            )
        return plans

    def validate_plan(
        self, plan, schedule, aircraft, crews, events, predictions, locks=None, crew_members=None
    ):
        """Shared postcondition for CP-SAT, heuristic, and uncertainty rebuilds.

        Validation covers this bounded simulation model, not operational approval.
        Unknown roster data is preserved as unknown rather than invented as legal.
        """
        locks = locks or {}
        flights = {f["id"]: f for f in schedule}
        fleet = {a["id"]: a for a in aircraft}
        cancelled = set(plan.cancelled_flights)
        delays = {d["flight_id"]: d["delay_minutes"] for d in plan.delayed_flights}
        assignments = {s["flight_id"]: s["new_aircraft"] for s in plan.aircraft_swaps}
        effective = {fid: {"expected_delay_min": delays.get(fid, 0)} for fid in flights}
        grounded = self._extract_grounded_tails(events)
        issues = []
        if plan.status != "infeasible":
            if len(assignments) != len(plan.aircraft_swaps):
                issues.append("A flight was assigned multiple aircraft")
            if len(set(assignments.values())) != len(assignments):
                issues.append("A spare aircraft was assigned more than once")
            for fid, tail in assignments.items():
                if fid not in flights or not aircraft_available(
                    flights[fid], tail, flights, fleet, effective, grounded
                ):
                    issues.append(f"{fid}: assigned aircraft is unavailable or incompatible")
            for fid, lock in locks.items():
                if lock.get("cancel", False) != (fid in cancelled):
                    issues.append(f"{fid}: cancellation lock was not honored")
                if fid in cancelled:
                    continue
                if delays.get(fid, 0) < lock.get("delay_minutes", 0):
                    issues.append(f"{fid}: delay floor was not honored")
                if "aircraft_id" in lock:
                    tail = assignments.get(fid, flights[fid].get("aircraft_id"))
                    if tail != lock["aircraft_id"] or not aircraft_available(
                        flights[fid], tail, flights, fleet, effective, grounded
                    ):
                        issues.append(f"{fid}: aircraft lock is infeasible")
            for fid, flight in flights.items():
                if (
                    fid not in cancelled
                    and flight.get("aircraft_id") in grounded
                    and fid not in assignments
                ):
                    issues.append(f"{fid}: grounded aircraft has no replacement")
            # Validate the resulting rotations, including legs stranded by a
            # cancellation or reassignment. No implicit ferry is invented.
            changed = cancelled | set(delays) | set(assignments) | set(locks)
            affected_tails = {flights[fid].get("aircraft_id") for fid in changed if fid in flights}
            affected_tails.update(assignments.values())
            resulting = {
                fid: {**f, "aircraft_id": assignments.get(fid, f.get("aircraft_id"))}
                for fid, f in flights.items()
                if fid not in cancelled
            }
            for fid, flight in resulting.items():
                tail = flight.get("aircraft_id")
                if tail in affected_tails and not aircraft_available(
                    flight, tail, resulting, fleet, effective, grounded
                ):
                    issues.append(f"{fid}: resulting aircraft rotation is infeasible")

        crew = {
            "status": "unknown",
            "violations": 0,
            "unknown_flights": len(flights) - len(cancelled),
            "note": "Crew roster not supplied; no claim of crew legality",
        }
        if crew_members is not None:
            from src.services.crew_audit import assess_plan_crew

            roster_schedule = [
                {
                    **f,
                    "aircraft_type": fleet.get(
                        assignments.get(f["id"], f.get("aircraft_id")), {}
                    ).get("type"),
                }
                for f in schedule
            ]
            results = assess_plan_crew(roster_schedule, crews, crew_members, delays, cancelled)
            failures = [fid for fid, result in results.items() if result.status == "fail"]
            unknown = [fid for fid, result in results.items() if result.status == "unknown"]
            crew = {
                "status": "fail" if failures else "unknown" if unknown else "pass",
                "violations": sum(len(result.violations) for result in results.values()),
                "unknown_flights": len(unknown),
                "failed_flights": failures,
                "checked_flights": len(results),
            }
            issues.extend(f"{fid}: supported crew checks failed" for fid in failures)
        plan.crew_violations = crew["violations"]
        validation = {
            "status": "fail" if issues or plan.status == "infeasible" else crew["status"],
            "scope": "Conservative aircraft assignments and supported crew checks; simulation only",
            "issues": issues,
            "crew": crew,
        }
        if issues:
            rejected = self._infeasible_plan(plan.plan_id)
            rejected.crew_violations = plan.crew_violations
            plan = rejected
        plan.validation = validation
        return plan

    # ── CP-SAT model ──────────────────────────────────────────────────────────

    def _solve_plan(
        self,
        plan_id: str,
        weights: dict,
        flights_map: dict[str, dict],
        aircraft_map: dict[str, dict],
        spare_pool: list[str],
        disrupted: list[str],
        predictions: dict[str, dict],
        crews: list[dict],
        events: list[dict],
        locks: dict[str, dict] | None = None,
        crew_failures: set[str] | None = None,
    ) -> RecoveryPlan:
        locks = locks or {}
        crew_failures = crew_failures or set()
        grounded_tails = self._extract_grounded_tails(events)
        event_kind = self._extract_event_kind(events)

        # Filter to flights we can reason about
        active = [
            fid
            for fid in disrupted
            if fid in flights_map and predictions.get(fid, {}).get("cascade_order", -1) >= 0
        ]
        if not active:
            return self._empty_plan(plan_id, weights)

        # Identify flights whose original aircraft is grounded (AOG)
        aog_flights = [
            fid
            for fid in active
            if flights_map[fid].get("aircraft_id", "") in grounded_tails
            or (
                locks.get(fid, {}).get("aircraft_id")
                not in (None, flights_map[fid].get("aircraft_id"))
            )
        ]

        # Pre-compute cost coefficients (integers — CP-SAT requires integer objective)
        cancel_cost_int: dict[str, int] = {}
        delay_cost_total_int: dict[str, int] = {}
        pax: dict[str, int] = {}

        for fid in active:
            flight = flights_map[fid]
            pred = predictions.get(fid, {})
            ac_type = aircraft_map.get(flight.get("aircraft_id", ""), {}).get("type", "")
            expected_delay = max(0, int(pred.get("expected_delay_min", 60)))

            try:
                c_info = self.calc.cancellation_cost(flight, event_kind, ac_type)
                d_info = self.calc.delay_cost(flight, expected_delay, event_kind, ac_type)
                cancel_cost_int[fid] = max(1, int(c_info.total))
                delay_cost_total_int[fid] = max(0, int(d_info.total))
            except Exception:
                cancel_cost_int[fid] = 50_000
                delay_cost_total_int[fid] = max(0, expected_delay) * 100

            pax[fid] = max(1, flight.get("passengers", 150))

        # ── Build CP-SAT model ────────────────────────────────────────────────
        model = cp_model.CpModel()
        solver = cp_model.CpSolver()
        # SOLVER_TIMEOUT_SECS is a total request budget; divide it across the
        # four plans so deployment configuration actually controls solve time.
        solver.parameters.max_time_in_seconds = max(0.1, self.timeout_secs / len(PLAN_WEIGHTS))
        solver.parameters.log_search_progress = False
        if self.deterministic:
            solver.parameters.num_search_workers = 1
            solver.parameters.random_seed = 42
        else:
            solver.parameters.num_search_workers = 4

        # Decision vars
        cancel: dict[str, cp_model.IntVar] = {fid: model.new_bool_var(f"x_{fid}") for fid in active}
        for fid in crew_failures.intersection(active):
            model.add(cancel[fid] == 1)
        for fid, lock in locks.items():
            if "cancel" in lock or "aircraft_id" in lock or "delay_minutes" in lock:
                model.add(cancel[fid] == int(lock.get("cancel", False)))

        # Aircraft swap vars: only for AOG flights that have a grounded original
        swap: dict[str, dict[str, cp_model.IntVar]] = {}
        for fid in aog_flights:
            swap[fid] = {
                spare: model.new_bool_var(f"s_{fid}_{spare}")
                for spare in spare_pool
                if aircraft_available(
                    flights_map[fid], spare, flights_map, aircraft_map, predictions, grounded_tails
                )
            }
            spare_vars = list(swap[fid].values())
            if spare_vars:
                # At most one spare per flight
                model.add_at_most_one(spare_vars)
                # If not cancelled → must assign exactly one spare
                model.add(sum(spare_vars) == 1).only_enforce_if(cancel[fid].negated())
                # If cancelled → no swap needed
                model.add(sum(spare_vars) == 0).only_enforce_if(cancel[fid])
            else:
                # No spares available — must cancel
                model.add(cancel[fid] == 1)

        # Each spare used by at most one flight
        for spare in spare_pool:
            uses = [swap[fid][spare] for fid in aog_flights if spare in swap.get(fid, {})]
            if len(uses) > 1:
                model.add_at_most_one(uses)
        for fid, lock in locks.items():
            tail = lock.get("aircraft_id")
            if tail is None:
                continue
            if tail == flights_map[fid].get("aircraft_id") and tail not in grounded_tails:
                continue
            if tail not in swap.get(fid, {}):
                return self._infeasible_plan(plan_id, weights)
            model.add(swap[fid][tail] == 1)

        # ── Objective ─────────────────────────────────────────────────────────
        obj: list = []

        if plan_id == "A":
            # Minimize dollar cost: cancel_cost * x[f] + delay_cost * (1 - x[f]) + swap_cost
            for fid in active:
                # cost = cancel_cost * cancel + delay_cost * (1 - cancel)
                # = delay_cost + (cancel_cost - delay_cost) * cancel
                delta = cancel_cost_int[fid] - delay_cost_total_int[fid]
                obj.append(delta * cancel[fid])
                obj.append(delay_cost_total_int[fid])  # constant term; added for clarity
            for fid, spares in swap.items():
                for sv in spares.values():
                    obj.append(AIRCRAFT_REPOSITION_COST * sv)

        elif plan_id == "B":
            # Minimize passenger-minutes; penalize cancellations heavily
            BIG = max(pax.values()) * MAX_DELAY_MINUTES * 5
            for fid in active:
                pred = predictions.get(fid, {})
                expected_delay = max(0, int(pred.get("expected_delay_min", 60)))
                obj.append(BIG * cancel[fid])
                obj.append(pax[fid] * expected_delay * (1 - cancel[fid]))  # pax·delay if kept

        elif plan_id == "C":
            # Protect tomorrow: reward early cancellations on direct-impact flights,
            # penalize delays on cascade flights
            for fid in active:
                pred = predictions.get(fid, {})
                cascade_order = pred.get("cascade_order", -1)
                expected_delay = max(0, int(pred.get("expected_delay_min", 60)))

                if cascade_order == 0 and expected_delay >= 120:
                    # Reward cancellation → penalize NOT cancelling
                    obj.append(60_000 * cancel[fid].negated())
                else:
                    # Cascade flight: penalize delay
                    obj.append(pax[fid] * expected_delay * cancel[fid].negated())
                    obj.append(cancel_cost_int[fid] * cancel[fid])
            for fid, spares in swap.items():
                for sv in spares.values():
                    obj.append(AIRCRAFT_REPOSITION_COST * sv)

        elif plan_id == "D":
            # Plan D — Green Recovery. Minimise the *wasted* carbon of the
            # recovery (delay-hold burn + ferry overhead) while still flying
            # the passengers. A cancellation does NOT erase demand — those pax
            # rebook and the block burn is re-incurred on a later leg — so it
            # earns no carbon credit here (that was the old "cancel everything"
            # degeneracy). It only avoids the ground-hold burn, paid for with a
            # per-seat stranding penalty. Net effect: Green cancels a leg only
            # when holding it late clearly out-burns re-accommodating its pax.
            for fid in active:
                pred = predictions.get(fid, {})
                expected_delay = max(0, int(pred.get("expected_delay_min", 60)))
                ac_type = aircraft_map.get(
                    flights_map[fid].get("aircraft_id", ""),
                    {},
                ).get("type", "")
                # Hold-burn (ETS-priced dollars) of running this flight late.
                # Use the carbon module so the objective stays consistent with
                # the post-solve ledger we report on every card.
                delay_co2 = carbon_for_delay(
                    flights_map[fid],
                    expected_delay,
                    ac_type,
                ).co2_kg
                # Scale to dollars at the ETS price (CP-SAT needs int coeffs).
                delay_usd_int = int((delay_co2 / 1000.0) * EU_ETS_USD_PER_TONNE)
                # Stranding penalty: per-seat cost of cancelling this leg.
                service_penalty = pax[fid] * GREEN_CANCEL_USD_PER_PAX

                obj.append(delay_usd_int * cancel[fid].negated())  # hold-burn if flown late
                obj.append(service_penalty * cancel[fid])  # stranded pax if cancelled
            for fid, spares in swap.items():
                for sv in spares.values():
                    # Ferry burn priced at EU ETS — pure overhead carbon.
                    ferry_usd_int = int((carbon_for_ferry().co2_kg / 1000.0) * EU_ETS_USD_PER_TONNE)
                    obj.append(ferry_usd_int * sv)

        model.minimize(sum(obj))

        # ── Solve ─────────────────────────────────────────────────────────────
        callback = None
        if self.progress:
            emit, sequence = self.progress, self._solve_sequence
            constraints = len(model.proto.constraints)
            emit(
                {
                    "type": "model_ready",
                    "plan_id": plan_id,
                    "solve_sequence": sequence,
                    "constraint_count": constraints,
                }
            )

            class Progress(cp_model.CpSolverSolutionCallback):
                def __init__(self):
                    super().__init__()
                    self.count = 0

                def on_solution_callback(self):
                    self.count += 1
                    emit(
                        {
                            "type": "incumbent",
                            "plan_id": plan_id,
                            "solve_sequence": sequence,
                            "incumbent_count": self.count,
                            "objective_value": self.objective_value,
                            "best_objective_bound": self.best_objective_bound,
                            "constraints_satisfied": constraints,
                            "solver_elapsed_seconds": self.wall_time,
                        }
                    )

            callback = Progress()
        status_code = solver.solve(model, callback)
        solved = status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE)

        if not solved:
            if not self.use_fallback or status_code in (
                cp_model.INFEASIBLE,
                cp_model.MODEL_INVALID,
            ):
                return self._infeasible_plan(plan_id, weights)
            logger.warning(
                "Plan %s CP-SAT failed (%s) — using heuristic fallback",
                plan_id,
                solver.status_name(),
            )
            return self._heuristic_fallback(
                plan_id,
                weights,
                flights_map,
                aircraft_map,
                spare_pool,
                active,
                predictions,
                crews,
                events,
                grounded_tails,
                event_kind,
                locks,
                crew_failures,
            )

        cp_status = "optimal" if status_code == cp_model.OPTIMAL else "feasible"

        # ── Extract solution ───────────────────────────────────────────────────
        cancelled: list[str] = []
        delayed: list[dict] = []
        swaps: list[dict] = []

        for fid in active:
            if solver.value(cancel[fid]) == 1:
                cancelled.append(fid)
            else:
                pred = predictions.get(fid, {})
                expected_delay = max(0, int(pred.get("expected_delay_min", 0)))
                if expected_delay > 0:
                    flight = flights_map[fid]
                    dep_str = flight.get("scheduled_departure", "")
                    try:
                        orig_dep = datetime.fromisoformat(dep_str.replace("Z", "+00:00"))
                        new_dep = orig_dep + timedelta(minutes=expected_delay)
                        new_dep_str = new_dep.isoformat()
                    except (ValueError, AttributeError):
                        new_dep_str = dep_str
                    delayed.append(
                        {
                            "flight_id": fid,
                            "delay_minutes": expected_delay,
                            "new_departure": new_dep_str,
                            "original_departure": dep_str,
                        }
                    )

        for fid, spares in swap.items():
            if fid in cancelled:
                continue
            for spare, sv in spares.items():
                if solver.value(sv) == 1:
                    flight = flights_map[fid]
                    swaps.append(
                        {
                            "flight_id": fid,
                            "old_aircraft": flight.get("aircraft_id", ""),
                            "new_aircraft": spare,
                            "aircraft_type": aircraft_map.get(spare, {}).get("type", ""),
                        }
                    )

        return self._build_plan(
            plan_id,
            weights,
            cp_status,
            cancelled,
            delayed,
            swaps,
            flights_map,
            aircraft_map,
            crews,
            event_kind,
            {
                fid: aircraft_map.get(flights_map[fid].get("aircraft_id", ""), {}).get("type", "")
                for fid in flights_map
            },
        )

    # ── Heuristic fallback (deterministic, always succeeds) ───────────────────

    def _heuristic_fallback(
        self,
        plan_id: str,
        weights: dict,
        flights_map: dict,
        aircraft_map: dict,
        spare_pool: list,
        active: list,
        predictions: dict,
        crews: list,
        events: list,
        grounded_tails: set,
        event_kind: str,
        locks: dict[str, dict] | None = None,
        crew_failures: set[str] | None = None,
    ) -> RecoveryPlan:
        locks = locks or {}
        crew_failures = crew_failures or set()
        cancelled: list[str] = []
        delayed: list[dict] = []
        swaps: list[dict] = []
        spare_q = list(spare_pool)

        ac_type_map = {
            fid: aircraft_map.get(flights_map[fid].get("aircraft_id", ""), {}).get("type", "")
            for fid in flights_map
        }

        for fid in sorted(active, key=lambda fid: "aircraft_id" not in locks.get(fid, {})):
            flight = flights_map[fid]
            pred = predictions.get(fid, {})
            expected_delay = max(0, int(pred.get("expected_delay_min", 60)))
            p_delayed = pred.get("p_delayed", 0.5)
            cascade_order = pred.get("cascade_order", -1)
            ac_type = ac_type_map.get(fid, "")
            original_ac = flight.get("aircraft_id", "")

            eligible_spares = [
                spare
                for spare in spare_q
                if aircraft_available(
                    flight, spare, flights_map, aircraft_map, predictions, grounded_tails
                )
            ]
            lock = locks.get(fid, {})
            requested_tail = lock.get("aircraft_id")
            needs_swap = original_ac in grounded_tails or requested_tail not in (None, original_ac)
            if requested_tail and needs_swap:
                eligible_spares = [tail for tail in eligible_spares if tail == requested_tail]
            should_cancel = (
                fid in crew_failures
                or (original_ac in grounded_tails and not eligible_spares)
                or self._decide_cancel(
                    plan_id, flight, expected_delay, p_delayed, cascade_order, event_kind, ac_type
                )
            )
            if lock:
                should_cancel = lock.get("cancel", False)
                if not should_cancel and (
                    fid in crew_failures or (needs_swap and not eligible_spares)
                ):
                    return self._infeasible_plan(plan_id, weights)

            if should_cancel:
                cancelled.append(fid)
            else:
                if expected_delay > 0:
                    dep_str = flight.get("scheduled_departure", "")
                    try:
                        orig_dep = datetime.fromisoformat(dep_str.replace("Z", "+00:00"))
                        new_dep_str = (orig_dep + timedelta(minutes=expected_delay)).isoformat()
                    except (ValueError, AttributeError):
                        new_dep_str = dep_str
                    delayed.append(
                        {
                            "flight_id": fid,
                            "delay_minutes": expected_delay,
                            "new_departure": new_dep_str,
                            "original_departure": dep_str,
                        }
                    )
                if needs_swap and eligible_spares:
                    spare = eligible_spares[0]
                    spare_q.remove(spare)
                    swaps.append(
                        {
                            "flight_id": fid,
                            "old_aircraft": original_ac,
                            "new_aircraft": spare,
                            "aircraft_type": aircraft_map.get(spare, {}).get("type", ""),
                        }
                    )

        if plan_id == "C" and not locks:
            cancelled_ac = {
                flights_map[fid]["aircraft_id"] for fid in cancelled if fid in flights_map
            }
            for info in delayed:
                fid = info["flight_id"]
                if any(swap["flight_id"] == fid for swap in swaps):
                    continue
                orig_ac = flights_map.get(fid, {}).get("aircraft_id", "")
                eligible = [
                    spare
                    for spare in spare_q
                    if aircraft_available(
                        flights_map[fid],
                        spare,
                        flights_map,
                        aircraft_map,
                        predictions,
                        grounded_tails,
                    )
                ]
                if orig_ac in cancelled_ac and eligible:
                    spare = eligible[0]
                    spare_q.remove(spare)
                    swaps.append(
                        {
                            "flight_id": fid,
                            "old_aircraft": orig_ac,
                            "new_aircraft": spare,
                            "aircraft_type": aircraft_map.get(spare, {}).get("type", ""),
                        }
                    )
                    cancelled_ac.discard(orig_ac)

        return self._build_plan(
            plan_id,
            weights,
            "heuristic",
            cancelled,
            delayed,
            swaps,
            flights_map,
            aircraft_map,
            crews,
            event_kind,
            ac_type_map,
        )

    def _decide_cancel(
        self,
        plan_id: str,
        flight: dict,
        expected_delay: int,
        p_delayed: float,
        cascade_order: int,
        event_kind: str,
        aircraft_type: str = "",
    ) -> bool:
        if plan_id == "A":
            if expected_delay < 60:
                return False
            d_info = self.calc.delay_cost(flight, expected_delay, event_kind, aircraft_type)
            c_info = self.calc.cancellation_cost(flight, event_kind, aircraft_type)
            return d_info.total > c_info.total
        elif plan_id == "B":
            return expected_delay > 480 and p_delayed > 0.85
        elif plan_id == "C":
            if cascade_order == 0 and expected_delay >= 120:
                return True
            if cascade_order == 1 and expected_delay >= 150:
                return True
            return False
        elif plan_id == "D":
            delay_co2 = carbon_for_delay(flight, expected_delay, aircraft_type).co2_kg
            hold_cost = int(delay_co2 / 1000.0 * EU_ETS_USD_PER_TONNE)
            return hold_cost > max(1, flight.get("passengers", 150)) * GREEN_CANCEL_USD_PER_PAX
        return expected_delay > 180

    # ── Shared plan builder ───────────────────────────────────────────────────

    def _build_plan(
        self,
        plan_id: str,
        weights: dict,
        status: str,
        cancelled: list[str],
        delayed: list[dict],
        swaps: list[dict],
        flights_map: dict,
        aircraft_map: dict,
        crews: list,
        event_kind: str,
        ac_type_map: dict,
    ) -> RecoveryPlan:
        cost_data = self.calc.portfolio_cost(
            flights=flights_map,
            cancelled=cancelled,
            delayed=delayed,
            event_kind=event_kind,
            aircraft_type_map=ac_type_map,
        )
        swap_cost = len(swaps) * AIRCRAFT_REPOSITION_COST
        total_cost = cost_data["grand_total_usd"] + swap_cost

        cost_breakdown = {
            **cost_data,
            "reposition_cost_usd": swap_cost,
            "grand_total_usd": round(total_cost),
        }

        # Carbon ledger — EU-ETS-priced CO₂ for every plan (Slice 4).
        carbon = portfolio_carbon(
            flights=flights_map,
            cancelled=cancelled,
            delayed=delayed,
            swaps=swaps,
            aircraft_type_map=ac_type_map,
        )
        carbon_breakdown = carbon.to_dict()

        n_can = len(cancelled)
        n_del = len(delayed)
        avg_del = (sum(d["delay_minutes"] for d in delayed) // n_del) if n_del else 0
        summary = (
            f"{n_can} cancelled, {n_del} delayed (avg {avg_del} min), "
            f"{len(swaps)} swaps · {carbon.total_co2_kg / 1000:+.1f} tCO₂e"
        )

        return RecoveryPlan(
            plan_id=plan_id,
            objective_label=weights["label"],
            status=status,
            solve_time_ms=0,
            cancelled_flights=cancelled,
            delayed_flights=delayed,
            aircraft_swaps=swaps,
            crew_reassignments=[],
            total_cost_usd=round(total_cost, 2),
            total_passenger_delay_minutes=cost_data.get("total_pax_delay_minutes", 0),
            crew_violations=0,  # validate_plan uses the actual supplied roster.
            aircraft_out_of_position=len(swaps),
            cost_breakdown=cost_breakdown,
            total_co2_kg=carbon.total_co2_kg,
            eu_ets_cost_usd=carbon.eu_ets_cost_usd,
            carbon_breakdown=carbon_breakdown,
            summary=summary,
        )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _extract_grounded_tails(self, events: list[dict]) -> set[str]:
        grounded: set[str] = set()
        for ev in events:
            if ev.get("type") == "aircraft_grounded":
                tail = ev.get("aircraft_tail", "")
                if tail:
                    grounded.add(tail)
        return grounded

    def _extract_event_kind(self, events: list[dict]) -> str:
        return economic_event_kind(events)

    def _empty_plan(self, plan_id: str, weights: dict) -> RecoveryPlan:
        return RecoveryPlan(
            plan_id=plan_id,
            objective_label=weights["label"],
            status="optimal",
            solve_time_ms=0,
            summary="No disrupted flights to recover",
        )

    def _infeasible_plan(self, plan_id: str, weights: dict | None = None) -> RecoveryPlan:
        label = (weights or {}).get("label", PLAN_WEIGHTS.get(plan_id, {}).get("label", "Unknown"))
        return RecoveryPlan(
            plan_id=plan_id,
            objective_label=label,
            status="infeasible",
            solve_time_ms=0,
            summary="No feasible solution found — check event constraints",
        )
