# Olus local k6 evidence — 2026-09-20

This is a local development benchmark, not an AWS capacity claim or a before/after optimization result. No production load was generated. Wisp runtime logs are on the owner's old computer; no Wisp performance measurements were made.

## Environment and scope

- Windows 11 Home, AMD Ryzen AI 9 HX 370 (12 cores / 24 logical processors), approximately 31 GiB RAM. Shared busy host; approximately 1.2 GiB free physical memory at the start, not resource-isolated.
- k6 2.2.0 and Python 3.11 on the same host over HTTP loopback. No WAN, TLS, AWS load balancer, or live external-feed latency.
- One Uvicorn API process; two solver worker slots. Actual application routes, middleware, optimizer, authentication and temporary SQLite databases. Custom lifespan disables external feed polling.
- Dirty development checkout based on `f3a0fd8698aa3200a6dd2a2f2691d6d20db324d7`; neither HEAD alone nor production reproduces this working tree.
- Read fixture: cached 142-flight schedule, no active disruptions. Each VU makes eight sequential GET requests, then sleeps 0.5 seconds. Status checks establish HTTP success, not business correctness of every payload.
- Solver fixture: 50 synthetic flights in 25 independent two-flight blocks, valid crew and independent tails, one mechanical disruption. Not a connected 50-flight airline network. Five-second per-strategy timeout.
- Each measured solver iteration forks a completed owned parent and imposes a 30-minute minimum delay on flight B002. Checks require four feasible/heuristic/optimal strategies with validation pass, the delay preserved, and parent lineage preserved. This is not certification of regulatory completeness.
- Completion timing includes POST acceptance and 100 ms polling until completed. It is recorded only for successful workflows; failure counts must accompany it. One-second think time, where stated, is outside completion timing. Parent setup solve is outside measured workflow timing.

## Results

| Workload | Outcome | Measurement |
| --- | --- | --- |
| 25 VUs, read-only, 60 s | 9,760 requests; zero HTTP errors | 158.82 requests/s; p95 214.94 ms |
| 50 VUs, read-only, 60 s, run 1 | 11,792 requests; zero HTTP errors | 192.71 requests/s; p95 431.49 ms |
| 50 VUs, read-only, 60 s, run 2 | 11,288 requests; zero HTTP errors | 185.01 requests/s; p95 398.07 ms |
| 2 VUs, 30 solver submissions, no think time | 7 completed; 23 rejected; thresholds failed | Successful completion p95 1.91 s |
| 2 VUs, 30 solver submissions, 1 s think time | 29 completed; 1 capacity rejection; thresholds failed | Successful completion p95 1.94 s |
| 1 VU, 30 solver submissions, 1 s think time | 30/30 completed; 90/90 semantic checks passed; zero HTTP errors | Completion p95 1,665.65 ms (1.67 s rounded); submission p95 188.21 ms |

Two 50-VU read runs therefore establish 185–193 requests/s, p95 below 432 ms, and zero HTTP errors across 23,080 requests. These are per-run throughput/percentile bounds, not a pooled percentile. A defensible rounded resume claim is 185+ read requests/s at 50 virtual users, below 450 ms p95, in repeated local k6 tests.

Raw JSON summaries are in `benchmarks/results/2026-09-20/`. The six evidence files from this run are explicitly tracked despite the general results-directory ignore rule. They were measured on the original development checkout, not remeasured on the subsequent release integration.

## Capacity finding

The paced run recorded `409: Solver capacity reached; retry after a running solve finishes`. `RunManager.start` admits at most two workers, with no waiting queue. `_monitor` saves completed status before joining the process and removing its worker entry. Thus a completed result can be visible while its slot is still occupied. This ordering is consistent with rejection immediately after parent setup or a prior completion; the first unpaced run did not log rejection bodies, so its individual rejection reasons were not captured.

Read throughput is not solver capacity. Do not advertise 50 concurrent solver users, 30/30 two-user success, production latency, or a percentage speedup. No production code was changed to obtain these measurements.

## Reproduce

Start from the repository root, using an environment with the API dependencies installed:

```powershell
$env:PYTHONPATH='C:/Users/Khang/aeolus-work/.venv-aeolus/Lib/site-packages;C:/Users/Khang/aeolus-work/apps/api'
py -3.11 benchmarks/k6/local_server.py
```

In another terminal, sequentially, never overlapping workloads:

```powershell
k6 run --quiet --summary-export benchmarks/results/2026-09-20/reads-50vu-repeat.json -e BASE_URL=http://127.0.0.1:18761 -e VUS=50 -e DURATION=60s benchmarks/k6/resume-evidence.js
k6 run --quiet --summary-export benchmarks/results/2026-09-20/solver-50flights-1vu-repeat.json -e BASE_URL=http://127.0.0.1:18761 -e MODE=jobs -e VUS=1 -e FLIGHTS=50 -e ITERATIONS=30 -e THINK_SECONDS=1 benchmarks/k6/resume-evidence.js
```

Stop the benchmark server after completion. It owns only temporary benchmark databases. These scripts deliberately refuse non-loopback benchmark targets.
