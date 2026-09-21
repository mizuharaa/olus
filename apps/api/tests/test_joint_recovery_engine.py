"""Public engine regressions for joint disruptions and safe plan application."""

import asyncio
import copy

import pytest

from src.optimizer.milp import RecoveryOptimizer
from src.predictor.cascade import CascadePredictor
from src.simulator.engine import SimulationEngine

FLIGHTS = [
    {
        "id": "F1",
        "aircraft_id": "T1",
        "origin": "KDEN",
        "destination": "KORD",
        "scheduled_departure": "2024-01-15T13:00:00Z",
        "scheduled_arrival": "2024-01-15T15:00:00Z",
        "passengers": 100,
    },
    {
        "id": "F2",
        "aircraft_id": "T2",
        "origin": "KDFW",
        "destination": "KLAX",
        "scheduled_departure": "2024-01-15T13:00:00Z",
        "scheduled_arrival": "2024-01-15T15:00:00Z",
        "passengers": 100,
    },
]
AIRCRAFT = [
    {
        "id": "T1",
        "type": "B737-800",
        "base_airport_id": "KDEN",
        "seats": 162,
        "min_turn_minutes": 45,
    },
    {
        "id": "T2",
        "type": "B737-800",
        "base_airport_id": "KDFW",
        "seats": 162,
        "min_turn_minutes": 45,
    },
]


class Weather:
    def get_all_cached(self):
        return {}


def closure(id, airport):
    return {
        "id": id,
        "kind": "weather_closure",
        "triggered_at": "2024-01-15T12:00:00Z",
        "params": {
            "airport": airport,
            "start": "T+0h",
            "end": "T+24h",
            "duration_hours": 24,
            "severity": "extreme",
        },
    }


def test_joint_disruptions_and_cancellation_recompute_the_full_network():
    async def scenario():
        engine = SimulationEngine(FLIGHTS, AIRCRAFT, [])
        predictor, optimizer, weather = (
            CascadePredictor(),
            RecoveryOptimizer(timeout_secs=2, deterministic=True),
            Weather(),
        )
        await engine.trigger_event(closure("ord", "KORD"), predictor, optimizer, weather)
        update = await engine.trigger_event(closure("lax", "KLAX"), predictor, optimizer, weather)
        assert update["cascade_summary"]["total_affected"] == 2
        assert all(row["status"] == "delayed" for row in update["flight_states"].values())
        assert update["cascade_summary"]["composition"] == "simultaneous_max_delay"
        await engine.apply_plan("A")
        assert engine.state.cascade_summary["composition"] == "simultaneous_max_delay"
        await engine.unapply_plan()
        assert all(
            set(plan["cancelled_flights"]) | {row["flight_id"] for row in plan["delayed_flights"]}
            == {"F1", "F2"}
            for plan in update["recovery_plans"]
        )
        assert await engine.cancel_event("lax")
        state = engine.to_state_dict()
        assert state["flight_states"]["F2"]["status"] == "scheduled"
        assert state["flight_states"]["F1"]["delay_minutes"] > 0
        assert state["cascade_summary"]["total_affected"] == 1
        assert all(
            set(plan["cancelled_flights"]) | {row["flight_id"] for row in plan["delayed_flights"]}
            == {"F1"}
            for plan in state["recovery_plans"]
        )
        assert await engine.cancel_event("ord")
        assert not engine.to_state_dict()["recovery_plans"]
        assert all(row["status"] == "scheduled" for row in engine.get_schedule_snapshot())

    asyncio.run(scenario())


@pytest.mark.parametrize("kind", ["crew_sickout", "labor_action"])
def test_crew_overbooking_uses_normalized_percentage(kind):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from src.events.catalog import normalize_event_params
    from src.routes.recovery import router

    pairings = [
        {"id": "P1", "flight_id": "F1", "captain_id": "C1"},
        {"id": "P2", "flight_id": "F2", "captain_id": "C2"},
    ]
    members = [{"id": "C1", "role": "captain"}, {"id": "C2", "role": "captain"}]
    engine = SimulationEngine(FLIGHTS, AIRCRAFT, pairings, crew_members=members)
    for state in engine.state.flight_states.values():
        state["cascade_order"] = 0
    app = FastAPI()
    app.state.engine = engine
    app.include_router(router)
    with TestClient(app) as client:
        for percent, expected in [(0, 0), (100, 2)]:
            engine.state.active_events = [
                {
                    "kind": kind,
                    "params": normalize_event_params(kind, {"percent_affected": percent}),
                }
            ]
            response = client.post("/recovery/crew-overbooking")
            assert response.status_code == 200, response.text
            assert response.json()["total_open_flights"] == expected


def test_apply_rejects_stale_inputs_without_changing_state():
    async def scenario():
        engine = SimulationEngine(FLIGHTS, AIRCRAFT, [])
        await engine.trigger_event(
            closure("ord", "KORD"),
            CascadePredictor(),
            RecoveryOptimizer(timeout_secs=2, deterministic=True),
            Weather(),
        )
        engine.state.active_events[0]["params"]["airport"] = "KLAX"
        before = copy.deepcopy(engine.to_state_dict())
        with pytest.raises(RuntimeError, match="stale"):
            await engine.apply_plan("A")
        assert engine.to_state_dict() == before

    asyncio.run(scenario())


def test_public_resolve_and_restored_cancel_keep_all_active_constraints():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from src.routes.recovery import router

    engine = SimulationEngine(FLIGHTS, AIRCRAFT, [])
    predictor, optimizer, weather = (
        CascadePredictor(),
        RecoveryOptimizer(timeout_secs=2, deterministic=True),
        Weather(),
    )
    asyncio.run(engine.trigger_event(closure("ord", "KORD"), predictor, optimizer, weather))
    asyncio.run(engine.trigger_event(closure("lax", "KLAX"), predictor, optimizer, weather))
    restored = SimulationEngine(FLIGHTS, AIRCRAFT, [])
    restored._restore_state_dict(copy.deepcopy(engine.to_state_dict()))
    assert asyncio.run(restored.cancel_event("lax", predictor, optimizer, weather))
    assert restored.state.flight_states["F2"]["status"] == "scheduled"
    app = FastAPI()
    app.include_router(router)
    app.state.engine, app.state.predictor, app.state.optimizer, app.state.weather = (
        engine,
        predictor,
        optimizer,
        weather,
    )
    with TestClient(app) as client:
        assert client.post("/recovery/solve", json={"event_ids": ["ord"]}).status_code == 422
        response = client.post("/recovery/solve", json={})
        assert response.status_code == 200, response.text
        assert response.json()["cascade_summary"]["total_affected"] == 2
        assert client.get("/recovery/plans").json()["plans"] == response.json()["plans"]
        assert client.post("/recovery/apply", json={"plan_id": "missing"}).status_code == 404
        engine.state.active_events[0]["params"]["airport"] = "KDEN"
        before = copy.deepcopy(engine.to_state_dict())
        assert client.post("/recovery/apply", json={"plan_id": "A"}).status_code == 409
        assert engine.to_state_dict() == before


def test_cancellation_is_replayed_from_persisted_event_stream(tmp_path):
    from src.replay import replay_scenario
    from src.store.repository import ScenarioRepository

    repo = ScenarioRepository(tmp_path / "replay.db")
    engine = SimulationEngine(FLIGHTS, AIRCRAFT, [], repository=repo)
    predictor, optimizer, weather = (
        CascadePredictor(),
        RecoveryOptimizer(timeout_secs=2, deterministic=True),
        Weather(),
    )

    async def scenario():
        await engine.trigger_event(closure("ord", "KORD"), predictor, optimizer, weather)
        await engine.trigger_event(closure("lax", "KLAX"), predictor, optimizer, weather)
        await engine.cancel_event("lax")
        replayed = await replay_scenario(
            engine.scenario_id, repo, schedule=FLIGHTS, aircraft=AIRCRAFT, crews=[]
        )
        for plan in replayed:
            assert "F2" not in plan["cancelled_flights"]
            assert "F2" not in {row["flight_id"] for row in plan["delayed_flights"]}
        await engine.cancel_event("ord")
        assert (
            await replay_scenario(
                engine.scenario_id, repo, schedule=FLIGHTS, aircraft=AIRCRAFT, crews=[]
            )
            == []
        )

    asyncio.run(scenario())


def test_joint_uncertain_events_do_not_report_fabricated_cost_bands():
    async def scenario():
        engine = SimulationEngine(FLIGHTS, AIRCRAFT, [])
        predictor, optimizer, weather = (
            CascadePredictor(),
            RecoveryOptimizer(timeout_secs=2, deterministic=True),
            Weather(),
        )
        drone = {
            "id": "drone",
            "kind": "drone_incursion",
            "triggered_at": "2024-01-15T12:00:00Z",
            "params": {"airport": "KORD", "severity": "high"},
        }
        await engine.trigger_event(drone, predictor, optimizer, weather)
        update = await engine.trigger_event(closure("lax", "KLAX"), predictor, optimizer, weather)
        assert update["cascade_summary"]["uncertainty_evaluation"] == "not_evaluated_joint_events"
        assert all(not plan.get("uncertainty") for plan in update["recovery_plans"])

    asyncio.run(scenario())
