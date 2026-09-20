"""Snapshot every state database through SQLite, including committed WAL data."""

import sqlite3
from contextlib import closing
from pathlib import Path

from src.store.repository import default_db_path


def snapshot(state_dir: Path, destination: Path):
    destination.mkdir(parents=True, exist_ok=True)
    for path in state_dir.iterdir():
        if path.is_file() and path.suffix in {".db", ".sqlite3"}:
            with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as source:
                with closing(sqlite3.connect(destination / path.name)) as target:
                    source.backup(target)


if __name__ == "__main__":
    import sys

    snapshot(default_db_path().parent, Path(sys.argv[1]))
