"""Runnable CRUD/ownership/validation check: python -m unittest tests.test_scenario_workspaces."""

import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.routes.account import require_account
from src.routes.scenario_workspaces import router
from src.store.scenario_workspaces import ScenarioWorkspaceRepository


class ScenarioWorkspaceTest(unittest.TestCase):
    def test_owned_persistent_revisioned_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "scenario-test.sqlite3"
            app = FastAPI()
            app.state.scenario_workspace_repository = ScenarioWorkspaceRepository(path)
            owner = {"id": "alice"}
            app.dependency_overrides[require_account] = lambda: owner
            app.include_router(router)
            with TestClient(app) as client:
                self.assertEqual(
                    client.post("/scenario-workspaces", json={"name": "  "}).status_code, 422
                )
                created = client.post("/scenario-workspaces", json={"name": "Crew test"})
                self.assertEqual(created.status_code, 201, created.text)
                scenario = created.json()
                url = "/scenario-workspaces/" + scenario["id"]
                config = scenario["config"]
                self.assertEqual(len(config["schedule"]), 2)
                config["schedule"][0]["passengers"] = 100
                config["constraints"]["solver_timeout_secs"] = 12
                config["disruptions"] = [
                    {
                        "kind": "weather_closure",
                        "params": {"airport": "KORD", "duration_hours": 2, "severity": "severe"},
                    }
                ]
                payload = {
                    "name": "Updated",
                    "revision": scenario["revision"],
                    "config": config,
                    "archived": False,
                }
                saved = client.post(url + "/save", json=payload)
                self.assertEqual(saved.status_code, 200, saved.text)
                self.assertEqual(saved.json()["config"]["schedule"][0]["passengers"], 100)
                self.assertEqual(client.post(url + "/save", json=payload).status_code, 409)
                self.assertEqual(
                    ScenarioWorkspaceRepository(path).get("alice", scenario["id"])["name"],
                    "Updated",
                )
                duplicate = client.post(url + "/duplicate").json()
                self.assertNotEqual(duplicate["id"], scenario["id"])
                self.assertEqual(duplicate["config"], saved.json()["config"])
                payload["revision"] = saved.json()["revision"]
                payload["archived"] = True
                archived = client.post(url + "/save", json=payload)
                self.assertTrue(archived.json()["archived"])
                payload["revision"] = archived.json()["revision"]
                config["schedule"][0]["aircraft_id"] = "NO_SUCH_TAIL"
                self.assertEqual(client.post(url + "/save", json=payload).status_code, 422)
                self.assertNotEqual(
                    client.get(url).json()["config"]["schedule"][0]["aircraft_id"], "NO_SUCH_TAIL"
                )
                config["schedule"][0]["aircraft_id"] = saved.json()["config"]["schedule"][0][
                    "aircraft_id"
                ]
                for field, value in [
                    ("home_timezone_offset_hours", "invalid"),
                    ("flight_time_7d_minutes", -1),
                    ("last_rest_end", "bad-date"),
                    ("role", "pilot"),
                ]:
                    original = config["crew_members"][0].get(field)
                    config["crew_members"][0][field] = value
                    self.assertEqual(
                        client.post(url + "/save", json=payload).status_code, 422, field
                    )
                    if original is None:
                        config["crew_members"][0].pop(field, None)
                    else:
                        config["crew_members"][0][field] = original
                owner["id"] = "bob"
                self.assertEqual(client.get(url).status_code, 404)
                self.assertEqual(client.post(url + "/duplicate").status_code, 404)
                self.assertEqual(client.get("/scenario-workspaces").json()["scenarios"], [])


if __name__ == "__main__":
    unittest.main()
