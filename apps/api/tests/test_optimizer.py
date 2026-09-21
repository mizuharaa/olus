"""Tests for the MILP recovery optimizer."""

import pytest

from src.optimizer.milp import RecoveryOptimizer

FLIGHTS = [
    {
        "id": "NB101",
        "aircraft_id": "N001NB",
        "origin": "KORD",
        "destination": "KATL",
        "scheduled_departure": "2024-01-15T13:00:00Z",
        "scheduled_arrival": "2024-01-15T15:30:00Z",
        "passengers": 148,
    },
    {
        "id": "NB102",
        "aircraft_id": "N001NB",
        "origin": "KATL",
        "destination": "KMIA",
        "scheduled_departure": "2024-01-15T16:30:00Z",
        "scheduled_arrival": "2024-01-15T17:45:00Z",
        "passengers": 135,
    },
    {
        "id": "NB103",
        "aircraft_id": "N002NB",
        "origin": "KORD",
        "destination": "KDFW",
        "scheduled_departure": "2024-01-15T14:00:00Z",
        "scheduled_arrival": "2024-01-15T16:40:00Z",
        "passengers": 150,
    },
]

AIRCRAFT = [
    {
        "id": "N001NB",
        "type": "B737-800",
        "base_airport_id": "KORD",
        "seats": 162,
        "min_turn_minutes": 45,
    },
    {
        "id": "N002NB",
        "type": "B737-800",
        "base_airport_id": "KORD",
        "seats": 162,
        "min_turn_minutes": 45,
    },
]

CREWS = [
    {
        "id": "CP001",
        "flight_id": "NB101",
        "captain_id": "CAP001",
        "first_officer_id": "FO001",
        "duty_start": "2024-01-15T12:00:00Z",
        "flight_time_minutes": 150,
        "status": "assigned",
    },
]

PREDICTIONS = {
    "NB101": {"p_delayed": 0.9, "expected_delay_min": 90, "cascade_order": 0},
    "NB102": {"p_delayed": 0.7, "expected_delay_min": 60, "cascade_order": 1},
    "NB103": {"p_delayed": 0.3, "expected_delay_min": 20, "cascade_order": 2},
}


@pytest.fixture
def optimizer():
    return RecoveryOptimizer(timeout_secs=10, use_fallback=True)


class TestOptimizerOutputs:
    def test_returns_four_plans(self, optimizer):
        # Slice 4 added Plan D — Green Recovery. The optimizer now produces
        # four differentiated strategies instead of the original three.
        plans = optimizer.solve(
            schedule=FLIGHTS,
            aircraft=AIRCRAFT,
            crews=CREWS,
            events=[],
            disrupted_flights=["NB101"],
            cascade_predictions=PREDICTIONS,
        )
        assert len(plans) == 4

    def test_plan_ids_are_abcd(self, optimizer):
        plans = optimizer.solve(
            schedule=FLIGHTS,
            aircraft=AIRCRAFT,
            crews=CREWS,
            events=[],
            disrupted_flights=["NB101"],
            cascade_predictions=PREDICTIONS,
        )
        ids = {p.plan_id for p in plans}
        assert ids == {"A", "B", "C", "D"}

    def test_plans_have_objective_labels(self, optimizer):
        plans = optimizer.solve(
            schedule=FLIGHTS,
            aircraft=AIRCRAFT,
            crews=CREWS,
            events=[],
            disrupted_flights=["NB101"],
            cascade_predictions=PREDICTIONS,
        )
        for p in plans:
            assert p.objective_label
            assert len(p.objective_label) > 0

    def test_plans_have_valid_status(self, optimizer):
        plans = optimizer.solve(
            schedule=FLIGHTS,
            aircraft=AIRCRAFT,
            crews=CREWS,
            events=[],
            disrupted_flights=["NB101"],
            cascade_predictions=PREDICTIONS,
        )
        valid_statuses = {"optimal", "feasible", "heuristic", "infeasible"}
        for p in plans:
            assert p.status in valid_statuses

    def test_cost_is_non_negative(self, optimizer):
        plans = optimizer.solve(
            schedule=FLIGHTS,
            aircraft=AIRCRAFT,
            crews=CREWS,
            events=[],
            disrupted_flights=["NB101"],
            cascade_predictions=PREDICTIONS,
        )
        for p in plans:
            assert p.total_cost_usd >= 0

    def test_cancelled_flights_are_subset(self, optimizer):
        plans = optimizer.solve(
            schedule=FLIGHTS,
            aircraft=AIRCRAFT,
            crews=CREWS,
            events=[],
            disrupted_flights=["NB101"],
            cascade_predictions=PREDICTIONS,
        )
        flight_ids = {f["id"] for f in FLIGHTS}
        for p in plans:
            for fid in p.cancelled_flights:
                assert fid in flight_ids

    def test_plan_a_is_cost_focused(self, optimizer):
        """Plan A (minimize cost) should have alpha weight = 10."""
        weights = optimizer.PLAN_WEIGHTS["A"]
        assert weights["alpha"] >= weights["beta"]
        assert weights["alpha"] >= weights["gamma"]

    def test_plan_b_is_passenger_focused(self, optimizer):
        weights = optimizer.PLAN_WEIGHTS["B"]
        assert weights["beta"] >= weights["alpha"]

    def test_plan_c_is_positioning_focused(self, optimizer):
        weights = optimizer.PLAN_WEIGHTS["C"]
        assert weights["delta"] >= weights["alpha"]


class TestHeuristicFallback:
    """Integration checks for the heuristic planner (replaces removed _greedy_fallback API)."""

    def test_fallback_produces_plan(self, optimizer):
        # Preserve a feasible rotation after NB101's 90-minute shift. The
        # previous fixture left only 30 minutes against a 45-minute turn.
        predictions = {fid: dict(row) for fid, row in PREDICTIONS.items()}
        predictions["NB102"]["expected_delay_min"] = 90
        plans = optimizer.solve(
            schedule=FLIGHTS,
            aircraft=AIRCRAFT,
            crews=CREWS,
            events=[],
            disrupted_flights=["NB101", "NB102"],
            cascade_predictions=predictions,
        )
        plan_a = next(p for p in plans if p.plan_id == "A")
        # CP-SAT may finish within budget on CI hardware (status "optimal");
        # This coherent input also permits a feasible heuristic result.
        assert plan_a.status in {"heuristic", "optimal", "feasible"}
        assert plan_a.plan_id == "A"

    def test_fallback_cancels_high_delay_flights(self, optimizer):
        high_delay_predictions = {
            "NB101": {"p_delayed": 0.95, "expected_delay_min": 500, "cascade_order": 0},
            "NB102": {"p_delayed": 0.7, "expected_delay_min": 60, "cascade_order": 1},
            "NB103": {"p_delayed": 0.3, "expected_delay_min": 20, "cascade_order": 2},
        }
        plans = optimizer.solve(
            # Isolate the cancellation threshold: cancelling NB101 in the
            # full fixture would strand its next rotation at KATL.
            schedule=[FLIGHTS[0]],
            aircraft=AIRCRAFT,
            crews=CREWS,
            events=[],
            disrupted_flights=["NB101"],
            cascade_predictions=high_delay_predictions,
        )
        plan_a = next(p for p in plans if p.plan_id == "A")
        assert "NB101" in plan_a.cancelled_flights
