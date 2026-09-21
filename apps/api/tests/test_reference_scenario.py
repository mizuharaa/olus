"""The default editable draft must start from a consistent fictional network."""

from src.network.reference_scenario import reference_scenario
from src.optimizer.milp import RecoveryOptimizer
from src.routes.scenario_workspaces import ScenarioConfig


def test_reference_network_validates_and_solves_without_known_violations():
    data = ScenarioConfig(**reference_scenario()).model_dump()
    plans = RecoveryOptimizer(deterministic=True).solve(
        schedule=data["schedule"],
        aircraft=data["aircraft"],
        crews=data["crew_pairings"],
        crew_members=data["crew_members"],
        events=[],
        disrupted_flights=["DEMO1"],
        cascade_predictions={"DEMO1": {"expected_delay_min": 30, "cascade_order": 0}},
    )
    assert len(plans) == 4
    for plan in plans:
        assert plan.status != "infeasible", plan.validation
        assert plan.validation["status"] == "pass", plan.validation


def test_reference_factory_returns_independent_copies():
    first = reference_scenario()
    first["crew_members"][0]["cert_types"].clear()
    assert reference_scenario()["crew_members"][0]["cert_types"] == ["B737-800"]
