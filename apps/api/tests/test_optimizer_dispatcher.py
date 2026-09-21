"""Public recovery solver checks for dispatcher constraints and aircraft feasibility."""

from copy import deepcopy
from unittest.mock import patch

import pytest
from ortools.sat.python import cp_model

from src.optimizer.milp import RecoveryOptimizer


def network():
    return dict(
        schedule=[
            dict(
                id="F1",
                aircraft_id="A1",
                origin="KORD",
                destination="KATL",
                scheduled_departure="2026-09-20T12:00:00Z",
                scheduled_arrival="2026-09-20T14:00:00Z",
                passengers=100,
            )
        ],
        aircraft=[
            dict(id=tail, type="B738", seats=160, min_turn_minutes=30, base_airport_id="KORD")
            for tail in ("A1", "A2")
        ],
        crews=[],
        events=[dict(type="aircraft_grounded", aircraft_tail="A1")],
        disrupted_flights=["F1"],
        cascade_predictions={"F1": dict(cascade_order=0, expected_delay_min=10)},
    )


@pytest.mark.parametrize("fallback", [False, True])
@pytest.mark.parametrize("bad_spare", ["overlap", "location", "turnaround", "seats", "type"])
def test_unavailable_spare_is_never_assigned(fallback, bad_spare):
    data = network()
    spare = data["aircraft"][1]
    if bad_spare in ("overlap", "turnaround"):
        data["schedule"].append(
            dict(
                id="F2",
                aircraft_id="A2",
                origin="KATL",
                destination="KORD",
                passengers=100,
                scheduled_departure="2026-09-20T10:00:00Z",
                scheduled_arrival="2026-09-20T13:00:00Z"
                if bad_spare == "overlap"
                else "2026-09-20T12:00:00Z",
            )
        )
    elif bad_spare == "location":
        spare["base_airport_id"] = "KLAX"
    elif bad_spare == "seats":
        spare["seats"] = 50
    else:
        spare["type"] = "A320"
    if fallback:
        with (
            patch.object(cp_model.CpSolver, "solve", return_value=cp_model.UNKNOWN),
            patch.object(cp_model.CpSolver, "status_name", return_value="UNKNOWN"),
        ):
            plans = RecoveryOptimizer().solve(**data)
    else:
        plans = RecoveryOptimizer(deterministic=True).solve(**data)
    for plan in plans:
        assert plan.cancelled_flights == ["F1"]
        assert plan.aircraft_swaps == []


@pytest.mark.parametrize("fallback", [False, True])
def test_dispatcher_locks_enforce_assignment_delay_and_cancellation(fallback):
    data = network()
    data["schedule"].append({**data["schedule"][0], "id": "F2", "aircraft_id": "A3"})
    data["aircraft"].append({**data["aircraft"][0], "id": "A3"})
    before = deepcopy(data)
    locks = [
        {"flight_id": "F1", "aircraft_id": "A2", "delay_minutes": 45},
        {"flight_id": "F2", "cancel": True},
    ]

    def run():
        return RecoveryOptimizer(deterministic=True).solve(**data, decision_locks=locks)

    if fallback:
        with (
            patch.object(cp_model.CpSolver, "solve", return_value=cp_model.UNKNOWN),
            patch.object(cp_model.CpSolver, "status_name", return_value="UNKNOWN"),
        ):
            plans = run()
    else:
        plans = run()
    assert data == before
    for plan in plans:
        assert plan.cancelled_flights == ["F2"]
        assert plan.delayed_flights[0]["delay_minutes"] == 45
        assert plan.aircraft_swaps[0]["new_aircraft"] == "A2"


def test_impossible_assignment_lock_returns_infeasible_without_actions():
    data = network()
    data["aircraft"][1]["base_airport_id"] = "KLAX"
    plans = RecoveryOptimizer().solve(
        **data, decision_locks=[{"flight_id": "F1", "aircraft_id": "A2"}]
    )
    for plan in plans:
        assert plan.status == "infeasible"
        assert plan.cancelled_flights == plan.delayed_flights == plan.aircraft_swaps == []


@pytest.mark.parametrize(
    "locks",
    [
        [{"flight_id": "F1", "cancel": True, "delay_minutes": 5}],
        [{"flight_id": "F1", "delay_minutes": -1}],
        [{"flight_id": "F1", "delay_minutes": True}],
        [{"flight_id": "F1", "reroute": "KLAX"}],
        [{"flight_id": "absent", "cancel": True}],
        [{"flight_id": "F1", "aircraft_id": "absent"}],
        [{"flight_id": "F1", "cancel": "false"}],
        [{"flight_id": "F1", "cancel": True}, {"flight_id": "F1", "cancel": False}],
    ],
)
def test_invalid_dispatcher_locks_are_rejected(locks):
    with pytest.raises(ValueError):
        RecoveryOptimizer().solve(**network(), decision_locks=locks)


def test_assignment_lock_to_existing_tail_checks_its_rotation():
    data = network()
    data["events"] = []
    data["schedule"].append({**data["schedule"][0], "id": "F2"})
    plans = RecoveryOptimizer().solve(
        **data, decision_locks=[{"flight_id": "F1", "aircraft_id": "A1"}]
    )
    assert all(plan.status == "infeasible" for plan in plans)


def test_unknown_roster_is_not_reported_as_validated():
    plans = RecoveryOptimizer().solve(**network())
    for plan in plans:
        assert plan.validation["status"] == "unknown"
        assert plan.validation["crew"]["status"] == "unknown"


def test_uncertainty_rebuild_retains_dispatcher_delay_floor():
    from src.optimizer.uncertain import solve_with_uncertain_horizon

    data = network()
    data["events"] = []
    plans = solve_with_uncertain_horizon(
        RecoveryOptimizer(timeout_secs=2, deterministic=True),
        **data,
        horizon={"median_minutes": 45, "p95_minutes": 120},
        decision_locks=[{"flight_id": "F1", "cancel": False, "delay_minutes": 60}],
    )
    for plan in plans:
        assert plan.status != "infeasible"
        assert plan.delayed_flights[0]["delay_minutes"] >= 60
        assert plan.validation["status"] == "unknown"
        assert len(plan.uncertainty["scenarios"]) == 5


@pytest.mark.parametrize("fallback", [False, True])
def test_known_crew_failure_is_a_cancel_constraint(fallback):
    data = network()
    data["events"] = []
    data["crews"] = [
        {
            "flight_id": "F1",
            "captain_id": "C",
            "first_officer_id": "O",
            "duty_start": "2026-09-20T11:00:00Z",
            "flight_time_minutes": 120,
        }
    ]
    roster = [
        dict(id=cid, role=role, cert_types=["A320"])
        for cid, role in (("C", "captain"), ("O", "first_officer"))
    ]

    def run():
        return RecoveryOptimizer().solve(**data, crew_members=roster)

    if fallback:
        with (
            patch.object(cp_model.CpSolver, "solve", return_value=cp_model.UNKNOWN),
            patch.object(cp_model.CpSolver, "status_name", return_value="UNKNOWN"),
        ):
            plans = run()
    else:
        plans = run()
    for plan in plans:
        assert plan.status != "infeasible"
        assert plan.cancelled_flights == ["F1"]
        assert plan.crew_violations == 0
        assert plan.validation["crew"]["status"] == "pass"


@pytest.mark.parametrize("fallback", [False, True])
def test_delay_cannot_overlap_the_original_aircraft_next_rotation(fallback):
    data = network()
    data["events"] = []
    data["schedule"].append(
        {
            **data["schedule"][0],
            "id": "F2",
            "origin": "KATL",
            "destination": "KORD",
            "scheduled_departure": "2026-09-20T14:00:00Z",
            "scheduled_arrival": "2026-09-20T16:00:00Z",
        }
    )

    def run():
        return RecoveryOptimizer().solve(**data)

    if fallback:
        with (
            patch.object(cp_model.CpSolver, "solve", return_value=cp_model.UNKNOWN),
            patch.object(cp_model.CpSolver, "status_name", return_value="UNKNOWN"),
        ):
            plans = run()
    else:
        plans = run()
    # Keeping F1 overlaps F2; cancelling F1 strands the aircraft at KORD.
    assert all(plan.status == "infeasible" for plan in plans)
    assert all(not plan.cancelled_flights and not plan.delayed_flights for plan in plans)


def test_plan_c_fallback_does_not_assign_two_spares_to_one_flight():
    data = network()
    data["aircraft"].append({**data["aircraft"][1], "id": "A3"})
    data["schedule"].append(
        {
            **data["schedule"][0],
            "id": "F2",
            "origin": "KATL",
            "destination": "KORD",
            "scheduled_departure": "2026-09-20T16:00:00Z",
            "scheduled_arrival": "2026-09-20T18:00:00Z",
        }
    )
    data["disrupted_flights"].append("F2")
    data["cascade_predictions"] = {
        "F1": dict(cascade_order=1, expected_delay_min=130),
        "F2": dict(cascade_order=0, expected_delay_min=120),
    }
    with (
        patch.object(cp_model.CpSolver, "solve", return_value=cp_model.UNKNOWN),
        patch.object(cp_model.CpSolver, "status_name", return_value="UNKNOWN"),
    ):
        plan = RecoveryOptimizer().solve(**data)[2]
    assert plan.status == "heuristic"
    assert len(plan.aircraft_swaps) == 1


@pytest.mark.parametrize("fallback", [False, True])
def test_dispatcher_can_lock_a_disrupted_but_now_available_tail(fallback):
    data = network()
    data["aircraft"][1]["base_airport_id"] = "KLAX"
    data["schedule"].append(
        {
            **data["schedule"][0],
            "id": "F2",
            "aircraft_id": "A2",
            "origin": "KLAX",
            "destination": "KORD",
            "scheduled_departure": "2026-09-20T06:00:00Z",
            "scheduled_arrival": "2026-09-20T09:00:00Z",
        }
    )
    data["disrupted_flights"].append("F2")
    data["cascade_predictions"]["F2"] = dict(cascade_order=0, expected_delay_min=10)

    def run():
        return RecoveryOptimizer().solve(
            **data, decision_locks=[{"flight_id": "F1", "aircraft_id": "A2"}]
        )

    if fallback:
        with (
            patch.object(cp_model.CpSolver, "solve", return_value=cp_model.UNKNOWN),
            patch.object(cp_model.CpSolver, "status_name", return_value="UNKNOWN"),
        ):
            plans = run()
    else:
        plans = run()
    assert all(plan.status != "infeasible" for plan in plans)
    assert all(plan.aircraft_swaps[0]["new_aircraft"] == "A2" for plan in plans)


def test_uncertainty_prices_delays_that_rounded_to_zero_in_candidate():
    from src.optimizer.uncertain import _cost_under

    data = network()
    data["events"] = []
    data["cascade_predictions"]["F1"]["expected_delay_min"] = 0
    optimizer = RecoveryOptimizer()
    plan = optimizer.solve(**data)[0]
    assert not plan.delayed_flights
    cost = _cost_under(
        optimizer,
        plan,
        4,
        {"F1": data["schedule"][0]},
        "weather_closure",
        {"F1": "B738"},
        {"F1": dict(cascade_order=0, expected_delay_min=1)},
        [],
        [],
        None,
        data["aircraft"],
        [],
        ["F1"],
    )
    assert cost > 0
