"""Inspectable crew-member audit of the repository's modeled rule set.

This exposes modeled arithmetic, not a certification of complete FAR 117
coverage. Missing roster inputs are unknown, never assumed legal.
"""

from datetime import datetime, timedelta

from src.crew.far117 import (
    MAX_FT_7_DAYS_HOURS,
    MAX_FT_28_DAYS_HOURS,
    MAX_FT_365_DAYS_HOURS,
    MAX_FT_PER_FDP_HOURS,
    MIN_REST_HOURS,
    MIN_TURN_MINUTES,
    CrewState,
)


def _time(value):
    if not value:
        return None
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result if result.tzinfo else None
    except (ValueError, TypeError):
        return None


def audit_crew(result: dict, plan_id=None):
    flights = {f["id"]: f for f in result["schedule"]}
    plan = next((p for p in result.get("recovery_plans", []) if p["plan_id"] == plan_id), None)
    if plan_id and plan is None:
        raise ValueError("Unknown recovery plan")
    cancelled = set((plan or {}).get("cancelled_flights", []))
    delays = {
        f["flight_id"]: f.get("delay_minutes", 0) for f in (plan or {}).get("delayed_flights", [])
    }
    rows = []
    for crew in result["crew_members"]:
        if crew.get("role") not in ("captain", "first_officer"):
            continue
        pairings = [
            p
            for p in result["crew_pairings"]
            if crew["id"] in (p.get("captain_id"), p.get("first_officer_id"))
            and p.get("flight_id") in flights
            and p["flight_id"] not in cancelled
        ]
        pairings.sort(key=lambda p: flights[p["flight_id"]]["scheduled_departure"])
        accumulated = 0.0
        fdp_accumulated = 0.0
        prior_arrival = None
        prior_report = None
        for pairing in pairings:
            f = flights[pairing["flight_id"]]
            delay = timedelta(minutes=delays.get(f["id"], 0))
            departure = _time(f.get("scheduled_departure"))
            arrival = _time(f.get("scheduled_arrival"))
            report = _time(pairing.get("duty_start"))
            if departure is None or arrival is None:
                continue
            departure += delay
            arrival += delay
            if report != prior_report:
                fdp_accumulated = 0
                prior_arrival = None
                prior_report = report
            flight_minutes = pairing.get("flight_time_minutes")
            # Do not replace missing block-time input with a made-up regulatory value.
            ft = (
                float(flight_minutes)
                if isinstance(flight_minutes, (float, int)) and not isinstance(flight_minutes, bool)
                else None
            )
            tz = crew.get("home_timezone_offset_hours")
            state = {
                **crew,
                "current_fdp_start": report.isoformat() if report else None,
                "current_fdp_flight_minutes": fdp_accumulated,
            }
            for window in (7, 28, 365):
                prior = crew.get(f"flight_time_{window}d_minutes")
                if prior is None and isinstance(crew.get(f"flight_hours_{window}d"), (int, float)):
                    prior = crew[f"flight_hours_{window}d"] * 60
                state[f"flight_time_{window}d_minutes"] = (
                    prior + accumulated if prior is not None else None
                )

            def row(rule, label, value, limit, inputs, minimum=False):
                slack = (
                    None
                    if value is None or limit is None
                    else value - limit
                    if minimum
                    else limit - value
                )
                rows.append(
                    {
                        "crew_id": crew["id"],
                        "crew_name": crew.get("name", crew["id"]),
                        "flight_id": f["id"],
                        "pairing_id": pairing["id"],
                        "rule": rule,
                        "label": label,
                        "value": value,
                        "limit": limit,
                        "slack": slack,
                        "unit": "minutes",
                        "status": "unknown" if slack is None else "pass" if slack >= 0 else "fail",
                        "inputs": inputs,
                    }
                )

            rest_end = _time(crew.get("last_rest_end"))
            row(
                "modeled-rest",
                "Rest interval in existing model",
                (departure - rest_end).total_seconds() / 60 if rest_end else None,
                MIN_REST_HOURS * 60,
                {
                    "departure": departure.isoformat(),
                    "last_rest_end": crew.get("last_rest_end"),
                    "formula": "departure - last_rest_end; existing model interpretation",
                },
                True,
            )
            max_fdp = (
                CrewState(
                    id=crew["id"], role=crew["role"], home_timezone_offset_hours=tz
                ).max_fdp_hours(report)
                * 60
                if report and isinstance(tz, (float, int))
                else None
            )
            row(
                "modeled-fdp",
                "Flight duty period",
                (arrival - report).total_seconds() / 60 if report else None,
                max_fdp,
                {
                    "report": pairing.get("duty_start"),
                    "arrival": arrival.isoformat(),
                    "home_timezone_offset_hours": tz,
                    "formula": "arrival - report; existing FDP_TABLE with WOCL adjustment",
                },
            )
            row(
                "modeled-flight-time",
                "Flight time this duty",
                fdp_accumulated + ft if ft is not None else None,
                MAX_FT_PER_FDP_HOURS * 60,
                {
                    "prior_duty_minutes": fdp_accumulated,
                    "proposed_flight_minutes": ft,
                    "formula": "prior duty flight time + proposed flight time",
                },
            )
            for window, limit in (
                (7, MAX_FT_7_DAYS_HOURS),
                (28, MAX_FT_28_DAYS_HOURS),
                (365, MAX_FT_365_DAYS_HOURS),
            ):
                prior = state[f"flight_time_{window}d_minutes"]
                row(
                    f"modeled-{window}d",
                    f"{window}-day cumulative flight time",
                    prior + ft if prior is not None and ft is not None else None,
                    limit * 60,
                    {
                        "history_and_earlier_legs_minutes": prior,
                        "proposed_flight_minutes": ft,
                        "formula": "roster history + earlier proposed legs + this leg",
                    },
                )
            if prior_arrival:
                row(
                    "modeled-turn",
                    "Turn interval",
                    (departure - prior_arrival).total_seconds() / 60,
                    MIN_TURN_MINUTES,
                    {
                        "previous_arrival": prior_arrival.isoformat(),
                        "departure": departure.isoformat(),
                        "formula": "departure - previous arrival",
                    },
                    True,
                )
            if ft is not None:
                accumulated += ft
                fdp_accumulated += ft
            prior_arrival = arrival
    return {
        "scope": "Existing modeled rules, evaluated per rostered pilot and assigned flight. Not complete FAR Part 117 certification.",
        "limitations": [
            "Missing rest, timezone or historical inputs remain unknown.",
            "Existing model uses simplified FDP and cumulative rules; independent regulatory validation remains required.",
            "Cancellation removes a leg; no invented crew reassignment is applied.",
        ],
        "plan_id": plan_id,
        "rows": rows,
        "summary": {
            key: sum(r["status"] == key for r in rows) for key in ("pass", "fail", "unknown")
        },
    }
