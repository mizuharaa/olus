# Follow-up QA — `C:\Users\Khang\pw\olus-recovery`

Confirmed fixed and not re-reported: A1/A2 (`OLUS_ACCOUNT_ORIGINS` + `OLUS_COOKIE_SECURE` now set in `templates/docker-compose.yml.tftpl:17-19`, with `local.cors_origins` at `versions.tf:54` correctly carrying the **web** origins); B1 (Vercel serves `olus.sh` and `/api/v1/*` is a real Next route — no edge rule intercepts it); B2 (`main.py:347` passes through a real `exc.detail`); B3 (per-owner guard, `run_manager.py:154-160`); B5 (`workspace-data.tsx:78` interval now conditional); B6 (error moved inside the `<dialog>`, `account/page.tsx:34`); C1 (`api.ts:10` truthiness + 403 retry at `:38-41`); C6 (`account.py:122,305` clear the email scope on success). Read-only; nothing executed.

---

## P1

### N1 · The container env block is written once at first boot; Terraform can never update it
`templates/user_data.sh.tftpl:20-22` writes `/opt/olus/docker-compose.yml` from cloud-init, which runs **only on first boot** — `compute.tf:70-72` says so deliberately. The deploy workflow's only edit to that file is `deploy-aws.yml:85`, a `sed` on the `image:` line; it ships a new `/etc/cron.daily/olus-backup` (`:88-89`) but never the `environment:` block.

So every value in `docker-compose.yml.tftpl:14-22` — `CORS_ORIGINS`, `OLUS_ACCOUNT_ORIGINS`, `OLUS_COOKIE_SECURE`, `ADSB_PROVIDER`, `awslogs-group` — is frozen at instance creation. Changing `local.cors_origins` (`versions.tf:54`) produces a Terraform diff on `user_data` that never reaches the running process, and `aws_instance` does not re-run cloud-init.

This matters now, not hypothetically: `variables.tf:104-108` `domain_validated` defaults to `false` and is meant to be flipped later, and `local.cors_origins` embeds `local.cloudfront_url`, a value only known after the distribution exists. This is structurally the same failure mode as the original A1 — a setting Terraform believes it owns that never arrives at the process — just moved one layer down.

**Minimal fix:** the SSM step already base64-ships a whole file (`deploy-aws.yml:88`). Do the same for the rendered compose file instead of `sed`-ing one line, or split the env into `/opt/olus/api.env`, reference it with `env_file:` in the compose template, and rewrite that file over SSM.

### N2 · The proxy forwards the browser `Origin` downstream, so every deploy origin must be pre-baked
`app/api/v1/[...path]/route.ts:27-31` already rejects cross-origin state changes by comparing against `req.nextUrl.origin` — a strictly stronger check than the API's. It then forwards `origin` verbatim to the backend (`:47`), where `account.py:35-42` re-checks it against the env allowlist.

`local.cors_origins` enumerates exactly `https://olus.sh`, `https://www.olus.sh`, `https://<dist>.cloudfront.net`. **Any Vercel preview deployment** (`https://olus-git-<branch>-<team>.vercel.app`) passes the proxy's own check — its `nextUrl.origin` *is* the preview origin — and is then rejected upstream with `403 "Origin not allowed"`. Sign-in, scenario save and run start all fail on every preview build, and per N1 the allowlist cannot be widened without rebuilding the instance.

**Minimal fix:** drop `"origin"` from the forwarded header list at `route.ts:47`. `origin_guard` only rejects a *present, non-matching* origin, so an absent header passes; the proxy's same-origin check remains the real guard for browser traffic, and direct callers to `api.olus.sh` still send their own Origin and stay guarded. One word removed, and it decouples the API env from the frontend's hostnames entirely.

### N3 · Cold-start feed contention can exceed CloudFront's origin timeout
`feed.py:80` takes `self._lock` and holds it for the whole provider fetch. `adsb.py:159-168` loops over both providers with `asyncio.wait_for(..., timeout=FETCH_BUDGET_SEC)` and `FETCH_BUDGET_SEC = 45.0` (`adsb.py:48`) — so a failing primary plus a slow fallback is a **~90 s** critical section.

The docstring at `feed.py:56-57` claims "Only blocks synchronously on the very first call". That is true of the gate but not of the lock: while the startup prefetch (`main.py:274`) is inside `_refresh_locked`, `_last_fetch_attempt` is already set, but a request that arrived before it was set fell through `feed.py:75` (`self._last_fetch_attempt > 0` is false at t=0) into `async with self._lock` at `:80` and now waits for the entire fetch — only *then* returning `[]` at `:87-88`.

`edge.tf:41` sets `origin_read_timeout = 60`. A request caught in that window gets a CloudFront **504** rather than the intended fast empty response, and the deploy workflow's health gate (`deploy-aws.yml:130-137`) never touches the feed, so it would not be caught.

**Minimal fix:** before awaiting the lock at `feed.py:80`, return `[]` when the cache is empty and `self._lock.locked()` — the same shape as the existing gate at `:70`.

---

## P2

### N4 · `cancel()` never clears `self.workers`, so the new per-owner guard misfires (introduced by the B3 fix)
`run_manager.py:279-291` terminates the process under `self.lock` but does not remove the entry; only `_monitor`'s `finally` (`:249` region) pops it, and that thread is blocked on `self.lock` for the duration of `cancel()`. The new guard at `:154-160` reads `self.workers` directly.

Result: cancel a solve, then immediately start another from the same account, and you get `RuntimeError("You already have a running solve; wait or cancel it first")` — a message that is now actively wrong, surfaced through `owned_call`'s 409. The obvious user path hits it: Cancel in `run-monitor`, then "Save and run recovery".

**Minimal fix:** `self.workers.pop(run_id, None)` after the join in `cancel()`; the monitor's `finally` already uses `pop(..., None)`, so the double-pop is safe.

### N5 · Two identical `role="alert"` nodes, and the error outlives the dialog (introduced by the B6 fix)
The alert was correctly added inside the dialog (`account/page.tsx:34`) but the page-level copy at `:25` was left in place, both bound to the same `error` state. When a confirmed action fails, **both mount simultaneously** — a duplicated live region that assistive technology announces twice.

`confirm()` now clears `error` on open (`:20`), but `closeConfirm()` (`:21`) does not. So cancelling out of a failed confirmation leaves the page-level alert showing a message with no remaining context about which action produced it.

**Minimal fix:** gate `:25` on `{error && !confirmation && …}` and add `setError("")` to `closeConfirm()`.

### N6 · `.gitignore` protects the retired stack's Terraform lock and ignores the live one
`.gitignore:318-320`:
```
**/.terraform.lock.hcl
!infra/terraform/.terraform.lock.hcl
```
The negation names `infra/terraform/` — the ECS/ALB/EFS stack that main replaced, still present on disk. The live stack's lock, `infra/aws/.terraform.lock.hcl`, exists but matches the exclusion with no negation, so provider versions for the stack that is actually deployed are not pinned for CI or another machine.

Separately, `.gitignore:417` adds a blanket `.env*` after the specific entries at `:9-14`. That also matches `.env.example`, which exists at the repo root and is the only in-repo record of required configuration — `git add .env.example` now silently no-ops for anyone updating it.

**Minimal fix:** change the negation to `!infra/aws/.terraform.lock.hcl` (keep the old one only if that directory is still meant to be usable), and add `!.env.example`.

**Verification gap:** `.gitignore` does not untrack already-tracked files, so both may still be in the index from before these patterns landed. `git check-ignore -v infra/aws/.terraform.lock.hcl .env.example` settles it.

### N7 · The backup staging copy is written inside the volume it snapshots
`backup.sh:4` runs `python -m src.store.backup /app/apps/api/state/backup`, and the compose file mounts `/opt/olus/state:/app/apps/api/state` (`docker-compose.yml.tftpl:26`). So `backup.py:10-16` writes its destination **inside its own `state_dir`**. `snapshot()` survives this only because `is_file()` (`:13`) skips the `backup` directory.

Two consequences. The staging copy sits on the same EBS volume that DLM snapshots, so every nightly snapshot carries a duplicate of every database. And because the staging directory is only ever overwritten by name, a database rename — which `repository.py`'s `aeolus.db` → `olus.db` path explicitly anticipates — leaves the old file in place, and `aws s3 cp --recursive` (`backup.sh:5`) keeps uploading it into each new date prefix indistinguishable from live data.

**Minimal fix:** give the container a second bind mount outside the state volume (e.g. `/opt/olus/backup-staging:/app/backup`) and pass that as the destination. Also add `set -u` to `backup.sh:2` — `$BACKUP_BUCKET` currently expands to empty if `/opt/olus/.env` is incomplete, producing `s3:///state/...`.

---

## P3

- **`feed.py:71`** — `asyncio.create_task(self._do_refresh())` without retaining the task. Documented GC hazard: the refresh can vanish mid-execution. Self-heals after the 60 s gate, so impact is one missed cycle, but the fix is a single held reference.
- **`api.ts:38`** — the 403 retry is keyed on the exact string `"Refresh your session and retry"`, matching `account.py:70`. Reword the server message and the retry silently stops working, with nothing tying the two. A sentinel field on the 403 body, or a shared constant, removes the coupling.
- **`workspace-data.tsx:88`** — still `connected:true` for a private run, which has no websocket (`useWebSocket` is only in `WorkspaceFeeds`, `:32`). Carried over unfixed from the previous report; noting it only because the file was touched.
- **Stale architecture comments in touched paths.** `route.ts:7-11` still describes ECS ("both containers share a task network and use http://127.0.0.1:8000", "The ECS task supplies the latter"), and `api.ts:1-5` still says the proxy "forwards to Railway". Both now describe architectures the repo has replaced — and `variables.tf:98-102` (`railway_api_record_id`) confirms Railway is mid-migration. Misleading comments in exactly the files that carry the trust boundary.