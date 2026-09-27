"""Isolated account security regression: python -m unittest discover -s tests -p test_account.py."""

import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.routes.account import router
from src.store.accounts import database, digest, provision


class AccountTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(
            os.environ,
            {"OLUS_ACCOUNT_DB": self.tmp.name + "/accounts.sqlite3", "OLUS_COOKIE_SECURE": "true"},
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.tmp.cleanup)
        self.first = provision("one@example.com", "first-password-123", "One")
        self.second = provision("two@example.com", "second-password-123", "Two")
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        self.a = TestClient(app, base_url="https://testserver")
        self.b = TestClient(app, base_url="https://testserver")
        self.addCleanup(self.a.close)
        self.addCleanup(self.b.close)

    def login(self, client, email="one@example.com", password="first-password-123"):
        r = client.post(
            "/api/v1/account/login",
            json={"email": email, "password": password},
            headers={"Origin": "https://olus.sh"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn("HttpOnly", r.headers["set-cookie"])
        self.assertIn("Secure", r.headers["set-cookie"])
        client.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        return r

    def test_successful_logins_do_not_exhaust_email_attempts(self):
        for _ in range(9):
            self.login(self.a)

    def test_session_csrf_profile_logout(self):
        self.assertEqual(self.a.get("/api/v1/account/session").status_code, 401)
        self.assertEqual(
            self.a.post(
                "/api/v1/account/login",
                json={"email": "one@example.com", "password": "first-password-123"},
                headers={"Origin": "https://evil.example"},
            ).status_code,
            403,
        )
        result = self.login(self.a)
        self.assertEqual(
            self.a.get("/api/v1/account/session").json()["csrf_token"], result.json()["csrf_token"]
        )
        profile = {"name": "Updated", "theme": "light", "density": "compact", "timezone": "UTC"}
        csrf = self.a.headers.pop("X-CSRF-Token")
        self.assertEqual(self.a.patch("/api/v1/account/profile", json=profile).status_code, 403)
        self.a.headers["X-CSRF-Token"] = csrf
        self.assertEqual(self.a.patch("/api/v1/account/profile", json=profile).status_code, 200)
        self.assertEqual(self.a.get("/api/v1/account/session").json()["user"]["name"], "Updated")
        with database() as db:
            stored = db.execute(
                "SELECT password FROM accounts WHERE id=?", (self.first,)
            ).fetchone()[0]
            token = db.execute("SELECT token_hash FROM account_sessions").fetchone()[0]
        self.assertNotIn("first-password", stored)
        self.assertEqual(token, digest(self.a.cookies["olus_session"]))
        self.assertEqual(self.a.post("/api/v1/account/logout").status_code, 200)
        self.assertEqual(self.a.get("/api/v1/account/session").status_code, 401)

    def test_key_owner_rotation_revocation(self):
        self.login(self.a)
        self.login(self.b, "two@example.com", "second-password-123")
        result = self.a.post("/api/v1/account/keys", json={"name": "Integration"}).json()
        key = result["key"]
        key_id = result["id"]
        self.assertEqual(
            self.a.get(
                "/api/v1/account/me", headers={"Authorization": "Bearer " + key}
            ).status_code,
            200,
        )
        self.assertNotIn(key, str(self.a.get("/api/v1/account/keys").json()))
        self.assertEqual(self.b.delete("/api/v1/account/keys/" + key_id).status_code, 404)
        self.assertEqual(self.b.post("/api/v1/account/keys/" + key_id + "/rotate").status_code, 404)
        rotated = self.a.post("/api/v1/account/keys/" + key_id + "/rotate").json()
        self.assertEqual(
            self.a.get(
                "/api/v1/account/me", headers={"Authorization": "Bearer " + key}
            ).status_code,
            401,
        )
        self.assertEqual(
            self.a.get(
                "/api/v1/account/me", headers={"Authorization": "Bearer " + rotated["key"]}
            ).status_code,
            200,
        )
        self.assertEqual(self.a.delete("/api/v1/account/keys/" + rotated["id"]).status_code, 200)
        self.assertEqual(
            self.a.get(
                "/api/v1/account/me", headers={"Authorization": "Bearer " + rotated["key"]}
            ).status_code,
            401,
        )

    def test_session_scope_expiry_password(self):
        self.login(self.a)
        self.login(self.b, "two@example.com", "second-password-123")
        session = self.a.get("/api/v1/account/sessions").json()[0]
        self.assertEqual(
            self.b.delete("/api/v1/account/sessions/" + session["id"]).status_code, 404
        )
        key = self.a.post("/api/v1/account/keys", json={"name": "Old key"}).json()["key"]
        self.assertEqual(
            self.a.patch(
                "/api/v1/account/password",
                json={"current_password": "wrong", "new_password": "new-password-123"},
            ).status_code,
            403,
        )
        self.assertEqual(
            self.a.patch(
                "/api/v1/account/password",
                json={"current_password": "first-password-123", "new_password": "new-password-123"},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.a.get(
                "/api/v1/account/me", headers={"Authorization": "Bearer " + key}
            ).status_code,
            401,
        )
        with database() as db:
            db.execute("UPDATE account_sessions SET expires_at=0 WHERE id=?", (session["id"],))
        self.assertEqual(self.a.get("/api/v1/account/session").status_code, 401)

    def test_rate_limit_and_delete(self):
        for _ in range(8):
            self.assertEqual(
                self.a.post(
                    "/api/v1/account/login",
                    json={"email": "missing@example.com", "password": "wrong"},
                ).status_code,
                401,
            )
        self.assertEqual(
            self.a.post(
                "/api/v1/account/login", json={"email": "missing@example.com", "password": "wrong"}
            ).status_code,
            429,
        )
        self.login(self.b, "two@example.com", "second-password-123")
        self.assertEqual(
            self.b.post(
                "/api/v1/account/delete", json={"password": "second-password-123"}
            ).status_code,
            200,
        )
        self.assertEqual(self.b.get("/api/v1/account/session").status_code, 401)
        with database() as db:
            self.assertIsNone(
                db.execute("SELECT id FROM accounts WHERE id=?", (self.second,)).fetchone()
            )


if __name__ == "__main__":
    unittest.main()
