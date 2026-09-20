Write and ExitPlanMode are also unavailable — this session is strictly read-only, so here is the audit inline.

# Independent QA audit — Olus (`ui/olus-dashboard-v2`, working tree)

**Method and its limits.** `Bash` and all write tools are disabled, so nothing was executed and no file was touched. Every finding below is traced through source and config only — no runtime, browser, solver, accessibility or performance evidence was produced. F01–F13 from `docs/full-workorder-audit.md` are recorded as fixed in the resolution appendix and are **not** repeated; everything here is new.

---

## P0 — the private product is unreachable in the AWS deployment

A1 blocks sign-in; A2 blocks the session sign-in would have created. Independent causes, same outcome: every account, scenario-workspace and run endpoint is unusable in production while all local integration checks pass.

### A1 · `OLUS_ACCOUNT_ORIGINS` is never set on the ECS task → login returns 403

- `infra/terraform/main.tf:632-639` — the `api` container's `environment` sets `APP_ENV`, `CORS_ORIGINS`, `LOG_LEVEL`, `PORT`, `WEB_CONCURRENCY`, `SOLVER_NUM_THREADS`. `OLUS_ACCOUNT_ORIGINS` is absent. A repo-wide grep finds the name only in `routes/account.py`, `docs/account-auth.md`, and the two check scripts — never under `infra/`.
- `apps/api/src/routes/account.py:22` — fallback allowlist is `https://olus.sh,https://www.olus.sh,http://localhost:3001,http://127.0.0.1:3001`.
- `infra/terraform/variables.tf:59-68` — `domain_name` and `hosted_zone_id` both default to `""`, so `main.tf:35-36` gives `tls_enabled = false` and `app_origin = "http://${aws_lb.app.dns_name}"`.
- `account.py:59` — `login()` calls `origin_guard` first; `account.py:36-38` — every cookie-authenticated mutation calls it too.

**Reproduction:** the browser posts `/api/v1/account/login` from `http://olus-prod-alb-….elb.amazonaws.com` and attaches that `Origin`; it is not in the allowlist → `403 "Origin not allowed"`. Sign-in is impossible. The same holds under TLS unless `var.domain_name` is exactly `olus.sh` or `www.olus.sh`.

`docs/account-auth.md:21` already requires this to be configured ("remove development origins in deployment configuration"). The Terraform never does.

**Minimal fix:** one entry beside `CORS_ORIGINS` at `main.tf:632-639` — `{ name = "OLUS_ACCOUNT_ORIGINS", value = local.app_origin }` — and drop the two localhost origins from the `account.py:22` default.

**Verification gap:** deployed `domain_name`/`hosted_zone_id` live in Terraform state, not the repo. One `curl -i -H 'Origin: <site-origin>' …/api/v1/account/login` against the live ALB settles it.

### A2 · The session cookie is `Secure` on an HTTP-only ALB, so it is never stored

- `routes/account.py:70` — `secure=os.environ.get('OLUS_COOKIE_SECURE','true').lower()!='false'`, i.e. `Secure` by default.
- `OLUS_COOKIE_SECURE` is likewise absent from `main.tf:632-639`.
- With `tls_enabled = false` the only listener is HTTP:80 (`main.tf:523-547`) and the API rule hangs off it (`main.tf:564-580`). There is no HTTPS listener.

**Consequence:** login returns `200` with a `csrf_token`, the browser silently discards the `Secure` cookie over `http://`, and every subsequent request returns `401 "Sign in required"`. `apps/web/app/app/account/page.tsx:18` explicitly swallows that message, so the page re-renders the sign-in form with **no error shown** — a silent auth failure.

**Minimal fix:** `{ name = "OLUS_COOKIE_SECURE", value = tostring(local.tls_enabled) }`. Better: treat a custom domain as a prerequisite for the account feature rather than shipping `secure=false` on a public HTTP origin.

---

## P1

### B1 · The ALB sends `/api/v1/*` straight to FastAPI — the Next proxy never runs in production

- `infra/terraform/main.tf:564-598` — listener rules at priority 10 match `["/api/v1/*","/ws/*","/health"]` and forward to `aws_lb_target_group.api`. Rules evaluate before the default action, which is the only route to the web target group.
- `apps/web/lib/api.ts:6,19` — `API_URL = ""`, so the browser calls same-origin `/api/v1/...`; the ALB intercepts before Next sees it.
- `apps/web/app/api/v1/[...path]/route.ts:1-12` documents the opposite intent.

Dead in production: the cross-origin guard (`route.ts:27-31`), structured 502/504 shaping (`:71-81`), `maxDuration`/`API_PROXY_TIMEOUT_MS` (`:18-24`), and the `set-cookie` relay (`:69`).

**Why this matters beyond tidiness:** `apps/web/scripts/check-account-integration.mjs:10` and `check-scenario-integration.mjs:10` drive their checks **through a local Next proxy** and set `OLUS_ACCOUNT_ORIGINS` and `OLUS_COOKIE_SECURE=false` themselves. The PASS results at `docs/verification/audit-resolution-status.md:13,19,48` therefore certify a request path and an environment production does not use — which is how A1/A2 survived. Same class as the work order's §3 "works on localhost, dead in production".

**Minimal fix:** pick one path and delete the other — remove `/api/v1/*` from both listener rules (keep `/ws/*`, `/health`), or delete `route.ts` — then re-point the check scripts at whichever survives.

### B2 · The themed 404 handler swallows every ownership and not-found error

- `apps/api/src/main.py:321-335` registers `@app.exception_handler(404)`. Starlette resolves **status-code** handlers for `HTTPException` before type handlers, so it catches deliberate `HTTPException(404, …)`, not just routing misses.
- Affected: `routes/scenario_workspaces.py:122` "Scenario not found"; `routes/runs.py:42` "Run not found"; `runs.py:123` "Plan not found in this run"; `routes/account.py:105` "Session not found"; `account.py:133,141` "Key not found".
- `apps/web/lib/api.ts:36-41` reads `payload.detail`, which the handler sets to `"No flight plan for GET /api/v1/runs/<id> — this endpoint never departed."`

Rendered verbatim at `run-monitor.tsx:18`, `scenario-workspace.tsx:44`, `workspace-data.tsx:85`, `account/page.tsx:25`. A user opening a run that is not theirs is told the endpoint does not exist. The 404 body is the only signal distinguishing "not yours" from "route removed", so an ownership regression would be indistinguishable from a routing change in both the UI and any test asserting on `detail`.

**Minimal fix:** register on `StarletteHTTPException` and return `{"detail": exc.detail}` whenever `detail` differs from the default `"Not Found"`; fall through to the themed body only for unmatched routes.

### B3 · Solver capacity is global, not per-account: one user starves all others

- `services/run_manager.py:87` — `max_workers: int = 2`.
- `run_manager.py:154-155` — admission is `len(self.workers) >= self.max_workers`, counted across every owner.
- `run_manager.py:182-190` — wall clock `min(600, max(30, solver_timeout_secs * len(disruptions) + 30))`. With the maxima the API itself accepts — `solver_timeout_secs ≤ 120` (`routes/scenario_workspaces.py:17`) and 20 disruptions (`:31`) — that clamps to the **600 s ceiling**.
- `routes/runs.py:49` — no per-owner cap, no rate limit.
- `main.tf:600-699` + `variables.tf:48-57` — exactly one task, `WEB_CONCURRENCY=1`; no second supervisor to absorb it.

Two `POST /runs` from one account hold both slots for ten minutes and re-occupy on release; everyone else gets `409 "Solver capacity reached"`. Trivially scriptable via an API key, since `require_account` accepts Bearer (`account.py:28-32`).

**Minimal fix:** store the owner alongside the process at `run_manager.py:196` and reject in `start()` when that owner already has an active run, *before* the global cap.

### B4 · Unauthenticated CPU-heavy endpoints share the box with the private solver

- `main.tf:577,594` — `/api/v1/*` is publicly forwarded.
- No `Depends(require_account)` and no rate limit on `routes/recovery.py:57`, `routes/network.py:118`, `routes/playtest.py:79`, `routes/predict.py:21`. The only limiter in the codebase is the `/agent/ask` token bucket (`core/config.py:73-75`).
- `routes/simulator.py:51-57` — `POST /simulator/reset` is unauthenticated and resets the single shared `app.state.engine` for **every visitor**.
- `variables.tf:30-34` — one `t3a.small` (2 vCPU) hosting both containers, `SOLVER_NUM_THREADS=1`.

`docs/verification/audit-resolution-status.md:7` scopes the reset issue to "local tabs"; in production it is global and internet-reachable — the open item understates its blast radius.

**Minimal fix:** reuse the existing `agent.py` IP token bucket on the solver, stress, playtest and reset routes. No new dependency.

### B5 · The private-run map re-downloads and re-hydrates the whole run every 5 s, forever

- `components/workspace/workspace-data.tsx:78` — `refetchInterval:5000`, unconditional. Compare `run-monitor.tsx:14`, which correctly stops via the `active(status)` predicate at `run-monitor.tsx:12`.
- `workspace-data.tsx:83` — `useEffect(…, [run.data])` keys on object identity, which changes every poll, so `hydrateRunResult` (`:70-75`) fires each tick even on a terminal run, calling `setState({schedule, fleet})` and `setUpdate(...)`.
- `routes/runs.py:61` returns the entire `result` (full schedule, aircraft, crew, four plans) plus up to 2000 retained events (`run_manager.py:236-238`) on every poll.

Megabytes every five seconds per open tab against a single-task deployment, plus map state reset on a timer for a run that will never change again.

**Minimal fix:** `refetchInterval: q => q.state.data && active(q.state.data.status) ? 5000 : false`, and key the hydrate effect on `run.data?.status`.

### B6 · Failed destructive account actions leave the modal open with no visible feedback

- `app/app/account/page.tsx:34` — Confirm runs `run(async()=>{ await confirmation?.action(); closeConfirm() })`; when the action throws, `closeConfirm()` is skipped.
- `run()` (`:19`) writes the message into `error`, rendered at `:25` — **outside** the `<dialog>` — and raises a Sonner toast.
- The dialog opens with `showModal()` (`:20`), placing it in the browser **top layer**, which paints above normal-flow content and portaled toasts regardless of `z-index`.

Reproduce: open Rotate key / Revoke key / Revoke session / Change password / Delete account and force a failure (C1 produces a 403 naturally). Modal stays, button re-enables, nothing explains why. Hits every destructive action the work order calls out in §8.5.

**Minimal fix:** move the `role="alert"` node inside the `<dialog>` and call `closeConfirm()` from a `finally`.

---

## P2

**C1 · CSRF token caches `null` permanently.** `lib/api.ts:9-16` — `prepareCsrf` returns early whenever `csrfToken !== undefined`, and both `:12` and `:13` set it to `null`. Every later mutation skips `X-CSRF-Token` (`:25`) → `403 "Refresh your session and retry"` (`account.py:38`), unrecoverable without reload. Triggered by signing in from a second tab. *Fix:* on a 403, reset to `undefined` and retry once.

**C2 · SQLite WAL requested on an EFS/NFS mount.** `main.tf:607-617,640-644` mounts EFS at `/app/apps/api/state`, where all four databases live (`store/repository.py:69-75`, `store/accounts.py:35`, `main.py:245`). `repository.py:89` and `run_manager.py:92` execute `PRAGMA journal_mode=WAL` and discard the result; SQLite documents WAL as unsupported over network filesystems. **Not asserted as broken** — needs a runtime read. *Fix:* log the effective `journal_mode` at startup; stop claiming the "readers never block writers" guarantee at `repository.py:80-82` until it is confirmed.

**C3 · Run history grows without bound on EFS.** `run_manager.py:114-119` persists each run as one JSON blob with the full `input` config (up to 2000 flights / 500 aircraft / 5000 pairings per `scenario_workspaces.py:26-29`), the full `result`, and up to 2000 events. `history()` (`:286-291`) caps the *read* at 500; nothing caps the *write*. No retention, no quota, no `VACUUM`. *Fix:* prune inside the existing startup sweep at `run_manager.py:104-112`.

**C4 · Scenario creation 500s when the canned network fails validation.** `routes/scenario_workspaces.py:131` constructs `ScenarioConfig(...)` inside the route body, so a pydantic `ValidationError` surfaces as an unhandled 500. `main.py:41-44` deliberately falls back to `_minimal_network()`, which supplies no `crew_members` — rejected at `:88`. The documented degradation path breaks scenario creation with an undiagnosable 500. *Fix:* wrap it, return 503.

**C5 · Lazy workspace-repository init is racy.** `routes/scenario_workspaces.py:114-117` does an unlocked `hasattr`-then-assign; `main.py` initialises `run_manager` at `:245` but never this one. Harmless today (per-call connections, `store/scenario_workspaces.py:17-25`). *Fix:* construct it in `lifespan`.

**C6 · Login rate limit is consumed by successful logins and shared with re-auth.** `store/accounts.py:52-63` increments on every attempt, success included, and never clears. `account.py:62` and `account.py:154` share the `email:` scope (limit 8 / 15 min), and the account page routes email change, password change and deletion through `confirm_password` — so ordinary maintenance can lock a user out of sign-in. *Fix:* clear the scope row after a verified password.

**C7 · `origin_guard` production default still allows localhost.** `account.py:22` keeps `http://localhost:3001` and `http://127.0.0.1:3001`, contradicting `docs/account-auth.md:21`. Low exploitability (JSON body required, cookie is `SameSite=Lax`) but a documented requirement the default violates. Folded into A1's fix.

**C8 · Private-run view reports `connected: true` with no socket.** `workspace-data.tsx:88` hardcodes it; `useWebSocket` is only wired in `WorkspaceFeeds` (`:32`). Any indicator reading `useWorkspaceData()` shows a live link that does not exist — against §10.

**C9 · Proxy `OPTIONS` emits no `access-control-allow-origin`.** `route.ts:114-123`, with `:118` an empty entry. Harmless, but advertises CORS support that does not exist. Delete with B1.

---

## Checked and found sound

- **Ownership is enforced in SQL, not Python**, on every private read and write: `store/scenario_workspaces.py:37,41,51` and `run_manager.py:122-123,289` all carry `owner`/`owner_id` in the `WHERE` clause. All six endpoints in `routes/runs.py` pass `account["id"]`.
- **API keys are correctly less privileged than sessions.** `require_account` (key-or-cookie) guards data routes; session/key/password management uses `require_session` (`account.py:42-43`), so a stolen key cannot mint keys, list sessions, or change credentials.
- **CSRF enforced for cookie mutations, correctly skipped for Bearer** (`account.py:36-38`); the proxy forwards `x-csrf-token` (`route.ts:47`).
- **Credential handling:** tokens and keys stored as SHA-256 only, passwords salted scrypt, constant-time compares (`accounts.py:20-27`). `apps/api/Dockerfile:31-32` copies only `src/` and `data/`, so `credentials/credentials.json` (`main.py:211-212`) is not baked into the image; `.dockerignore` excludes `.env`.
- **Private run data does not leak into the public demo cache.** `hydrateRunResult` (`workspace-data.tsx:73`) uses `setState` directly, bypassing the `sessionStorage` writes in `stores/simulation.ts:346-363`. The comment at `:72` is accurate.
- **EFS uid/gid 1001** (`main.tf:244-261`) matches the Dockerfile user (`Dockerfile:34-37`), and `parents[2]/"state"` (`repository.py:69-75`) resolves to the mount path.
- **`service_desired_count` validated to 0 or 1** (`variables.tf:48-57`), matching the single-supervisor constraint at `run_manager.py:81-85`.
- Two suspected crashes ruled out: `_solve_sequence` starts at 1 (`milp.py:150,176`), so the truthiness filter at `run-monitor.tsx:19` is safe; `cancelled_flights` is `list[str]` (`milp.py:87`), so `set()` at `crew_audit.py:35` cannot raise.

## Verification gaps

1. **No runtime evidence at all** — `Bash` was disabled. A1, A2 and B2 each need one HTTP call against the deployed ALB.
2. **Deployed Terraform variable values unknown.** If a domain *is* configured, A2 resolves but A1 still fails unless the domain is literally `olus.sh` or `www.olus.sh`.
3. **C2 needs the effective `journal_mode` read from the running container.**
4. Not covered and not claimed: the 22-event catalog, solver output correctness, accessibility, performance budgets, and F01–F13.

## Suggested repair order

1. **A1 + A2** together — one Terraform edit, two env entries. Nothing private works without them.
2. **B1** — decide proxy vs. direct, then re-point the check scripts so the tested path is the shipped path.
3. **B2, B3** — correctness and multi-tenant fairness at the API boundary.
4. **B5, B6, C1** — user-facing correctness in the private workspace.
5. **B4, C2, C3** — availability and durability.
6. **C4–C9** — robustness and honesty cleanups.