"""The release smoke check must distinguish old healthy images from this API."""

from contextlib import closing

from fastapi.testclient import TestClient

from src.main import agent, app, settings
from src.network import cache
from src.store.accounts import provision
from src.store.scenario_workspaces import ScenarioWorkspaceRepository


def test_release_revision_and_private_routes(monkeypatch, tmp_path):
    monkeypatch.setenv("BUILD_SHA", "checked-revision")
    monkeypatch.setenv("OLUS_ACCOUNT_DB", str(tmp_path / "accounts.sqlite3"))
    monkeypatch.setattr(
        app.state,
        "scenario_workspace_repository",
        ScenarioWorkspaceRepository(tmp_path / "workspaces.db"),
        raising=False,
    )
    with closing(TestClient(app, base_url="https://testserver")) as client:
        assert client.get("/health").json()["revision"] == "checked-revision"
        for route in ("account/session", "scenario-workspaces", "runs/missing", "benchmarks"):
            assert client.get(f"/api/v1/{route}").status_code == 401
        provision("release@example.test", "release-check-password")
        client.post(
            "/api/v1/account/login",
            json={"email": "release@example.test", "password": "release-check-password"},
        )
        assert (
            client.get("/api/v1/scenario-workspaces/missing").json()["detail"]
            == "Scenario not found"
        )
        assert client.get("/api/v1/nonexistent").json()["error"] == "route_not_found"
        session = client.get("/api/v1/account/session").json()
        monkeypatch.setattr(cache, "get_crew_pairings", lambda: [])
        response = client.post(
            "/api/v1/scenario-workspaces",
            json={"name": "Unavailable starter"},
            headers={"X-CSRF-Token": session["csrf_token"]},
        )
        assert response.status_code == 503
        assert client.get("/api/v1/scenario-workspaces").json()["scenarios"] == []


def test_public_demo_rejects_excess_work_before_mutating_state(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(agent, "_take_token", lambda key: (False, 6))
    with closing(TestClient(app)) as client:
        for path in (
            "simulator/reset",
            "events/trigger",
            "recovery/solve",
            "network/stress-test",
            "playtest/cascade",
            "predict/cascade",
        ):
            response = client.post(f"/api/v1/{path}", json={})
            assert response.status_code == 429
            assert response.headers["Retry-After"] == "7"
        assert client.get("/health").status_code == 200
        monkeypatch.setattr(app.state, "public_demo_busy", True, raising=False)
        assert client.post("/api/v1/simulator/reset").headers["Retry-After"] == "5"
