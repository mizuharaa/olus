"""Account persistence. Operator provisioning only: python -m src.store.accounts EMAIL."""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from src.store.repository import default_db_path

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,name TEXT NOT NULL,theme TEXT NOT NULL DEFAULT 'dark',density TEXT NOT NULL DEFAULT 'comfortable',timezone TEXT NOT NULL DEFAULT 'UTC');
CREATE TABLE IF NOT EXISTS account_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),token_hash TEXT UNIQUE NOT NULL,csrf_hash TEXT NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL,device TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS account_keys(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),name TEXT NOT NULL,prefix TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS account_attempts(scope TEXT PRIMARY KEY,started INTEGER NOT NULL,count INTEGER NOT NULL);
"""


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    derived = hashlib.scrypt(
        password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32
    ).hex()
    return f"{salt}:{derived}"


def verify_password(password: str, encoded: str) -> bool:
    return hmac.compare_digest(password_hash(password, encoded.split(":")[0]), encoded)


def normalize_email(email: str) -> str:
    email = email.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("Enter a valid email address")
    return email


@contextmanager
def database():
    path = Path(
        os.environ.get("OLUS_ACCOUNT_DB", str(default_db_path().parent / "accounts.sqlite3"))
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript(SCHEMA)
    try:
        with db:
            yield db
    finally:
        db.close()


def provision(email: str, password: str, name: str = "") -> str:
    email = normalize_email(email)
    if not 12 <= len(password) <= 128:
        raise ValueError("Password must be 12 to 128 characters")
    user_id = secrets.token_urlsafe(18)
    with database() as db:
        db.execute(
            "INSERT INTO accounts(id,email,password,name) VALUES(?,?,?,?)",
            (user_id, email, password_hash(password), name.strip()[:100] or email.split("@")[0]),
        )
    return user_id


def consume_login_attempt(email: str, remote: str) -> bool:
    now = int(time.time())
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM account_attempts WHERE started < ?", (now - 900,))
        scopes = [(digest("email:" + email), 8), (digest("remote:" + remote), 100)]
        for scope, limit in scopes:
            row = db.execute(
                "SELECT count FROM account_attempts WHERE scope=?", (scope,)
            ).fetchone()
            if row and row["count"] >= limit:
                return False
        for scope, _ in scopes:
            db.execute(
                "INSERT INTO account_attempts VALUES(?,?,1) ON CONFLICT(scope) DO UPDATE SET count=count+1",
                (scope, now),
            )
    return True


if __name__ == "__main__":
    import argparse
    from getpass import getpass

    parser = argparse.ArgumentParser(
        description="Provision an Olus account on the API host; no public signup endpoint exists."
    )
    parser.add_argument("email")
    parser.add_argument("--name", default="")
    args = parser.parse_args()
    password = getpass("Password (12+ characters): ")
    if password != getpass("Confirm password: "):
        raise SystemExit("Passwords did not match")
    try:
        provision(args.email, password, args.name)
    except (ValueError, sqlite3.IntegrityError) as error:
        raise SystemExit(str(error))
    print("Account provisioned. Sign in through the Olus account page.")
