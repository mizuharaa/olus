# Account access and persistence

Implemented 2026-09-16. Public simulator endpoints remain an anonymous demonstration. Saved scenarios, private runs and account endpoints use authenticated owner IDs.

## Provision an account

On the API host, from `apps/api` with its Python environment active:

```sh
python -m src.store.accounts dispatcher@example.com --name Dispatcher
```

The CLI prompts twice without echoing the password. Passwords must contain 12–128 characters. Existing emails cannot be overwritten. There is no public registration endpoint, seeded production password or browser-local account.

`OLUS_ACCOUNT_DB` selects the persistent SQLite account database; default is `accounts.sqlite3` beside the operational database. Protect this directory with the API process's filesystem permissions and include it in backups. Passwords use salted scrypt; session tokens and API keys are stored only as SHA-256 hashes.

## Browser session

- Sign in at `/app/account`. Sessions expire after seven days.
- `olus_session` is HttpOnly, SameSite=Lax and Secure by default. Set `OLUS_COOKIE_SECURE=false` only for local HTTP development.
- Configure `OLUS_ACCOUNT_ORIGINS` as a comma-separated list of trusted browser origins. Production defaults include `https://olus.sh` and `https://www.olus.sh`; remove development origins in deployment configuration.
- `GET /api/v1/account/session` returns the current user and a stable CSRF token. Cookie-authenticated mutations require that token in `X-CSRF-Token`; the Next proxy preserves cookies, tokens and Set-Cookie responses.
- Account responses are marked `Cache-Control: no-store`. Login attempts are limited in SQLite to eight per email and 100 per remote address per 15-minute window. Proxied requests may share an upstream address; the email limit remains independent.
- Profile, theme, density and timezone persist server-side. Sign out and session revocation invalidate server sessions. Password changes revoke other sessions and all API keys.

## API keys

Keys authorize private workspace APIs via `Authorization: Bearer ...`. Account management requires a browser session. At most ten keys exist per account; each expires after 90 days. Creation and rotation reveal the new secret once. Rotation atomically invalidates the previous key; revocation takes effect immediately.

## Scope and retention

Email changes require the current password, but email ownership is not verified by an email delivery service. Avatar upload, password-reset delivery and self-service registration are not implemented. Account deletion removes credentials, preferences, sessions and keys; operational simulation records remain in the operator's database under their former owner ID and cannot be accessed by a newly provisioned account.

## Verification

`apps/api/tests/test_account.py` covers session/CSRF/expiry, owner boundaries, key rotation/revocation, password reauthentication, rate limits and deletion using temporary SQLite databases.

From `apps/web`, `node scripts/check-account-integration.mjs` starts an isolated API and Next instance on ports 8002/3002 with temporary credentials held in memory. It verifies real browser sign-in, cookie flags, missing-CSRF rejection, inline profile persistence, key issue/rotate/revoke and sign-out through the Next proxy. It does not create an account in the running product database.
