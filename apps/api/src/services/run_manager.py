"""Owner-scoped recovery runs. Workers never share the public demo engine."""

from __future__ import annotations

import asyncio
import hashlib
import json
import multiprocessing
import queue
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

TERMINAL = {"completed", "cancelled", "timed_out", "failed", "interrupted"}


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def _worker(config: dict, output):
    """Spawn target: termination stops the solver process, not just the HTTP waiter."""
    from src.optimizer.milp import RecoveryOptimizer
    from src.predictor.cascade import CascadePredictor
    from src.simulator.engine import SimulationEngine

    started = time.monotonic()

    def emit(event):
        output.put({**event, "elapsed_ms": round((time.monotonic() - started) * 1000)})

    class WeatherSnapshot:
        def get_all_cached(self):
            return config.get("weather", {})

    async def solve():
        engine = SimulationEngine(config["schedule"], config["aircraft"], config["crew_pairings"])
        optimizer = RecoveryOptimizer(
            timeout_secs=config.get("constraints", {}).get("solver_timeout_secs", 30),
            deterministic=True,
            progress=emit,
        )
        predictor = CascadePredictor()
        predictions = {}
        if not config["disruptions"]:
            plans = await asyncio.to_thread(
                optimizer.solve,
                config["schedule"],
                config["aircraft"],
                config["crew_pairings"],
                [],
                [],
                {},
            )
            engine.state.recovery_plans = [p.to_dict() for p in plans]
        for index, event in enumerate(config["disruptions"]):
            emit({"type": "disruption_started", "index": index, "kind": event["kind"]})
            update = await engine.trigger_event(event, predictor, optimizer, WeatherSnapshot())
            predictions = update.get("predictions", {})
        return {
            **engine.to_state_dict(),
            "schedule": config["schedule"],
            "aircraft": config["aircraft"],
            "crew_pairings": config["crew_pairings"],
            "crew_members": config["crew_members"],
            "predictions": predictions,
        }

    try:
        emit({"type": "running"})
        result = asyncio.run(solve())
        emit({"type": "completed", "result": result})
    except Exception as error:
        emit({"type": "failed", "error": f"{type(error).__name__}: {error}"})


class RunManager:
    """Single API-process supervisor, with durable history and bounded parallelism.

    ponytail: two worker processes per API instance; use a shared queue/lease if
    deploying multiple API workers against the same run database.
    """

    def __init__(self, path: str | Path, max_workers: int = 2):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS recovery_runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL)"
        )
        self.db.execute(
            "CREATE INDEX IF NOT EXISTS recovery_runs_owner ON recovery_runs(owner,created_at)"
        )
        self.db.commit()
        self.workers: dict[str, tuple[multiprocessing.Process, threading.Thread]] = {}
        self.max_workers = max_workers
        self.closed = False
        # A crash cannot leave yesterday's run claiming it is still solving.
        for row in self.db.execute("SELECT id,data FROM recovery_runs").fetchall():
            data = json.loads(row[1])
            if data["status"] not in TERMINAL:
                data.update(
                    status="interrupted",
                    finished_at=utcnow(),
                    error="API restarted before this run completed",
                )
                self._save(data)

    def _save(self, data):
        self.db.execute(
            "INSERT OR REPLACE INTO recovery_runs VALUES (?,?,?,?)",
            (data["id"], data["owner_id"], data["created_at"], json.dumps(data)),
        )
        self.db.commit()

    def _get(self, owner, run_id):
        row = self.db.execute(
            "SELECT data FROM recovery_runs WHERE id=? AND owner=?", (run_id, owner)
        ).fetchone()
        if row is None:
            raise KeyError(run_id)
        return json.loads(row[0])

    def get(self, owner, run_id, include_input=False):
        with self.lock:
            data = self._get(owner, run_id)
        if data["status"] not in TERMINAL:
            data["elapsed_ms"] = round(
                (
                    datetime.now(timezone.utc) - datetime.fromisoformat(data["created_at"])
                ).total_seconds()
                * 1000
            )
        if not include_input:
            data.pop("input", None)
        data.pop("owner_id", None)
        return data

    def start(self, owner, scenario, weather=None):
        config = json.loads(json.dumps(scenario["config"]))
        config["weather"] = weather or {}
        serialized = json.dumps(config, sort_keys=True, separators=(",", ":"))
        for event in config["disruptions"]:
            event.setdefault("id", str(uuid.uuid4()))
            event.setdefault("triggered_at", utcnow())
        with self.lock:
            if self.closed:
                raise RuntimeError("Run supervisor is shutting down")
            if any(
                self.db.execute(
                    "SELECT 1 FROM recovery_runs WHERE id=? AND owner=? AND json_extract(data, '$.status') IN ('queued', 'running')",
                    (run_id, owner),
                ).fetchone()
                for run_id in self.workers
            ):
                raise RuntimeError("You already have a running solve; wait or cancel it first")
            if len(self.workers) >= self.max_workers:
                raise RuntimeError("Solver capacity reached; retry after a running solve finishes")
            data = {
                "id": str(uuid.uuid4()),
                "owner_id": owner,
                "scenario_id": scenario["id"],
                "scenario_name": scenario.get("name", "Scenario"),
                "input_hash": hashlib.sha256(serialized.encode()).hexdigest(),
                "created_at": utcnow(),
                "status": "queued",
                "elapsed_ms": 0,
                "events": [],
                "result": None,
                "input": config,
            }
            context = multiprocessing.get_context("spawn")
            output = context.Queue()
            process = context.Process(target=_worker, args=(config, output), daemon=True)
            self._save(data)
            try:
                process.start()
            except Exception as error:
                data.update(
                    status="failed", finished_at=utcnow(), error="Solver worker could not start"
                )
                self._save(data)
                output.close()
                raise RuntimeError("Solver worker could not start") from error
            timeout = min(
                600,
                max(
                    30,
                    config.get("constraints", {}).get("solver_timeout_secs", 30)
                    * max(1, len(config["disruptions"]))
                    + 30,
                ),
            )
            monitor = threading.Thread(
                target=self._monitor,
                args=(owner, data["id"], process, output, timeout),
                daemon=True,
            )
            self.workers[data["id"]] = (process, monitor)
            monitor.start()
            return self.get(owner, data["id"])

    def _monitor(self, owner, run_id, process, output, timeout):
        deadline = time.monotonic() + timeout
        try:
            while True:
                try:
                    event = output.get(timeout=0.15)
                except queue.Empty:
                    if not process.is_alive():
                        self._finish(
                            owner, run_id, "failed", "Solver process exited without a result"
                        )
                        break
                    if time.monotonic() >= deadline:
                        process.terminate()
                        process.join(5)
                        self._finish(
                            owner, run_id, "timed_out", "Run exceeded its wall-clock budget"
                        )
                        break
                    continue
                with self.lock:
                    data = self._get(owner, run_id)
                    if data["status"] in TERMINAL:
                        break
                    data["elapsed_ms"] = event["elapsed_ms"]
                    if event["type"] == "completed":
                        data.update(
                            status="completed", result=event.pop("result"), finished_at=utcnow()
                        )
                    elif event["type"] == "failed":
                        data.update(status="failed", error=event.get("error"), finished_at=utcnow())
                    else:
                        data["status"] = "running"
                    data["event_count"] = data.get("event_count", 0) + 1
                    event["sequence"] = data["event_count"]
                    data["events"].append(event)
                    if len(data["events"]) > 2000:
                        data["events"] = data["events"][-2000:]
                        data["events_dropped"] = data["event_count"] - 2000
                    self._save(data)
                    if data["status"] in TERMINAL:
                        break
        finally:
            process.join(2)
            if process.is_alive():
                process.terminate()
                process.join(5)
            output.close()
            with self.lock:
                self.workers.pop(run_id, None)

    def _finish(self, owner, run_id, status, error=None):
        with self.lock:
            data = self._get(owner, run_id)
            if data["status"] in TERMINAL:
                return
            data.update(status=status, finished_at=utcnow(), error=error)
            data["elapsed_ms"] = round(
                (
                    datetime.now(timezone.utc) - datetime.fromisoformat(data["created_at"])
                ).total_seconds()
                * 1000
            )
            data["events"].append(
                {
                    "type": status,
                    "elapsed_ms": data["elapsed_ms"],
                    "sequence": data.get("event_count", len(data["events"])) + 1,
                }
            )
            self._save(data)

    def cancel(self, owner, run_id):
        with self.lock:
            data = self._get(owner, run_id)
            if data["status"] not in TERMINAL:
                self._finish(owner, run_id, "cancelled")
                worker = self.workers.get(run_id)
                if worker:
                    worker[0].terminate()
                    worker[0].join(5)
                    if worker[0].is_alive():
                        worker[0].kill()
                        worker[0].join(5)
            return self.get(owner, run_id)

    def history(self, owner, start=None, end=None):
        with self.lock:
            rows = self.db.execute(
                "SELECT data FROM recovery_runs WHERE owner=? AND created_at>=? AND created_at<=? ORDER BY created_at DESC LIMIT 500",
                (owner, start or "", end or "9999"),
            ).fetchall()
        result = []
        for row in rows:
            data = json.loads(row[0])
            plans = (data.get("result") or {}).get("recovery_plans", [])
            result.append(
                {
                    key: data.get(key)
                    for key in (
                        "id",
                        "scenario_id",
                        "scenario_name",
                        "created_at",
                        "finished_at",
                        "elapsed_ms",
                        "status",
                        "input_hash",
                    )
                }
                | {
                    "plans": [
                        {
                            key: p.get(key)
                            for key in (
                                "plan_id",
                                "status",
                                "solve_time_ms",
                                "total_cost_usd",
                                "total_passenger_delay_minutes",
                            )
                        }
                        for p in plans
                    ]
                }
            )
        return result

    def apply(self, owner, run_id, plan_id):
        from src.simulator.engine import SimulationEngine

        with self.lock:
            data = self._get(owner, run_id)
            if data["status"] != "completed" or not data["result"]:
                raise ValueError("Only a completed run can apply a plan")
            result = data["result"]
            engine = SimulationEngine(
                result["schedule"], result["aircraft"], result["crew_pairings"]
            )
            engine._restore_state_dict(result)
            asyncio.run(engine.apply_plan(plan_id) if plan_id else engine.unapply_plan())
            result.update(engine.to_state_dict())
            self._save(data)
            return self.get(owner, run_id)

    def close(self):
        with self.lock:
            self.closed = True
            active = [(key, value) for key, value in self.workers.items()]
        for run_id, (process, monitor) in active:
            with self.lock:
                row = self.db.execute(
                    "SELECT owner FROM recovery_runs WHERE id=?", (run_id,)
                ).fetchone()
            if row:
                self.cancel(row[0], run_id)
            monitor.join(8)
        with self.lock:
            self.db.close()
