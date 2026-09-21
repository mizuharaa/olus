"""Drone incursion (event #11) and the uncertain-horizon solver."""

from datetime import datetime

import pytest

from src.events.base import EventKind
from src.events.catalog import normalize_event_params
from src.events.drone_incursion import DroneIncursionEvent, fold_into_incident
from src.events.registry import create_event
from src.optimizer.milp import RecoveryOptimizer
from src.optimizer.uncertain import (
    duration_scenarios,
    horizon_from_constraints,
    solve_with_uncertain_horizon,
)
from src.simulator.engine import SimulationEngine
from tests.test_events import SAMPLE_SCHEDULE, _make_event

NOW = datetime(2024, 1, 15, 12, 0, 0)


class TestDroneIncursionEvent:
    def test_kind(self):
        ev = _make_event(DroneIncursionEvent, {"airport": "KORD"})
        assert ev.kind == EventKind.DRONE_INCURSION

    def test_duration_is_a_distribution_not_a_fixed_value(self):
        ev = _make_event(
            DroneIncursionEvent,
            {"airport": "KORD", "detection": "radar", "median_minutes": 45, "p95_minutes": 180},
        )
        dist = ev.duration_distribution()
        assert dist["kind"] == "lognormal"
        assert dist["median_minutes"] == 45
        assert dist["p95_minutes"] == 180
        # The point estimate everything else consumes is the median.
        assert ev.duration().total_seconds() == 45 * 60

    def test_pilot_report_clears_faster_than_radar(self):
        base = {"airport": "KORD", "median_minutes": 60, "p95_minutes": 180}
        pilot = _make_event(DroneIncursionEvent, {**base, "detection": "pilot_report"})
        radar = _make_event(DroneIncursionEvent, {**base, "detection": "radar"})
        assert pilot.duration() < radar.duration()

    def test_affects_flights_at_the_airport(self):
        ev = _make_event(DroneIncursionEvent, {"airport": "KORD", "median_minutes": 120})
        ids = [f["id"] for f in ev.affected_flights(SAMPLE_SCHEDULE)]
        assert "NB101" in ids and "NB103" in ids
        assert "NB104" not in ids  # KDFW → KLAX never touches KORD

    def test_constraints_carry_the_distribution_and_no_end(self):
        ev = _make_event(DroneIncursionEvent, {"airport": "KORD"})
        constraint = ev.constraints()[0]
        assert constraint["type"] == "capacity_reduced"
        assert "end" not in constraint
        assert constraint["duration_dist"]["median_minutes"] > 0

    def test_catalog_keeps_duration_hours_in_sync_with_the_median(self):
        params = normalize_event_params(
            "drone_incursion", {"detection": "radar", "median_minutes": 90}
        )
        assert params["duration_hours"] == pytest.approx(1.5)

    def test_catalog_rejects_an_impossible_distribution(self):
        with pytest.raises(ValueError, match="p95_minutes"):
            normalize_event_params("drone_incursion", {"median_minutes": 120, "p95_minutes": 60})

    def test_factory_builds_it(self):
        event = create_event("drone_incursion", {"airport": "kden"})
        assert event.kind.value == "drone_incursion"
        assert event.params["airport"] == "KDEN"


class TestIncidentFolding:
    """Real incursions reopen and re-close — that is one incident, not two."""

    def _event(self, **params):
        return {
            "id": "evt-1",
            "kind": "drone_incursion",
            "triggered_at": NOW.isoformat(),
            "params": normalize_event_params("drone_incursion", {"airport": "KDEN", **params}),
        }

    def test_no_incident_id_means_independent_events(self):
        active = [self._event()]
        assert fold_into_incident(active, self._event()) is None

    def test_reclosure_folds_into_the_incident(self):
        first = self._event(incident_id="INC-1", median_minutes=60, p95_minutes=120)
        second = {**self._event(incident_id="INC-1", median_minutes=60), "id": "evt-2"}

        folded = fold_into_incident([first], second)
        assert folded is not None
        index, merged = folded
        assert index == 0
        assert merged["id"] == "evt-1"  # keeps the incident's identity
        assert merged["params"]["reopen_count"] == 1
        assert len(merged["params"]["closures"]) == 2
        # Exposure accumulates instead of two independent 1-hour disruptions.
        assert merged["params"]["median_minutes"] == 120
        assert merged["params"]["duration_hours"] == pytest.approx(2.0)

    def test_different_incident_does_not_fold(self):
        first = self._event(incident_id="INC-1")
        other = self._event(incident_id="INC-2")
        assert fold_into_incident([first], other) is None

    @pytest.mark.asyncio
    async def test_engine_keeps_one_active_event_per_incident(self):
        engine = SimulationEngine(list(SAMPLE_SCHEDULE), [{"id": "N001NB"}, {"id": "N002NB"}], [])
        for _ in range(2):
            await engine.trigger_event(
                self._event(incident_id="INC-9", median_minutes=45),
                _Predictor(),
                # The real optimizer: a drone incursion routes through the
                # uncertain-horizon solver, and this asserts that path survives
                # a re-closure.
                RecoveryOptimizer(timeout_secs=2),
                _Weather(),
            )
        assert len(engine.state.active_events) == 1
        assert engine.state.active_events[0]["params"]["reopen_count"] == 1


class TestDurationScenarios:
    def test_quantiles_bracket_the_median_and_sum_to_one(self):
        scenarios = duration_scenarios(45, 180)
        assert len(scenarios) == 5
        assert sum(s["weight"] for s in scenarios) == pytest.approx(1.0)
        minutes = [s["minutes"] for s in scenarios]
        assert minutes == sorted(minutes)
        assert minutes[0] < 45 < minutes[-1]
        assert scenarios[2]["minutes"] == pytest.approx(45, abs=0.1)

    def test_horizon_only_found_on_events_with_unknown_duration(self):
        assert horizon_from_constraints([{"type": "airport_unavailable", "end": "T+4h"}]) is None
        found = horizon_from_constraints(
            [{"type": "capacity_reduced", "duration_dist": {"median_minutes": 45}}]
        )
        assert found == {"median_minutes": 45}


# ── Uncertain-horizon solve ──────────────────────────────────────────────────

FLIGHTS = [
    {
        "id": "NB201",
        "aircraft_id": "N001NB",
        "origin": "KDEN",
        "destination": "KATL",
        "scheduled_departure": "2024-01-15T13:00:00Z",
        "scheduled_arrival": "2024-01-15T15:30:00Z",
        "passengers": 160,
    },
    {
        "id": "NB202",
        # Independent tail keeps this uncertainty-ledger fixture feasible
        # when another candidate cancels NB201; no implicit ferry required.
        "aircraft_id": "N003NB",
        "origin": "KATL",
        "destination": "KMIA",
        "scheduled_departure": "2024-01-15T16:30:00Z",
        "scheduled_arrival": "2024-01-15T17:45:00Z",
        "passengers": 140,
    },
    {
        "id": "NB203",
        "aircraft_id": "N002NB",
        "origin": "KDEN",
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
        "base_airport_id": "KDEN",
        "seats": 162,
        "min_turn_minutes": 45,
    },
    {
        "id": "N002NB",
        "type": "B737-800",
        "base_airport_id": "KDEN",
        "seats": 162,
        "min_turn_minutes": 45,
    },
    {
        "id": "N003NB",
        "type": "B737-800",
        "base_airport_id": "KATL",
        "seats": 162,
        "min_turn_minutes": 45,
    },
]

PREDICTIONS = {
    "NB201": {"p_delayed": 0.9, "expected_delay_min": 95, "cascade_order": 0},
    "NB202": {"p_delayed": 0.7, "expected_delay_min": 60, "cascade_order": 1},
    "NB203": {"p_delayed": 0.8, "expected_delay_min": 80, "cascade_order": 0},
}

CONSTRAINTS = [
    {
        "type": "capacity_reduced",
        "kind": "drone_incursion",
        "airport": "KDEN",
        "duration_dist": {"kind": "lognormal", "median_minutes": 45, "p95_minutes": 180},
    }
]


@pytest.fixture
def uncertain_plans():
    optimizer = RecoveryOptimizer(timeout_secs=10, use_fallback=True)
    return solve_with_uncertain_horizon(
        optimizer,
        schedule=FLIGHTS,
        aircraft=AIRCRAFT,
        crews=[],
        events=CONSTRAINTS,
        disrupted_flights=["NB201", "NB202", "NB203"],
        cascade_predictions=PREDICTIONS,
        horizon=CONSTRAINTS[0]["duration_dist"],
    )


class TestUncertainHorizonSolve:
    def test_still_returns_the_four_objectives(self, uncertain_plans):
        assert {p.plan_id for p in uncertain_plans} == {"A", "B", "C", "D"}
        assert all(p.objective_label for p in uncertain_plans)
        assert all(
            p.status in {"optimal", "feasible", "heuristic", "infeasible"} for p in uncertain_plans
        )

    def test_every_plan_reports_expected_cost_and_regret(self, uncertain_plans):
        for plan in uncertain_plans:
            u = plan.uncertainty
            assert u is not None
            assert u["expected_cost_usd"] > 0
            assert u["cost_low_usd"] <= u["expected_cost_usd"] <= u["cost_high_usd"]
            assert len(u["scenarios"]) == 5
            assert u["median_minutes"] == 45 and u["p95_minutes"] == 180

    def test_regret_is_never_negative(self, uncertain_plans):
        """Regret is measured against perfect foresight, so it has a floor of 0."""
        for plan in uncertain_plans:
            u = plan.uncertainty
            assert u["expected_regret_usd"] >= -0.01
            assert u["max_regret_usd"] >= u["expected_regret_usd"] - 0.01
            assert all(s["regret_usd"] >= -0.01 for s in u["scenarios"])

    def test_cost_rises_with_closure_length(self, uncertain_plans):
        plan_a = next(p for p in uncertain_plans if p.plan_id == "A")
        costs = [s["cost_usd"] for s in plan_a.uncertainty["scenarios"]]
        assert costs == sorted(costs)

    def test_plans_are_serializable_for_the_wire(self, uncertain_plans):
        payload = uncertain_plans[0].to_dict()
        assert payload["uncertainty"]["max_regret_usd"] >= 0
        assert payload["plan_id"] in {"A", "B", "C", "D"}

    def test_known_duration_events_are_untouched(self):
        """The ordinary solver still runs when the horizon is known."""
        optimizer = RecoveryOptimizer(timeout_secs=10, use_fallback=True)
        plans = optimizer.solve(
            schedule=FLIGHTS,
            aircraft=AIRCRAFT,
            crews=[],
            events=[{"type": "airport_unavailable", "kind": "weather_closure"}],
            disrupted_flights=["NB201"],
            cascade_predictions=PREDICTIONS,
        )
        assert len(plans) == 4
        assert all(p.uncertainty is None for p in plans)


# ── Stubs shared with the engine test ────────────────────────────────────────


class _Weather:
    def get_all_cached(self):
        return {}


class _Predictor:
    def predict(self, *, flights, **_kwargs):
        return {
            f["id"]: {"p_delayed": 0.9, "expected_delay_min": 60, "cascade_order": 0}
            for f in flights
        }
