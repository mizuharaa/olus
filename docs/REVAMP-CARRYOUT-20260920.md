# Olus revamp: recovered plan, audit and release handoff

Date: 2026-09-20. Integration branch: `audit/olus-recovery-20260920` in `C:\Users\Khang\pw\olus-recovery`.

## Where the earlier plan lives

The Codex memory index contains no Olus workstream. The surviving checkout does: [OLUS_UX_WORKORDER.md](../OLUS_UX_WORKORDER.md) is the full v2 brief. [Dashboard checkpoint](dashboard-checkpoint.md), [full audit](full-workorder-audit.md), and [resolution status](verification/audit-resolution-status.md) record the subsequent implementation and corrections.

The carried-out sequence was research and audit; production animation/loading/pinned-demo repairs; grid and flyover; docs and branding; dashboard shell and map; scenarios; setup; solve; plan, crew, explanation and comparison; benchmarks; account; accessibility and performance verification.

Later corrections supersede the original split overview/map and delete-everything direction:

- Keep one full-screen operations map with collapsible event, recovery, financial and cascade layers. Preserve working legacy tools.
- Preserve the approved landing design, replay its intro on reload, and keep a readable reduced-motion/no-JS path.
- Keep explicit scenario handoffs when clearing stale localhost state.
- Use real account sessions, private saved scenarios, solver processes and API keys. Label Nimbus and simulation data honestly.

The September 16 report explicitly said the integrated work was **uncommitted and not deployed**. Its test claims are historical; fresh evidence below is separate.

## Why the deployed product was stale

Read-only public checks on September 20 returned **404** for `https://olus.sh/app/account` and for `/api/v1/account/session` through the web proxy. The API `/health` responded successfully, so a healthy service alone did not prove the private product existed.

GitHub recorded the web production deployment at `f1d1160de0c1cb8c2961d9a785d24b2e1ac48e68`; the latest successful AWS workflow was `c051d6b0e579bbb2cf9b9224e645320edf35f430`. These are recorded deployment references, not independent proof of running container bytes.

The current architecture is **Vercel web + EC2/CloudFront API**, defined in `infra/aws`. AWS deployment does not publish the website. The original checkout was still based on `f3a0fd8`, with the revamp in dirty/untracked files. Additionally, the broad `runs/` ignore rule concealed `app/app/runs/[id]/page.tsx` from Git. A successful local build could therefore differ from a clean deployment.

The recovered source was integrated onto current `origin/main` in a separate worktree. The original checkout was preserved.

## Audit findings and repairs

| Priority | Verified issue | Repair |
|---|---|---|
| P0 | Account, scenario and run features remained unpublished; run route was ignored | Recover the complete local implementation onto current main; anchor the root `runs/` ignore; require core routes to be versioned in CI |
| P1 | Deploy pulled mutable `latest`, checked only health status, and did not require CI | Run reusable CI first; deploy the exact commit image; wait for container health; verify API revision and an authentication-required route |
| P1 | Compose environment changes never reached an existing EC2 host | Render and transmit the current compose template on every release, validate it before replacement |
| P1 | Backups copied only the old simulator DB and could miss committed WAL data | SQLite backup API snapshots every state DB; fresh temporary staging; update the scheduled backup through deployment |
| P1 | Successful sign-ins consumed the failure allowance; stale CSRF could block later actions | Clear the email failure counter after password verification; refresh/retry a CSRF rejection once; keep the remote attempt cap |
| P1 | Same-origin Vercel previews failed the backend's separate browser-origin check | Enforce same-origin at the Next proxy; relay cookie/CSRF/auth headers without relaying the browser Origin; direct API origin checks remain |
| P1 | One account could occupy both solver slots | One active solve per owner; terminal/cancelled rows do not falsely trigger the owner guard |
| P1 | Public CPU work could block the API event loop and compete without a bound | Native FastAPI thread dispatch for synchronous heavy handlers; one production public-demo mutation at a time and an existing token bucket; bound playtest input sizes |
| P1 | Account confirmation failures were hidden behind modal top-layer content | Show the error inside the active dialog; avoid duplicate alerts; clear dismissed error state |
| P1 | Provider failure looked like a successful, cacheable empty live map | Return an explicit uncached 503 so the UI retains and marks old positions unavailable |
| P2 | Stale feed readers queued redundant provider refreshes | Share a retained refresh task, enforce freshness/backoff under the lock, return promptly during cold refresh contention |
| P2 | Completed private runs were polled indefinitely | Poll only queued/running runs; preserve explicit apply/refetch behavior |
| P2 | The themed 404 overwrote genuine private resource errors | Preserve application exception detail; retain the themed response for unmatched routes |
| P2 | Invalid starter network produced an opaque server error | Return a descriptive 503 before creating any saved scenario |
| P2 | Recovered backend failed lint/type gates; frontend lint was allowed to fail | Format/fix recovered Python, repair numeric/worker typing, and run the configured Next lint command as a required CI step |
| P2 | Account keys were hard to discover and deployment comments described retired systems | Label the menu and command entry `Account & API keys`; correct active infrastructure documentation |

The independent Claude audit and follow-up are retained in [first review](verification/claude-audit-20260920.md) and [follow-up](verification/claude-followup-20260920.md). They are source reviews, not runtime passes. Initial ECS/ALB/EFS findings were rejected against current-main infrastructure evidence. Its private connection-label finding is not a user-visible false status: the shell already says **Loaded / Saved private run**. Automatic pruning of user run history was not added; retention remains an operator/product decision.

## Fresh verification

- Full backend suite: **163 passed, 1 skipped**. The skipped test explicitly requires a live ADS-B provider. Ruff lint/format and mypy pass.
- Production Next build passes, including `/app/account`, `/app/scenarios/[id]/setup`, `/app/runs/[id]`, benchmarks and the version endpoint. Next lint completes with six existing warnings; this is not a zero-warning claim.
- Real isolated browser account flow passed: sign-in, HttpOnly cookie, CSRF refusal, persisted profile, one-time key creation/rotation/revocation and sign-out. The expanded check passed after a second-tab cookie replacement and a failed delete confirmation.
- Real isolated scenario flow passed: all six steps, edited passenger count persisted, actual four-plan solver result, private map, and no public simulator mutations. [Captured map](verification/dashboard/scenario-private-map.png), [review step](verification/dashboard/scenario-review.png).
- `check-release-boundaries.cjs` passes after the final proxy change: preview-origin validation, rejected foreign origin, cookie relay, transient-session recovery and honest feed failure. It starts no servers.
- Existing product-facts, event-form/flight-control, map-track and WebSocket-lifecycle checks pass. The mechanical UI detector returned no findings for the changed account/menu surfaces; that does not establish visual or WCAG conformance.
- Active Terraform files pass `terraform fmt -check infra/aws`; workflow YAML and rendered compose were parsed and checked locally. Terraform apply and remote SSM execution have not run.

## Open release and product gates

1. **No production deployment in this pass.** The public 404s remain until both web and API receive the reviewed integration. The operator account must be provisioned explicitly; no production credential was invented.
2. Automatic approval review rejected starting the local production web server, including a localhost-only attempt, with only `blocked by policy`. The full composed production browser suite, final mobile layouts, animation parity, keyboard traversal, axe and hardware performance targets are therefore **not certified**. Earlier screenshots and September 16 checks are not fresh passes.
3. Direct AWS inspection is unavailable because the local AWS login expired. GitHub Actions has its separate configured OIDC deployment role, but this turn did not invoke production deployment.
4. Remaining original product scope includes schedule/fleet row add/delete/import, timeline drag-to-inject, comprehensive regulatory coverage, and a real newsletter service. These were documented limitations of the previous implementation, not newly fabricated features.
5. Anonymous demo state is deliberately shared. The concurrency/rate bound limits resource use; it does not create per-visitor demo isolation. Saved scenarios and private runs remain owner-scoped.

After the browser gates and review, release the same revision to Vercel and AWS, then run:

```sh
node scripts/check-release.mjs https://olus.sh https://api.olus.sh EXPECTED_COMMIT_SHA
```

This checks both service revisions, the workspace pages, and unauthenticated refusal on private APIs through both origins. It does not create accounts, keys, scenarios or runs on production.
