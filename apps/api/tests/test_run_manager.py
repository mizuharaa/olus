"""Real process/optimizer checks: python -m pytest tests/test_run_manager.py."""

import copy
import hashlib
import json
import time

import pytest

from src.network import cache
from src.services.crew_audit import audit_crew
from src.services.run_manager import RunManager


def scenario():
    return {
        "id": "scenario-one",
        "name": "Test scenario",
        "config": {
            "schedule": copy.deepcopy(cache.get_flights()),
            "aircraft": copy.deepcopy(cache.get_aircraft()),
            "crew_pairings": copy.deepcopy(cache.get_crew_pairings()),
            "crew_members": copy.deepcopy(cache.get_crew_members()),
            "constraints": {"solver_timeout_secs": 2},
            "disruptions": [
                {
                    "kind": "weather_closure",
                    "params": {
                        "airport": "KORD",
                        "start": "T+0h",
                        "end": "T+2h",
                        "severity": "severe",
                    },
                }
            ],
        },
    }


def wait(manager, owner, id):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        row = manager.get(owner, id)
        if row["status"] in ("completed", "failed", "cancelled", "timed_out"):
            return row
        time.sleep(0.05)
    raise AssertionError("Run did not finish")


def test_real_run_progress_private_apply_and_history(tmp_path):
    path = tmp_path / "runs.db"
    manager = RunManager(path)
    try:
        fixture = scenario()
        # Use a schedulable rotation; the demo network contains overlapping crew duties.
        fixture["config"]["schedule"] = fixture["config"]["schedule"][:1]
        fid = fixture["config"]["schedule"][0]["id"]
        fixture["config"]["crew_pairings"] = [
            p for p in fixture["config"]["crew_pairings"] if p["flight_id"] == fid
        ]
        original = copy.deepcopy(fixture)
        run = manager.start("owner", fixture)
        expected_input = manager.get("owner", run["id"], include_input=True)["input"]
        assert (
            run["input_hash"]
            == hashlib.sha256(
                json.dumps(expected_input, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
        )
        with pytest.raises(KeyError):
            manager.get("different-owner", run["id"])
        complete = wait(manager, "owner", run["id"])
        assert complete["status"] == "completed", complete.get("error")
        assert fixture == original, "Worker must not mutate caller scenario"
        assert len(complete["result"]["recovery_plans"]) == 4
        assert any(e["type"] == "incumbent" for e in complete["events"])
        assert all(
            e["constraints_satisfied"] >= 0 for e in complete["events"] if e["type"] == "incumbent"
        )
        baseline = copy.deepcopy(complete["result"]["flight_states"])
        applied = manager.apply("owner", run["id"], "A")
        assert applied["result"]["applied_plan_id"] == "A"
        unapplied = manager.apply("owner", run["id"], None)
        assert unapplied["result"]["applied_plan_id"] is None
        assert unapplied["result"]["flight_states"] == baseline
        assert manager.history("different-owner") == []
        assert len(manager.history("owner")) == 1
    finally:
        manager.close()
    reopened = RunManager(path)
    try:
        assert reopened.get("owner", run["id"])["status"] == "completed"
    finally:
        reopened.close()


def test_cancel_terminates_process_and_preserves_terminal_state(tmp_path):
    manager = RunManager(tmp_path / "runs.db")
    try:
        run = manager.start("owner", scenario())
        process = manager.workers[run["id"]][0]
        result = manager.cancel("owner", run["id"])
        assert result["status"] == "cancelled"
        assert not process.is_alive()
        time.sleep(0.3)
        assert manager.get("owner", run["id"])["status"] == "cancelled"
        assert manager.get("owner", run["id"])["result"] is None
    finally:
        manager.close()


def test_crew_audit_uses_members_and_marks_missing_inputs_unknown():
    data = scenario()["config"]
    data["recovery_plans"] = []
    audit = audit_crew(data)
    assert audit["rows"]
    assert all(r["crew_id"].startswith(("CA", "FO")) for r in audit["rows"])
    assert any(r["rule"] == "modeled-rest" and r["status"] == "unknown" for r in audit["rows"])
    row = next(r for r in audit["rows"] if r["crew_id"] == "CA01" and r["rule"] == "modeled-fdp-7d")
    assert row["value"] is None, "Legacy flight-hours history is not FDP history"
    assert row["status"] == "unknown"
    assert row["limit"] == 60 * 60


def test_spawn_failure_is_terminal_and_releases_capacity(tmp_path, monkeypatch):
    from multiprocessing.process import BaseProcess

    def fail_start(self):
        raise OSError("spawn unavailable")

    monkeypatch.setattr(BaseProcess, "start", fail_start)
    manager = RunManager(tmp_path / "runs.db")
    try:
        with pytest.raises(RuntimeError, match="could not start"):
            manager.start("owner", scenario())
        rows = manager.history("owner")
        assert len(rows) == 1
        assert rows[0]["status"] == "failed"
        assert manager.workers == {}
    finally:
        manager.close()
