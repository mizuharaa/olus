"""Part 117 supported-rule boundaries and unknown-data regressions."""

from datetime import datetime, timedelta, timezone

import pytest

from src.crew.far117 import CrewLegalityEngine
from src.optimizer.crew_overbooking import CrewOverbookingOptimizer
from src.services.crew_audit import assess_plan_crew


def crew(role="captain", **changes):
    report = datetime(2026, 9, 20, 8, tzinfo=timezone.utc)
    return (
        dict(
            id=role,
            role=role,
            current_fdp_start=report,
            last_rest_start=report - timedelta(hours=10),
            last_rest_end=report,
            current_fdp_flight_minutes=0,
            flight_time_28d_minutes=0,
            flight_time_365d_minutes=0,
            fdp_time_7d_minutes=0,
            fdp_time_28d_minutes=0,
            sleep_opportunity_minutes=480,
            consecutive_duty_free_168h_minutes=1800,
            home_timezone_offset_hours=0,
            acclimated_at_home=True,
            acclimated=True,
            operation_type="unaugmented",
            cert_types=["B737-800"],
            current_airport="JFK",
        )
        | changes
    )


def pairing(**changes):
    return (
        dict(
            departure=datetime(2026, 9, 20, 9, tzinfo=timezone.utc),
            arrival=datetime(2026, 9, 20, 11, tzinfo=timezone.utc),
            flight_time_minutes=120,
            scheduled_segments=1,
        )
        | changes
    )


@pytest.mark.parametrize(
    "hour,segments,expected",
    [
        (4, 1, 10),
        (5, 1, 12),
        (7, 1, 14),
        (11, 3, 13),
        (13, 1, 12),
        (17, 5, 10),
        (22, 1, 11),
        (23, 4, 9),
        (8, 8, 11.5),
    ],
)
def test_table_b(hour, segments, expected):
    assert (
        CrewLegalityEngine().fdp_limit_for_report_time(datetime(2026, 9, 20, hour), 0, segments)
        == expected
    )


@pytest.mark.parametrize("hour,expected", [(4, 8), (5, 9), (19, 9), (20, 8), (23, 8)])
def test_table_a(hour, expected):
    assert (
        CrewLegalityEngine().flight_time_limit_for_report_time(datetime(2026, 9, 20, hour))
        == expected
    )


def test_fractional_timezone_and_aware_report():
    engine = CrewLegalityEngine()
    report = datetime(2026, 9, 20, 1, 30, tzinfo=timezone.utc)
    assert engine.fdp_limit_for_report_time(report, 5.5, 1) == 14
    assert (
        engine.fdp_limit_for_report_time(report.astimezone(timezone(timedelta(hours=5.5))), 5.5, 1)
        == 14
    )


def test_rest_completed_before_flight_does_not_restart_rest_clock():
    result = CrewLegalityEngine().validate(crew(), pairing())
    assert result.status == "pass", result.to_dict()
    assert result.rest_required_before_minutes == 0


def test_missing_history_is_unknown_not_legal():
    result = CrewLegalityEngine().validate({"id": "unknown"}, pairing())
    assert result.status == "unknown" and not result.is_legal and not result.violations


@pytest.mark.parametrize(
    "field,value,rule",
    [
        ("fdp_time_7d_minutes", 3421, "modeled-fdp-7d"),
        ("fdp_time_28d_minutes", 11221, "modeled-fdp-28d"),
        ("flight_time_28d_minutes", 5881, "modeled-28d"),
        ("flight_time_365d_minutes", 59881, "modeled-365d"),
    ],
)
def test_cumulative_limits(field, value, rule):
    result = CrewLegalityEngine().validate(crew(**{field: value}), pairing())
    assert result.status == "fail"
    assert next(c for c in result.checks if c["rule"] == rule)["slack"] == -1


def test_seven_day_flight_total_is_not_sixty_hour_fdp_rule():
    assert (
        CrewLegalityEngine().validate(crew(flight_time_7d_minutes=4000), pairing()).status == "pass"
    )


def test_short_rest_is_known_violation_and_reports_shortfall():
    person = crew()
    person["last_rest_start"] = person["last_rest_end"] - timedelta(hours=9)
    result = CrewLegalityEngine().validate(person, pairing())
    assert result.status == "fail" and result.rest_required_before_minutes == 60


def flight(fid="F1", **changes):
    p = pairing()
    return (
        dict(
            id=fid,
            scheduled_departure=p["departure"].isoformat(),
            scheduled_arrival=p["arrival"].isoformat(),
            flight_time_minutes=120,
            aircraft_type="B737-800",
            origin="JFK",
            destination="BOS",
            passengers=100,
        )
        | changes
    )


def test_missing_first_officer_never_certifies_flight():
    p = dict(
        id="P1",
        flight_id="F1",
        captain_id="captain",
        duty_start=crew()["current_fdp_start"],
        flight_time_minutes=120,
    )
    result = assess_plan_crew([flight()], [p], [crew()])["F1"]
    assert result.status == "unknown" and any("first_officer" in x for x in result.unknowns)


def test_overbooking_requires_two_distinct_pilots_and_no_fo_reuse():
    opt = CrewOverbookingOptimizer()
    one = opt.solve([flight()], [crew()], [], {"captain"}, "crew_sickout", ["F1"], {})
    assert one.total_covered == 0
    pilots = [crew(), crew(id="captain2"), crew("first_officer")]
    two = opt.solve(
        [flight(), flight("F2")], pilots, [], {p["id"] for p in pilots}, "crew_sickout", [], {}
    )
    assert two.total_covered == 1
    assert not two.covered_assignments[0].far117_legal
    assert two.covered_assignments[0].legality_status == "pass"


def test_overbooking_does_not_invent_rest_or_qualification():
    pilots = [crew(), crew("first_officer", cert_types=["B747-400"])]
    result = CrewOverbookingOptimizer().solve(
        [flight()], pilots, [], {p["id"] for p in pilots}, "crew_sickout", [], {}
    )
    assert result.total_covered == 0


def test_claude_theater_offset_repro():
    report = datetime.fromisoformat("2026-09-20T02:30:00+01:00")
    person = crew(
        current_fdp_start=report,
        home_timezone_offset_hours=-4,
        acclimated_at_home=False,
        acclimated_timezone_offset_hours=1,
    )
    result = CrewLegalityEngine().validate(
        person,
        pairing(departure=report, arrival=report + timedelta(hours=10), flight_time_minutes=120),
    )
    row = next(c for c in result.checks if c["rule"] == "modeled-fdp")
    assert row["limit"] == 540 and row["status"] == "fail"


def test_missing_rest_shortfall_and_naive_clock_do_not_false_pass():
    person = crew(last_rest_start=None, last_rest_end=None)
    result = CrewLegalityEngine().validate(person, pairing())
    assert result.rest_required_before_minutes is None
    person["current_fdp_start"] = person["current_fdp_start"].replace(tzinfo=None)
    p = pairing()
    p.update(
        departure=p["departure"].replace(tzinfo=None), arrival=p["arrival"].replace(tzinfo=None)
    )
    result = CrewLegalityEngine().validate(person, p)
    assert next(c for c in result.checks if c["rule"] == "modeled-fdp")["status"] == "unknown"


def test_equivalent_report_strings_have_same_segment_count():
    report = datetime(2026, 9, 20, 6, tzinfo=timezone.utc)
    flights, pairings = [], []
    for i in range(4):
        dep = report + timedelta(hours=i * 3)
        flights.append(
            flight(
                f"F{i}",
                scheduled_departure=dep.isoformat(),
                scheduled_arrival=(dep + timedelta(hours=1)).isoformat(),
                origin="JFK",
                destination="JFK",
            )
        )
        pairings.append(
            dict(
                id=f"P{i}",
                flight_id=f"F{i}",
                captain_id="captain",
                first_officer_id="first_officer",
                duty_start=report.isoformat().replace("+00:00", "Z")
                if i < 2
                else report.isoformat(),
                flight_time_minutes=60,
            )
        )
    persons = [
        crew(
            role,
            current_fdp_start=report,
            last_rest_end=report,
            last_rest_start=report - timedelta(hours=10),
        )
        for role in ("captain", "first_officer")
    ]
    result = assess_plan_crew(flights, pairings, persons)
    assert all(
        c["inputs"]["scheduled_segments"] == 4 and c["limit"] == 720
        for r in result.values()
        for c in r.checks
        if c["rule"] == "modeled-fdp"
    )


def test_multi_duty_history_unknown_and_short_rest_fails():
    flights = [
        flight(),
        flight(
            "F2",
            scheduled_departure="2026-09-20T14:00:00+00:00",
            scheduled_arrival="2026-09-20T15:00:00+00:00",
            origin="BOS",
            destination="JFK",
        ),
    ]
    pairings = [
        dict(
            id="P1",
            flight_id="F1",
            captain_id="captain",
            first_officer_id="first_officer",
            duty_start="2026-09-20T08:00:00Z",
            flight_time_minutes=120,
        ),
        dict(
            id="P2",
            flight_id="F2",
            captain_id="captain",
            first_officer_id="first_officer",
            duty_start="2026-09-20T13:00:00Z",
            flight_time_minutes=60,
        ),
    ]
    result = assess_plan_crew(flights, pairings, [crew(), crew("first_officer")])["F2"]
    assert result.status == "fail" and any("less than ten" in v for v in result.violations)
    assert all(
        c["status"] == "unknown"
        for c in result.checks
        if c["rule"] in ("modeled-fdp-7d", "modeled-28d", "modeled-rest")
    )


def test_missing_airports_are_unknown():
    p = dict(
        id="P1",
        flight_id="F1",
        captain_id="captain",
        first_officer_id="first_officer",
        duty_start="2026-09-20T08:00:00Z",
        flight_time_minutes=120,
    )
    result = assess_plan_crew([flight(origin=None)], [p], [crew(), crew("first_officer")])["F1"]
    assert result.status == "unknown" and any("airport" in u for u in result.unknowns)


def test_unobserved_assigned_legs_make_duty_segment_coverage_unknown():
    p = dict(
        id="P1",
        flight_id="F1",
        captain_id="captain",
        first_officer_id="first_officer",
        duty_start="2026-09-20T08:00:00Z",
        flight_time_minutes=120,
    )
    absent = p | {"id": "P2", "flight_id": "outside"}
    result = assess_plan_crew([flight()], [p, absent], [crew(), crew("first_officer")])["F1"]
    assert result.status == "unknown"
    assert all(c["status"] == "unknown" for c in result.checks if c["rule"] == "modeled-fdp")


def test_leg_order_compares_instants_not_iso_strings():
    first = flight(
        scheduled_departure="2026-09-20T10:00:00+01:00", scheduled_arrival="2026-09-20T10:00:00Z"
    )
    second = flight(
        "F2",
        scheduled_departure="2026-09-20T07:00:00-04:00",
        scheduled_arrival="2026-09-20T08:00:00-04:00",
        origin="BOS",
        destination="JFK",
    )
    p = dict(
        id="P1",
        flight_id="F1",
        captain_id="captain",
        first_officer_id="first_officer",
        duty_start="2026-09-20T08:00:00Z",
        flight_time_minutes=60,
    )
    results = assess_plan_crew(
        [first, second], [p, p | {"id": "P2", "flight_id": "F2"}], [crew(), crew("first_officer")]
    )
    assert all(result.status == "pass" for result in results.values())


def test_missing_first_report_cannot_reset_history_on_second_duty():
    first = flight()
    second = flight(
        "F2",
        scheduled_departure="2026-09-20T14:00:00Z",
        scheduled_arrival="2026-09-20T15:00:00Z",
        origin="BOS",
        destination="JFK",
    )
    p = dict(
        id="P1",
        flight_id="F1",
        captain_id="captain",
        first_officer_id="first_officer",
        flight_time_minutes=120,
    )
    report = datetime(2026, 9, 20, 13, tzinfo=timezone.utc)
    persons = [
        crew(
            role,
            current_fdp_start=report,
            last_rest_start=report - timedelta(hours=10),
            last_rest_end=report,
        )
        for role in ("captain", "first_officer")
    ]
    result = assess_plan_crew(
        [first, second], [p, p | {"id": "P2", "flight_id": "F2", "duty_start": report}], persons
    )["F2"]
    assert result.status == "fail" and any("less than ten" in v for v in result.violations)


def test_overbooking_missing_location_rejected_and_segment_history_unknown():
    opt = CrewOverbookingOptimizer()
    persons = [crew(role, current_airport=None) for role in ("captain", "first_officer")]
    result = opt.solve(
        [flight(origin=None)], persons, [], {p["id"] for p in persons}, "crew_sickout", [], {}
    )
    assert result.total_covered == 0
    persons = [crew(role, current_fdp_flight_minutes=60) for role in ("captain", "first_officer")]
    result = opt.solve([flight()], persons, [], {p["id"] for p in persons}, "crew_sickout", [], {})
    assert result.total_covered == 1 and result.covered_assignments[0].legality_status == "unknown"


def test_overbooking_checks_report_to_arrival_overlap_not_only_flight_time():
    persons = [crew(), crew("first_officer")]
    busy = dict(
        flight_id="other",
        captain_id="captain",
        first_officer_id="first_officer",
        duty_start="2026-09-20T07:00:00Z",
        duty_end="2026-09-20T08:30:00Z",
    )
    result = CrewOverbookingOptimizer().solve(
        [flight()], persons, [busy], {p["id"] for p in persons}, "crew_sickout", [], {}
    )
    assert result.total_covered == 0
