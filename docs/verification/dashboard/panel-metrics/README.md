# Olus panel and recovery metric regression checks

2026-09-27. Isolated local API and actual Edge browser rendering; synthetic Nimbus schedule only.

- Reproduced the Wind Shear editor at 294 x 204 pixels before repair. Events and flight inspectors now resize horizontally; all four window types expand/restore. Recovery and timeline retain height controls.
- Tested mouse and keyboard resize, Escape restoration, reachable trigger/commit controls, 320/390/768/1440 viewports, native input validation, and preservation of event drafts after an API error.
- Verified six comparison metrics for each of four plans across Wind Shear and thunderstorm scenarios (48 cells), plus all eight financial-detail totals against actual solver responses.
- Triggered, confirmed a plan through the UI, reloaded with WebSocket disconnected, and unapplied it. The test suppresses only the localhost-specific clean-boot reset so reload exercises production's persistent-state behavior; simulation data is not mocked.
- REST previously omitted cascade_summary and applied_plan_id. The new regression test failed before adding these fields and passes with the repair. Unknown summary/carbon values display an em dash, while measured zeros remain zero.
- Financial model, predictor and simulation-engine source are unchanged from pre-revamp commit 6b42d0a (`git diff 6b42d0a -- apps/api/src/optimizer apps/api/src/predictor apps/api/src/simulator` is empty). Existing deterministic replay and optimizer checks pass. Live weather/prediction context can vary between solves, so dollar totals from separate uncontrolled runs are not treated as a fixed benchmark.
- Full backend: 165 passed, 1 skipped. Type checks: web OK, mypy 69 files OK. Ruff check and formatting OK. Frontend lint: six existing warnings. Next production build passed; final commit additionally goes through CI.
- Legacy browser health check passed: event cancellation clears server state, preferences persist, command navigation works, nine legacy routes return 200, one concurrent simulation socket, and no page overflow at tested widths. Adapted the existing check to port 5193 and waited for route hydration before assertions.
- Release/session boundary check passed. No live production events were triggered and no copilot request or data was sent to Gemini.

Run from apps/web with an isolated local API on port 8003 and Next on port 5193:

```powershell
node scripts/check-operations-regression.mjs
```

Read checks.json for measured scenario values and viewport dimensions. PNG files show real browser renders. References: Mobbin Linear full-detail and split-detail screens (cef36326-d8ec-4c6f-acd4-a9f1e1060d33, beb9d6b3-ec34-46d7-9332-320fcb32a338), plus the existing Impeccable direction.
