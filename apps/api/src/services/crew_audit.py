"""Shared per-flight crew assessment used by solver constraints and audit UI."""

from collections import Counter
from datetime import timedelta, timezone

from src.crew.far117 import SCOPE, CrewLegalityEngine, LegalityResult, _number


def assess_plan_crew(schedule, crew_pairings, crew_members, delays=None, cancelled=None):
    delays, cancelled = delays or {}, set(cancelled or ())
    flights = {f["id"]: f for f in schedule if f["id"] not in cancelled}
    members = {c["id"]: c for c in (crew_members or [])}
    engine = CrewLegalityEngine()
    results = {fid: LegalityResult(False) for fid in flights}
    assignments = {}
    for pairing in crew_pairings:
        fid = pairing.get("flight_id")
        if fid not in flights:
            continue
        assignments.setdefault(fid, []).append(pairing)
    for fid, result in results.items():
        entries = assignments.get(fid, [])
        if len(entries) != 1:
            result.unknowns.append("Missing or ambiguous crew pairing")
            continue
        pairing = entries[0]
        if pairing.get("captain_id") and pairing.get("captain_id") == pairing.get(
            "first_officer_id"
        ):
            result.violations.append("The same crew member cannot fill both pilot roles")
        for role, key in (("captain", "captain_id"), ("first_officer", "first_officer_id")):
            person = members.get(pairing.get(key))
            if person is None:
                result.unknowns.append(f"Missing {role} roster")
            elif person.get("role") != role:
                result.violations.append(f"{role} assignment has wrong roster role")

    for cid, person in members.items():
        if person.get("role") not in ("captain", "first_officer"):
            continue
        legs = [
            (p, flights[p["flight_id"]])
            for ps in assignments.values()
            for p in ps
            if cid in (p.get("captain_id"), p.get("first_officer_id"))
        ]

        def departure_key(item):
            value = engine._to_dt(item[1].get("scheduled_departure"))
            return (
                (
                    value if value and value.tzinfo else value.replace(tzinfo=timezone.utc)
                ).timestamp()
                if value
                else float("inf")
            )

        legs.sort(key=departure_key)
        segments = Counter(engine._to_dt(p.get("duty_start")) for p, _ in legs)
        outside_schedule = any(
            p.get("flight_id") not in flights
            and p.get("flight_id") not in cancelled
            and cid in (p.get("captain_id"), p.get("first_officer_id"))
            for p in crew_pairings
        )
        previous_arrival, previous_destination = None, None
        previous_report = None
        first_leg = True
        duty_flight = _number(person.get("current_fdp_flight_minutes"))
        later_duty = False
        for pairing, flight in legs:
            out = results[flight["id"]]
            report = engine._to_dt(pairing.get("duty_start"))
            departure = engine._to_dt(flight.get("scheduled_departure"))
            arrival = engine._to_dt(flight.get("scheduled_arrival"))
            new_duty = first_leg or report != previous_report
            if new_duty:
                duty_flight = _number(person.get("current_fdp_flight_minutes"))
                if not first_leg:
                    # Window snapshots cannot reconstruct expiry of historic duties.
                    later_duty = True
                if later_duty:
                    out.unknowns.append(
                        "Multiple FDPs require per-duty rest and rolling-history snapshots"
                    )
                previous_report = report
            first_leg = False
            if report is None:
                out.unknowns.append(f"{cid}: missing duty report time")
            delay = timedelta(minutes=delays.get(flight["id"], 0))
            departure = departure + delay if departure else None
            arrival = arrival + delay if arrival else None
            ft = _number(pairing.get("flight_time_minutes"))
            snapshot = {
                **person,
                "current_fdp_start": report,
                "current_fdp_flight_minutes": duty_flight,
            }
            if outside_schedule:
                out.unknowns.append(
                    f"{cid}: assigned legs outside the assessed schedule; duty history is incomplete"
                )
            if later_duty:
                for key in (
                    "flight_time_28d_minutes",
                    "flight_time_365d_minutes",
                    "flight_hours_28d",
                    "flight_hours_365d",
                    "fdp_time_7d_minutes",
                    "fdp_time_28d_minutes",
                    "last_rest_start",
                    "last_rest_end",
                    "last_rest_duration_hours",
                    "sleep_opportunity_minutes",
                    "consecutive_duty_free_168h_minutes",
                ):
                    snapshot[key] = None
                if (
                    new_duty
                    and previous_arrival
                    and report
                    and (previous_arrival.tzinfo is None) == (report.tzinfo is None)
                    and report - previous_arrival < timedelta(hours=10)
                ):
                    out.violations.append(
                        f"{cid}: less than ten hours between prior planned arrival and next report"
                    )
            proposed = dict(
                departure=departure,
                arrival=arrival,
                flight_time_minutes=ft,
                scheduled_segments=None if outside_schedule else segments[report],
                last_arrival=previous_arrival,
            )
            result = engine.validate(snapshot, proposed)
            ac_type, certifications = flight.get("aircraft_type"), person.get("cert_types")
            if not ac_type or not certifications:
                result.unknowns.append("Aircraft qualification evidence missing")
            elif ac_type not in certifications:
                result.violations.append(
                    f"{cid} lacks exact aircraft-type qualification for {ac_type}"
                )
            if (
                not flight.get("origin")
                or not flight.get("destination")
                or (previous_arrival and not previous_destination)
            ):
                result.unknowns.append(
                    "Crew location continuity cannot be established from missing airport inputs"
                )
            if previous_arrival is None:
                if not person.get("current_airport"):
                    result.unknowns.append("Initial crew location is missing")
                elif flight.get("origin") and person["current_airport"] != flight["origin"]:
                    result.violations.append(f"{cid} is not at the first departure airport")
            if (
                previous_destination
                and flight.get("origin")
                and previous_destination != flight["origin"]
            ):
                result.violations.append(
                    f"{cid} is not at the next departure airport; no positioning leg supplied"
                )
            for attr in ("violations", "warnings", "unknowns"):
                getattr(out, attr).extend(f"{cid}: {item}" for item in getattr(result, attr))
            out.checks.extend(
                {
                    **row,
                    "crew_id": cid,
                    "crew_name": person.get("name", cid),
                    "flight_id": flight["id"],
                    "pairing_id": pairing.get("id"),
                }
                for row in result.checks
            )
            duty_flight = duty_flight + ft if duty_flight is not None and ft is not None else None
            previous_arrival, previous_destination = arrival, flight.get("destination")
    for result in results.values():
        result.status = "fail" if result.violations else "unknown" if result.unknowns else "pass"
        result.is_legal = result.status == "pass"
    return results


def audit_crew(result, plan_id=None):
    plan = next((p for p in result.get("recovery_plans", []) if p["plan_id"] == plan_id), None)
    if plan_id and plan is None:
        raise ValueError("Unknown recovery plan")
    delays = {
        f["flight_id"]: f.get("delay_minutes", 0) for f in (plan or {}).get("delayed_flights", [])
    }
    assessments = assess_plan_crew(
        result["schedule"],
        result["crew_pairings"],
        result["crew_members"],
        delays,
        (plan or {}).get("cancelled_flights", []),
    )
    rows = [row for assessment in assessments.values() for row in assessment.checks]
    return {
        "scope": SCOPE,
        "limitations": [
            "Missing roster, acclimation, rest, timezone and rolling-history evidence is unknown.",
            "Scope excludes reserve, split/augmented duty, extensions, travel recovery and consecutive nighttime duties.",
            "History snapshots precede the current FDP. Multi-FDP rolling history requires a timestamped ledger.",
            "Aircraft qualification uses exact supplied type; approved cross-type qualifications are not inferred.",
        ],
        "plan_id": plan_id,
        "rows": rows,
        "flights": {fid: a.to_dict() for fid, a in assessments.items()},
        "flight_summary": {
            key: sum(a.status == key for a in assessments.values())
            for key in ("pass", "fail", "unknown")
        },
        "summary": {
            key: sum(row["status"] == key for row in rows) for key in ("pass", "fail", "unknown")
        },
    }
