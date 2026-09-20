"""Owner-scoped editable scenario drafts, separate from live engine snapshots."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


class ScenarioWorkspaceRepository:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS scenario_workspaces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS scenario_workspace_owner ON scenario_workspaces(owner_id)"
            )

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def decode(row):
        if row is None:
            return None
        result = dict(row)
        result["config"] = json.loads(result["config"])
        result["archived"] = bool(result["archived"])
        return result

    def list(self, owner):
        with self.connect() as db:
            return [
                self.decode(row)
                for row in db.execute(
                    "SELECT * FROM scenario_workspaces WHERE owner_id=? ORDER BY updated_at DESC",
                    (owner,),
                )
            ]

    def get(self, owner, scenario_id):
        with self.connect() as db:
            return self.decode(
                db.execute(
                    "SELECT * FROM scenario_workspaces WHERE owner_id=? AND id=?",
                    (owner, scenario_id),
                ).fetchone()
            )

    def create(self, owner, name, config):
        scenario_id = str(uuid4())
        with self.connect() as db:
            db.execute(
                "INSERT INTO scenario_workspaces(id,owner_id,name,config,updated_at) VALUES(?,?,?,?,?)",
                (
                    scenario_id,
                    owner,
                    name,
                    json.dumps(config, allow_nan=False),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        return self.get(owner, scenario_id)

    def save(self, owner, scenario_id, revision, name, config, archived):
        with self.connect() as db:
            changed = db.execute(
                "UPDATE scenario_workspaces SET name=?,config=?,archived=?,revision=revision+1,updated_at=? WHERE owner_id=? AND id=? AND revision=?",
                (
                    name,
                    json.dumps(config, allow_nan=False),
                    int(archived),
                    datetime.now(timezone.utc).isoformat(),
                    owner,
                    scenario_id,
                    revision,
                ),
            ).rowcount
        return self.get(owner, scenario_id) if changed else None
