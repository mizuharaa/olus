"""Isolated benchmark of real routes/workers; no external feeds or existing DBs.

PYTHONPATH must include apps/api. Run this script from the repo root.
Fixtures are synthetic independent flights, not production dispatch traffic.
"""

import json
import os
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path


def main():
    import uvicorn

    with tempfile.TemporaryDirectory(prefix="olus-k6-") as directory:
        root = Path(directory)
        os.environ["OLUS_ACCOUNT_DB"] = str(root / "accounts.db")
        from src.main import app
        from src.network import cache
        from src.network.reference_scenario import reference_scenario
        from src.optimizer.milp import RecoveryOptimizer
        from src.predictor.cascade import CascadePredictor
        from src.routes.scenario_workspaces import ScenarioConfig
        from src.services.run_manager import RunManager
        from src.simulator.engine import SimulationEngine
        from src.store.accounts import database, digest, provision
        from src.store.scenario_workspaces import ScenarioWorkspaceRepository

        class FrozenWeather:
            def get_all_cached(self):
                return {}

        @asynccontextmanager
        async def isolated(application):
            cache.warm()
            application.state.engine = SimulationEngine(cache.get_flights(), cache.get_aircraft(), cache.get_crew_pairings(), crew_members=cache.get_crew_members())
            application.state.optimizer = RecoveryOptimizer(timeout_secs=5, deterministic=True)
            application.state.predictor = CascadePredictor()
            application.state.weather = FrozenWeather()
            application.state.run_manager = RunManager(root / "runs.db")
            repository = ScenarioWorkspaceRepository(root / "scenarios.db")
            application.state.scenario_workspace_repository = repository
            owner = provision("benchmark@example.invalid", "local-benchmark-password", "Local k6")
            now = int(time.time())
            # This public benchmark-only token exists exclusively in this loopback temporary DB.
            with database() as db:
                db.execute("INSERT INTO account_keys VALUES(?,?,?,?,?,?,?,?)", ("bench", owner, "Local benchmark", "bench", digest("local-k6-only"), now, now, now + 3600))
            for size in (2, 50, 100):
                config = reference_scenario()
                for key in ("schedule", "aircraft", "crew_pairings", "crew_members"):
                    config[key] = []
                for index in range(size // 2):
                    block = json.loads(json.dumps(reference_scenario()).replace("DEMO", f"B{index:02d}"))
                    for key in ("schedule", "aircraft", "crew_pairings", "crew_members"):
                        config[key].extend(block[key])
                config["constraints"]["solver_timeout_secs"] = 5
                config["disruptions"] = [{"kind": "mechanical_aog", "params": {"aircraft_tail": "B00-T1", "defect_category": "avionics", "duration_hours": 4}}]
                repository.create(owner, f"Synthetic {size} flights", ScenarioConfig(**config).model_dump())
            print(json.dumps({"benchmark_only": True, "public_schedule_flights": len(cache.get_flights()), "synthetic_sizes": [2, 50, 100], "api_workers": 1, "solver_workers": 2, "external_feeds": "disabled", "database": "temporary_sqlite"}), flush=True)
            try:
                yield
            finally:
                application.state.run_manager.close()

        app.router.lifespan_context = isolated
        uvicorn.run(app, host="127.0.0.1", port=18761, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
