"""Plan status must be checked before mutating either simulation apply path."""

import asyncio
from copy import deepcopy

import pytest

from src.simulator.engine import SimulationEngine


@pytest.mark.parametrize("status", ["infeasible", "unknown", "error", None, ""])
def test_rejects_unusable_plan_without_reverting_existing_plan(status):
    engine = SimulationEngine([], [], [])
    engine.state.applied_plan_id = "A"
    engine.state.flight_states = {"F1": {"status": "cancelled"}}
    engine.state.flight_states_pre_apply = {"F1": {"status": "scheduled"}}
    engine.state.recovery_plans = [{"plan_id": "B", "status": status}]
    before = deepcopy(engine.to_state_dict())

    with pytest.raises(ValueError, match="cannot be applied"):
        asyncio.run(engine.apply_plan("B"))

    assert engine.to_state_dict() == before


@pytest.mark.parametrize("status", ["optimal", "feasible", "heuristic"])
def test_existing_simulation_plan_statuses_still_apply_and_revert(status):
    engine = SimulationEngine([], [], [])
    engine.state.flight_states = {"F1": {"status": "scheduled", "delay_minutes": 0}}
    before = deepcopy(engine.state.flight_states)
    engine.state.recovery_plans = [{"plan_id": "A", "status": status, "cancelled_flights": ["F1"]}]

    asyncio.run(engine.apply_plan("A"))
    assert engine.state.applied_plan_id == "A"
    assert engine.state.flight_states["F1"]["status"] == "cancelled"
    asyncio.run(engine.unapply_plan())
    assert engine.state.flight_states == before
    assert engine.state.applied_plan_id is None
