import sqlite3
from contextlib import closing

from src.store.backup import snapshot


def test_backup_includes_every_database_and_uncheckpointed_wal(tmp_path):
    for name in ("olus.db", "accounts.sqlite3", "olus-runs.db", "olus-workspaces.db"):
        with closing(sqlite3.connect(tmp_path / name)) as source:
            source.execute("PRAGMA journal_mode=WAL")
            source.execute("PRAGMA wal_autocheckpoint=0")
            source.execute("CREATE TABLE saved(value TEXT)")
            source.execute("INSERT INTO saved VALUES ('committed in WAL')")
            source.commit()
            snapshot(tmp_path, tmp_path / "backup")
            with closing(sqlite3.connect(tmp_path / "backup" / name)) as restored:
                assert restored.execute("SELECT value FROM saved").fetchone() == (
                    "committed in WAL",
                )
