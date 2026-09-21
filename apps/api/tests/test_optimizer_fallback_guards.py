"""Safety guards when the external solver returns no feasible solution."""

from unittest.mock import patch

from ortools.sat.python import cp_model

from src.optimizer.milp import RecoveryOptimizer


def test_fallback_cancels_grounded_flight_without_a_spare():
    flight = {
        "id": "F1",
        "aircraft_id": "A1",
        "scheduled_departure": "2026-09-20T12:00:00Z",
        "scheduled_arrival": "2026-09-20T13:00:00Z",
        "passengers": 100,
    }
    with (
        patch.object(cp_model.CpSolver, "solve", return_value=cp_model.UNKNOWN),
        patch.object(cp_model.CpSolver, "status_name", return_value="UNKNOWN"),
    ):
        plans = RecoveryOptimizer().solve(
            schedule=[flight],
            aircraft=[{"id": "A1", "type": "B738"}],
            crews=[],
            events=[{"type": "aircraft_grounded", "aircraft_tail": "A1"}],
            disrupted_flights=["F1"],
            cascade_predictions={"F1": {"cascade_order": 0, "expected_delay_min": 10}},
        )

    assert len(plans) == 4
    for plan in plans:
        assert plan.status == "heuristic"
        assert plan.cancelled_flights == ["F1"]
        assert plan.delayed_flights == []
        assert plan.aircraft_swaps == []


def test_disabled_fallback_returns_no_actions_when_solver_has_no_solution():
    with (
        patch.object(cp_model.CpSolver, "solve", return_value=cp_model.UNKNOWN),
        patch.object(cp_model.CpSolver, "status_name", return_value="UNKNOWN"),
    ):
        plans = RecoveryOptimizer(use_fallback=False).solve(
            schedule=[{"id": "F1", "aircraft_id": "A1", "passengers": 100}],
            aircraft=[{"id": "A1", "type": "B738"}],
            crews=[],
            events=[{"type": "aircraft_grounded", "aircraft_tail": "A1"}],
            disrupted_flights=["F1"],
            cascade_predictions={"F1": {"cascade_order": 0, "expected_delay_min": 10}},
        )

    assert len(plans) == 4
    for plan in plans:
        assert plan.status == "infeasible"
        assert plan.cancelled_flights == []
        assert plan.delayed_flights == []
        assert plan.aircraft_swaps == []
