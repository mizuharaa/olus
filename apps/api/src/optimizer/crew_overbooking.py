"""
Crew Overbooking Optimizer — OR-Tools CP-SAT.

When a disruption (crew_sickout, mechanical_aog, etc.) leaves flights without
crew assignments, this module finds the maximum-coverage simulation reassignment of
available crew members to open flights subject to:
  - Known violations of the supported Part 117 subset excluded; unknown disclosed
  - Aircraft type certification
  - One qualified captain AND first officer per covered flight
  - Each pilot on at most one reassigned flight

Returns a CrewOverbookingResult with:
  - covered_assignments: {flight_id → assigned_captain_id}
  - uncovered_flights:   flights that cannot be staffed
  - cancelled_recommended: subset of uncovered_flights recommended for cancellation
  - compensation_obligations: per-flight modeled carrier policy allowances
  - coverage_pct, pax_covered, pax_uncovered
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime

from ortools.sat.python import cp_model

from src.crew.far117 import CrewLegalityEngine, _number

logger = logging.getLogger(__name__)

CPSAT_TIMEOUT = 10  # seconds
MIN_CERT_MATCH = True  # enforce aircraft type certification

# Event categories used for illustrative carrier policy allowances, not liability findings.
AIRLINE_FAULT_EVENTS = {"crew_sickout", "mechanical_aog", "cyber_incident"}

# Events treated as force majeure → goodwill-only
FORCE_MAJEURE_EVENTS = {
    "weather_closure",
    "ground_stop",
    "airspace_closure",
    "security_event",
    "volcanic_ash",
    "atc_staffing",
    "runway_closure",
}


@dataclass
class CrewAssignment:
    flight_id: str
    captain_id: str
    captain_name: str
    fo_id: str
    fo_name: str
    is_reassigned: bool  # True if different crew from original pairing
    far117_legal: bool
    violations: list[str] = field(default_factory=list)
    legality_status: str = "unknown"
    unknowns: list[str] = field(default_factory=list)


@dataclass
class CompensationObligation:
    flight_id: str
    event_kind: str
    is_airline_fault: bool
    delay_minutes: int
    is_cancelled: bool
    pax: int

    meal_voucher_usd: float = 0.0
    hotel_required: bool = False
    travel_credit_usd: float = 0.0
    dot261_cash_usd: float = 0.0
    rebooking: str = "none"  # "modeled_policy" | "goodwill_no_fee" | "none"
    legal_basis: str = ""
    notes: list[str] = field(default_factory=list)


@dataclass
class CrewOverbookingResult:
    solved: bool
    solve_time_ms: int
    solver_status: str  # "optimal" | "feasible" | "heuristic" | "infeasible"

    total_open_flights: int
    total_covered: int
    total_uncovered: int
    coverage_pct: float

    pax_covered: int
    pax_uncovered: int

    covered_assignments: list[CrewAssignment]
    uncovered_flights: list[str]
    cancelled_recommended: list[str]

    compensation_obligations: list[CompensationObligation]
    summary: str

    def to_dict(self) -> dict:
        from dataclasses import asdict

        return asdict(self)


class CrewOverbookingOptimizer:
    """
    Solves crew overbooking via MILP when disruptions leave flights without crew.
    """

    def __init__(self) -> None:
        self.legality = CrewLegalityEngine()

    def solve(
        self,
        open_flights: list[dict],  # flights missing crew
        crew_members: list[dict],  # all crew_members from YAML
        existing_pairings: list[dict],  # all crew_pairings from YAML
        available_crew_ids: set[str],  # crew IDs that are NOT on sickout/unavailable
        event_kind: str,
        disrupted_flight_ids: list[str],  # flights impacted by the disruption
        predictions: dict[str, dict],
    ) -> CrewOverbookingResult:
        t0 = time.monotonic()
        if not open_flights:
            return self._empty_result(0)
        crew_by_id = {c["id"]: c for c in crew_members if c["id"] in available_crew_ids}
        flight_ids = {f["id"] for f in open_flights}
        model, solver = cp_model.CpModel(), cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = CPSAT_TIMEOUT
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 0
        assignments, covered, assessments = {}, {}, {}
        for flight in open_flights:
            fid = flight["id"]
            dep = self.legality._to_dt(flight.get("scheduled_departure"))
            arr = self.legality._to_dt(flight.get("scheduled_arrival"))
            covered[fid] = model.new_bool_var(f"covered_{fid}")
            for role in ("captain", "first_officer"):
                role_vars = []
                for cid, crew in crew_by_id.items():
                    if crew.get("role") != role:
                        continue
                    # No broad B-prefix type matching and no guessed qualification.
                    if not flight.get("aircraft_type") or flight["aircraft_type"] not in crew.get(
                        "cert_types", []
                    ):
                        continue
                    if (
                        not dep
                        or not arr
                        or (dep.tzinfo is None) != (arr.tzinfo is None)
                        or arr <= dep
                    ):
                        continue
                    # A supplied availability set is not permission to double-book a roster.
                    other = [
                        p
                        for p in existing_pairings
                        if p.get("flight_id") not in flight_ids
                        and cid in (p.get("captain_id"), p.get("first_officer_id"))
                    ]
                    report = self.legality._to_dt(
                        crew.get("current_fdp_start") or crew.get("duty_start")
                    )
                    if any(not self._pairing_disjoint(p, report or dep, arr) for p in other):
                        continue
                    if (
                        not flight.get("origin")
                        or not crew.get("current_airport")
                        or crew["current_airport"] != flight["origin"]
                    ):
                        continue
                    snapshot = self._build_crew_snapshot(crew, dep)
                    ft = flight.get("flight_time_minutes")
                    segments = crew.get("scheduled_segments")
                    if segments is None and _number(crew.get("current_fdp_flight_minutes")) == 0:
                        segments = 1
                    result = self.legality.validate(
                        snapshot,
                        dict(
                            departure=dep,
                            arrival=arr,
                            flight_time_minutes=ft,
                            scheduled_segments=segments,
                        ),
                    )
                    assessments[(fid, cid)] = result
                    if result.status == "fail":
                        continue
                    # Unknown is allowed as a SIMULATION candidate, never legal certification.
                    var = model.new_bool_var(f"assign_{fid}_{cid}")
                    assignments[(fid, cid)] = var
                    role_vars.append(var)
                model.add(sum(role_vars) == covered[fid])
        for cid in crew_by_id:
            uses = [v for (fid, person), v in assignments.items() if person == cid]
            # ponytail: one reassigned leg per pilot; multi-leg recovery needs route/history propagation.
            if uses:
                model.add_at_most_one(uses)
        pax_map = {f["id"]: int(_number(f.get("passengers")) or 0) for f in open_flights}
        model.maximize(sum(pax_map[fid] * covered[fid] for fid in flight_ids))
        status_code = solver.solve(model)
        solved = status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        selected, uncovered = [], []
        for flight in open_flights:
            fid = flight["id"]
            if not solved or not solver.value(covered[fid]):
                uncovered.append(fid)
                continue
            pilots = [
                crew_by_id[cid]
                for (flight_id, cid), var in assignments.items()
                if flight_id == fid and solver.value(var)
            ]
            captain = next(p for p in pilots if p["role"] == "captain")
            fo = next(p for p in pilots if p["role"] == "first_officer")
            checks = [assessments[(fid, captain["id"])], assessments[(fid, fo["id"])]]
            original = next((p for p in existing_pairings if p.get("flight_id") == fid), {})
            selected.append(
                CrewAssignment(
                    flight_id=fid,
                    captain_id=captain["id"],
                    captain_name=captain.get("name", captain["id"]),
                    fo_id=fo["id"],
                    fo_name=fo.get("name", fo["id"]),
                    is_reassigned=original.get("captain_id") != captain["id"]
                    or original.get("first_officer_id") != fo["id"],
                    far117_legal=False,  # Compatibility field cannot certify all Part 117 requirements.
                    violations=[v for c in checks for v in c.violations],
                    legality_status="pass"
                    if all(c.status == "pass" for c in checks)
                    else "unknown",
                    unknowns=[u for c in checks for u in c.unknowns],
                )
            )
        coverage = round(100 * len(selected) / len(open_flights), 1)
        return CrewOverbookingResult(
            solved=solved,
            solve_time_ms=int((time.monotonic() - t0) * 1000),
            solver_status="optimal"
            if status_code == cp_model.OPTIMAL
            else "feasible"
            if solved
            else "infeasible",
            total_open_flights=len(open_flights),
            total_covered=len(selected),
            total_uncovered=len(uncovered),
            coverage_pct=coverage,
            pax_covered=sum(pax_map[a.flight_id] for a in selected),
            pax_uncovered=sum(pax_map[fid] for fid in uncovered),
            covered_assignments=selected,
            uncovered_flights=uncovered,
            cancelled_recommended=list(uncovered),
            compensation_obligations=self._compute_compensation(
                open_flights, uncovered, predictions, event_kind
            ),
            summary=f"{len(selected)}/{len(open_flights)} flights have two qualified simulation candidates; legality coverage is reported separately.",
        )

    def _pairing_disjoint(self, pairing, departure, arrival):
        start = self.legality._to_dt(pairing.get("duty_start"))
        end = self.legality._to_dt(pairing.get("duty_end"))
        if (
            not start
            or not end
            or any((t.tzinfo is None) != (departure.tzinfo is None) for t in (start, end))
        ):
            return False
        return arrival <= start or departure >= end

    # ── Compensation logic ────────────────────────────────────────────────────

    def _compute_compensation(
        self,
        open_flights: list[dict],
        uncovered_ids: list[str],
        predictions: dict[str, dict],
        event_kind: str,
    ) -> list[CompensationObligation]:
        is_airline_fault = event_kind in AIRLINE_FAULT_EVENTS
        obligations: list[CompensationObligation] = []

        for flight in open_flights:
            fid = flight["id"]
            pax = int(_number(flight.get("passengers")) or 0)
            pred = predictions.get(fid, {})
            delay_min = max(0, int(pred.get("expected_delay_min", 60)))
            is_cancelled = fid in uncovered_ids

            ob = CompensationObligation(
                flight_id=fid,
                event_kind=event_kind,
                is_airline_fault=is_airline_fault,
                delay_minutes=delay_min,
                is_cancelled=is_cancelled,
                pax=pax,
            )

            if is_airline_fault:
                ob.legal_basis = (
                    "Illustrative carrier policy; not a determination of statutory entitlement"
                )
                ob.rebooking = "modeled_policy"

                if delay_min >= 120:
                    ob.meal_voucher_usd = 15.0
                    ob.notes.append("Assumed carrier-policy meal allowance for 2h+ delay")

                if delay_min >= 240:
                    ob.hotel_required = True
                    ob.notes.append("Assumed carrier-policy accommodation for 4h+ delay")

                if is_cancelled:
                    ob.travel_credit_usd = 200.0
                    # Cancellation does not establish involuntary denied boarding.
                    ob.dot261_cash_usd = 0.0
                    ob.notes.append(
                        "Refund/rebooking eligibility requires itinerary, fare and carrier-policy review."
                    )

            else:
                ob.legal_basis = (
                    "Illustrative disruption assistance; statutory eligibility not evaluated"
                )
                ob.rebooking = "goodwill_no_fee"

                if delay_min >= 180:
                    ob.meal_voucher_usd = 10.0
                    ob.notes.append("Goodwill meal voucher (not legally required)")

                if is_cancelled:
                    ob.notes.append(
                        "Goodwill: rebook on next available flight at no fee. "
                        "Cash-compensation eligibility not evaluated."
                    )

            obligations.append(ob)

        return obligations

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _build_crew_snapshot(self, cap: dict, report_time: datetime) -> dict:
        # Copy supplied evidence only. Departure is not a guessed report time.
        return dict(cap)

    def _empty_result(self, ms: int) -> CrewOverbookingResult:
        return CrewOverbookingResult(
            solved=True,
            solve_time_ms=ms,
            solver_status="optimal",
            total_open_flights=0,
            total_covered=0,
            total_uncovered=0,
            coverage_pct=100.0,
            pax_covered=0,
            pax_uncovered=0,
            covered_assignments=[],
            uncovered_flights=[],
            cancelled_recommended=[],
            compensation_obligations=[],
            summary="No open flights requiring crew reassignment",
        )
