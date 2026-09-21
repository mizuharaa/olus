"""Private account/session/API-key endpoints; public simulation remains a demo."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from src.store.accounts import (
    consume_login_attempt,
    database,
    digest,
    normalize_email,
    password_hash,
    verify_password,
)

router = APIRouter(prefix="/account", tags=["account"])
COOKIE = "olus_session"
SESSION_AGE = 7 * 24 * 60 * 60
DUMMY_PASSWORD = password_hash("unused-unavailable-account-password")


def csrf_for(token: str):
    return hmac.new(token.encode(), b"olus-csrf", hashlib.sha256).hexdigest()


def origin_guard(request: Request):
    origin = request.headers.get("origin")
    allowed = os.environ.get(
        "OLUS_ACCOUNT_ORIGINS",
        "https://olus.sh,https://www.olus.sh,http://localhost:3001,http://127.0.0.1:3001",
    ).split(",")
    if origin and origin not in [item.strip() for item in allowed]:
        raise HTTPException(403, "Origin not allowed")


def _actor(request: Request, allow_key: bool):
    now = int(time.time())
    bearer = request.headers.get("authorization", "")
    with database() as db:
        if allow_key and bearer.startswith("Bearer "):
            row = db.execute(
                "SELECT a.*, k.id AS key_id FROM accounts a JOIN account_keys k ON k.user_id=a.id WHERE k.token_hash=? AND k.expires_at>?",
                (digest(bearer[7:]), now),
            ).fetchone()
            if not row:
                raise HTTPException(401, "Sign in required")
            db.execute("UPDATE account_keys SET last_seen=? WHERE id=?", (now, row["key_id"]))
            return {key: row[key] for key in ("id", "email", "name")}
        token = request.cookies.get(COOKIE, "")
        row = db.execute(
            "SELECT a.*,s.id AS session_id,s.csrf_hash FROM accounts a JOIN account_sessions s ON s.user_id=a.id WHERE s.token_hash=? AND s.expires_at>?",
            (digest(token), now),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Sign in required")
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin_guard(request)
            if not hmac.compare_digest(
                row["csrf_hash"], digest(request.headers.get("x-csrf-token", ""))
            ):
                raise HTTPException(403, "Refresh your session and retry")
        db.execute("UPDATE account_sessions SET last_seen=? WHERE id=?", (now, row["session_id"]))
        return {
            key: row[key]
            for key in ("id", "email", "name", "theme", "density", "timezone", "session_id")
        }


def require_account(request: Request):
    return _actor(request, True)


def require_session(request: Request):
    return _actor(request, False)


def no_cache(response: Response):
    response.headers["Cache-Control"] = "no-store"


class Login(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)


class Profile(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    theme: Literal["system", "dark", "light"] = "dark"
    density: Literal["comfortable", "default", "compact"] = "comfortable"
    timezone: str = Field(max_length=64, default="UTC")


class KeyName(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.post("/login")
def login(body: Login, request: Request, response: Response):
    origin_guard(request)
    try:
        email = normalize_email(body.email)
    except ValueError:
        raise HTTPException(401, "Email or password is incorrect")
    if not consume_login_attempt(email, request.client.host if request.client else "unknown"):
        raise HTTPException(
            429, "Too many sign-in attempts. Retry in 15 minutes.", headers={"Retry-After": "900"}
        )
    with database() as db:
        row = db.execute("SELECT * FROM accounts WHERE email=?", (email,)).fetchone()
        valid = verify_password(body.password, row["password"] if row else DUMMY_PASSWORD)
        if not row or not valid:
            raise HTTPException(401, "Email or password is incorrect")
        token = secrets.token_urlsafe(32)
        csrf = csrf_for(token)
        now = int(time.time())
        db.execute("DELETE FROM account_sessions WHERE expires_at<=?", (now,))
        db.execute(
            "INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?,?)",
            (
                secrets.token_urlsafe(18),
                row["id"],
                digest(token),
                digest(csrf),
                now,
                now,
                now + SESSION_AGE,
                request.headers.get("user-agent", "Unknown device")[:200],
            ),
        )
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_AGE,
        httponly=True,
        secure=os.environ.get("OLUS_COOKIE_SECURE", "true").lower() != "false",
        samesite="lax",
        path="/",
    )
    no_cache(response)
    return {
        "csrf_token": csrf,
        "user": {key: row[key] for key in ("id", "email", "name", "theme", "density", "timezone")},
    }


@router.get("/session")
def session(request: Request, response: Response, actor=Depends(require_session)):
    csrf = csrf_for(request.cookies[COOKIE])
    no_cache(response)
    return {"user": {k: v for k, v in actor.items() if k != "session_id"}, "csrf_token": csrf}


@router.get("/me")
def me(response: Response, actor=Depends(require_account)):
    no_cache(response)
    return {key: actor[key] for key in ("id", "email", "name")}


@router.patch("/profile")
def profile(body: Profile, response: Response, actor=Depends(require_session)):
    if not body.name.strip():
        raise HTTPException(422, "Name cannot be empty")
    try:
        ZoneInfo(body.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Unknown IANA timezone")
    with database() as db:
        db.execute(
            "UPDATE accounts SET name=?,theme=?,density=?,timezone=? WHERE id=?",
            (body.name.strip(), body.theme, body.density, body.timezone, actor["id"]),
        )
    no_cache(response)
    return {"saved": True}


@router.post("/logout")
def logout(response: Response, actor=Depends(require_session)):
    with database() as db:
        db.execute("DELETE FROM account_sessions WHERE id=?", (actor["session_id"],))
    response.delete_cookie(COOKIE, path="/")
    no_cache(response)
    return {"signed_out": True}


@router.get("/sessions")
def sessions(response: Response, actor=Depends(require_session)):
    with database() as db:
        rows = db.execute(
            "SELECT id,created_at,last_seen,expires_at,device FROM account_sessions WHERE user_id=? AND expires_at>? ORDER BY last_seen DESC",
            (actor["id"], int(time.time())),
        ).fetchall()
    no_cache(response)
    return [dict(row, current=row["id"] == actor["session_id"]) for row in rows]


@router.delete("/sessions/{session_id}")
def revoke_session(session_id: str, response: Response, actor=Depends(require_session)):
    with database() as db:
        if not db.execute(
            "DELETE FROM account_sessions WHERE id=? AND user_id=?", (session_id, actor["id"])
        ).rowcount:
            raise HTTPException(404, "Session not found")
    if session_id == actor["session_id"]:
        response.delete_cookie(COOKIE, path="/")
    no_cache(response)
    return {"revoked": True}


@router.get("/keys")
def keys(response: Response, actor=Depends(require_session)):
    with database() as db:
        rows = db.execute(
            "SELECT id,name,prefix,created_at,last_seen,expires_at FROM account_keys WHERE user_id=? ORDER BY created_at DESC",
            (actor["id"],),
        ).fetchall()
    no_cache(response)
    return [dict(row) for row in rows]


def issue_key(db, user_id, name):
    token = "olus_" + secrets.token_urlsafe(32)
    key_id = secrets.token_urlsafe(18)
    now = int(time.time())
    db.execute(
        "INSERT INTO account_keys VALUES(?,?,?,?,?,?,?,?)",
        (key_id, user_id, name, token[:12], digest(token), now, None, now + 90 * 24 * 60 * 60),
    )
    return {"id": key_id, "key": token, "name": name, "expires_at": now + 90 * 24 * 60 * 60}


@router.post("/keys")
def create_key(body: KeyName, response: Response, actor=Depends(require_session)):
    if not body.name.strip():
        raise HTTPException(422, "Name cannot be empty")
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        if (
            db.execute(
                "SELECT COUNT(*) FROM account_keys WHERE user_id=?", (actor["id"],)
            ).fetchone()[0]
            >= 10
        ):
            raise HTTPException(409, "Revoke an existing key before creating another")
        result = issue_key(db, actor["id"], body.name.strip())
    no_cache(response)
    return result


@router.post("/keys/{key_id}/rotate")
def rotate_key(key_id: str, response: Response, actor=Depends(require_session)):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT name FROM account_keys WHERE id=? AND user_id=?", (key_id, actor["id"])
        ).fetchone()
        if not row:
            raise HTTPException(404, "Key not found")
        db.execute("DELETE FROM account_keys WHERE id=?", (key_id,))
        result = issue_key(db, actor["id"], row["name"])
    no_cache(response)
    return result


@router.delete("/keys/{key_id}")
def revoke_key(key_id: str, response: Response, actor=Depends(require_session)):
    with database() as db:
        if not db.execute(
            "DELETE FROM account_keys WHERE id=? AND user_id=?", (key_id, actor["id"])
        ).rowcount:
            raise HTTPException(404, "Key not found")
    no_cache(response)
    return {"revoked": True}


class EmailChange(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class DeleteAccount(BaseModel):
    password: str = Field(min_length=1, max_length=128)


def confirm_password(db, actor, password):
    row = db.execute("SELECT password FROM accounts WHERE id=?", (actor["id"],)).fetchone()
    if not consume_login_attempt(actor["email"], "reauth:" + actor["id"]):
        raise HTTPException(429, "Too many attempts. Retry in 15 minutes.")
    if not row or not verify_password(password, row["password"]):
        raise HTTPException(403, "Password is incorrect")


@router.patch("/email")
def change_email(body: EmailChange, response: Response, actor=Depends(require_session)):
    import sqlite3

    try:
        email = normalize_email(body.email)
    except ValueError as error:
        raise HTTPException(422, str(error))
    with database() as db:
        confirm_password(db, actor, body.password)
        try:
            db.execute("UPDATE accounts SET email=? WHERE id=?", (email, actor["id"]))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Email unavailable")
    no_cache(response)
    return {"email": email}


@router.patch("/password")
def change_password(body: PasswordChange, response: Response, actor=Depends(require_session)):
    with database() as db:
        confirm_password(db, actor, body.current_password)
        db.execute(
            "UPDATE accounts SET password=? WHERE id=?",
            (password_hash(body.new_password), actor["id"]),
        )
        db.execute(
            "DELETE FROM account_sessions WHERE user_id=? AND id<>?",
            (actor["id"], actor["session_id"]),
        )
        db.execute("DELETE FROM account_keys WHERE user_id=?", (actor["id"],))
    no_cache(response)
    return {"saved": True, "other_sessions_and_keys_revoked": True}


@router.post("/delete")
def delete_account(body: DeleteAccount, response: Response, actor=Depends(require_session)):
    with database() as db:
        confirm_password(db, actor, body.password)
        db.execute("DELETE FROM account_sessions WHERE user_id=?", (actor["id"],))
        db.execute("DELETE FROM account_keys WHERE user_id=?", (actor["id"],))
        db.execute("DELETE FROM accounts WHERE id=?", (actor["id"],))
    response.delete_cookie(COOKIE, path="/")
    no_cache(response)
    return {"deleted": True}
