"""Real child-worker regression at the owner-scoped run manager boundary."""

import asyncio
import copy
import time

import pytest

from src.services.run_manager import RunManager
from tests.test_joint_recovery_engine import AIRCRAFT, FLIGHTS


def wait(manager, run_id):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        row = manager.get("alice", run_id)
        if row["status"] in {"completed", "failed", "timed_out"}:
            assert row["status"] == "completed", row.get("error")
            return row
        time.sleep(0.05)
    raise AssertionError("Worker did not complete")


def test_child_locks_are_solved_and_parent_is_immutable(tmp_path):
    manager = RunManager(tmp_path / "runs.db")
    try:
        scenario = {
            "id": "sample",
            "name": "Sample",
            "config": {
                "schedule": FLIGHTS,
                "aircraft": AIRCRAFT,
                "crew_pairings": [],
                "crew_members": [],
                "disruptions": [],
                "constraints": {"solver_timeout_secs": 2},
            },
        }
        parent = manager.start("alice", scenario)
        wait(manager, parent["id"])
        original = copy.deepcopy(manager.get("alice", parent["id"], include_input=True))
        with pytest.raises(KeyError):
            manager.what_if("bob", parent["id"], [{"flight_id": "F1", "cancel": True}])
        with pytest.raises(ValueError):
            manager.what_if("alice", parent["id"], [{"flight_id": "F1", "destination": "KLAX"}])
        child = manager.what_if("alice", parent["id"], [{"flight_id": "F1", "cancel": True}])
        completed = wait(manager, child["id"])
        assert completed["parent_run_id"] == parent["id"]
        assert completed["parent_input_hash"] == original["input_hash"]
        comparison = completed["comparison"]
        assert comparison["basis"] == "modeled_child_minus_parent"
        assert len(comparison["plans"]) == 4
        assert all(row["total_cost_usd_delta"] > 0 for row in comparison["plans"])
        assert all("F1" in p["cancelled_flights"] for p in completed["result"]["recovery_plans"])
        applied = manager.apply("alice", child["id"], "A")
        assert applied["result"]["flight_states"]["F1"]["status"] == "cancelled"
        assert manager.get("alice", parent["id"], include_input=True) == original
        with pytest.raises(ValueError, match="Plan not found"):
            manager.apply("alice", child["id"], "missing")
        assert any(row["parent_run_id"] == parent["id"] for row in manager.history("alice"))
    finally:
        manager.close()


def test_what_if_route_requires_owner_and_rejects_unsupported_actions(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from src.routes.account import require_account
    from src.routes.runs import router

    monkeypatch.setenv("OLUS_ACCOUNT_DB", str(tmp_path / "accounts.db"))

    manager = RunManager(tmp_path / "routes.db")
    app = FastAPI()
    app.state.run_manager = manager
    app.include_router(router)
    try:
        scenario = {
            "id": "sample",
            "config": {
                "schedule": FLIGHTS,
                "aircraft": AIRCRAFT,
                "crew_pairings": [],
                "crew_members": [],
                "disruptions": [],
            },
        }
        parent = manager.start("alice", scenario)
        wait(manager, parent["id"])
        with TestClient(app) as client:
            url = f"/runs/{parent['id']}/what-if"
            body = {"decision_locks": [{"flight_id": "F1", "cancel": True}]}
            assert client.post(url, json=body).status_code == 401
            account = {"id": "bob"}
            app.dependency_overrides[require_account] = lambda: account
            assert client.post(url, json=body).status_code == 404
            account["id"] = "alice"
            assert (
                client.post(
                    url, json={"decision_locks": [{"flight_id": "F1", "reroute": "KORD"}]}
                ).status_code
                == 422
            )
            response = client.post(url, json=body)
            assert response.status_code == 202, response.text
            wait(manager, response.json()["id"])
    finally:
        manager.close()


def test_mixed_cause_shared_and_private_explanations_match_solved_money(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from src.optimizer.milp import RecoveryOptimizer
    from src.predictor.cascade import CascadePredictor
    from src.routes.account import require_account
    from src.routes.recovery import router as recovery_router
    from src.routes.runs import router as runs_router
    from src.simulator.engine import SimulationEngine
    from tests.test_joint_recovery_engine import Weather, closure

    events = [
        {
            "id": "aog",
            "kind": "mechanical_aog",
            "triggered_at": "2024-01-15T12:00:00Z",
            "params": {"aircraft_tail": "T2", "duration_hours": 24, "location_airport": "KDFW"},
        },
        closure("ord", "KORD"),
    ]
    manager = RunManager(tmp_path / "money.db")
    engine = SimulationEngine(FLIGHTS, AIRCRAFT, [], crew_members=[])
    predictor, optimizer, weather = (
        CascadePredictor(),
        RecoveryOptimizer(timeout_secs=2, deterministic=True),
        Weather(),
    )
    try:
        scenario = {
            "id": "mixed",
            "config": {
                "schedule": FLIGHTS,
                "aircraft": AIRCRAFT,
                "crew_pairings": [],
                "crew_members": [],
                "disruptions": events,
                "constraints": {"solver_timeout_secs": 2},
            },
        }
        run = manager.start("alice", scenario)
        complete = wait(manager, run["id"])
        for event in events:
            asyncio.run(engine.trigger_event(event, predictor, optimizer, weather))
        app = FastAPI()
        app.state.engine, app.state.run_manager = engine, manager
        app.include_router(recovery_router)
        app.include_router(runs_router)
        app.dependency_overrides[require_account] = lambda: {"id": "alice"}
        with TestClient(app) as client:
            shared = client.post("/recovery/explain", json={"plan_id": "A"})
            private = client.post(f"/runs/{run['id']}/explain", json={"plan_id": "A"})
            assert shared.status_code == private.status_code == 200
            solved = complete["result"]["recovery_plans"][0]["total_cost_usd"]
            assert shared.json()["base_cost_usd"] == private.json()["base_cost_usd"] == solved
    finally:
        manager.close()
