# Private recovery runs

Saved scenarios start through `POST /api/v1/runs` with `{scenario_id}`. Authentication and scenario ownership are required. The worker receives a copied schedule, fleet, crew, disruptions, timeout, and cached weather snapshot. It constructs its own simulation engine; it never applies plans to the shared demonstration engine.

## Lifecycle and routes

- `GET /runs/{id}`: recorded state and actual worker events; other owners receive 404.
- `POST /runs/{id}/cancel`: terminates the worker process, preserving its terminal history.
- `POST /runs/{id}/apply`: applies or clears a returned plan only in that run's stored result.
- `POST /runs/{id}/explain`: derives explanations from that run's inputs and plans.
- `GET /runs/{id}/crew-audit`: computes existing modeled rules from actual crew assignments and times; missing inputs are unknown.
- `GET /benchmarks`: owner-scoped persisted history, with explicit-offset date filters normalized to UTC and a 500-run response limit.

The application owns one `RunManager` for its lifetime and closes it on shutdown. SQLite retains completed results and interrupted-run history. Each solver uses a spawned process so cancellation stops computation. Two workers are allowed per API process. Deploying multiple API processes against one database requires a shared work queue and leases first. This is a documented deployment ceiling, not a distributed scheduler.

CP-SAT callbacks report model constraint count, feasible incumbents, objective value, bound, and measured elapsed time. Objective values are only comparable within the same model. No progress percentage or fabricated convergence curve is produced. The most recent 2,000 progress events are retained; omitted-event counts are exposed. The input fingerprint excludes generated event IDs and timestamps.

## UI

`/app/runs/[id]` displays progress, cancellation, an accessible objective-value table, and returned plans. The workspace toast keeps an active run observable after navigation and clears on identity changes. `/app/overview?run=id` is the private result view. `/app/benchmarks` compares recorded windows. Private result integration is owned by `WorkspaceData` and must not attach shared simulator feeds.

## Scope and evidence

The crew audit is an explanation of the repository's existing simplified model, **not complete FAR Part 117 certification**. Missing timezone/rest inputs remain unknown, and no crew reassignment is invented. Existing optimizer fallback plans remain labeled by their actual statuses.

Runnable checks:

```text
pytest apps/api/tests/test_run_manager.py -q
node apps/web/scripts/check-run-monitor.mjs
```

The backend check covers a real spawned solve, emitted incumbent events, input fingerprint, owner isolation, isolated apply/clear, durable history, actual process cancellation, spawn failure cleanup, and crew derivation. The browser check uses labeled mocked responses to verify progress/table/cancel/result/audit behavior and a 320px layout; it is not an end-to-end production solver benchmark.
