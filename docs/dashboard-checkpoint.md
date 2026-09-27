# Unified dispatcher workspace - 2026-09-15

Branch: `ui/olus-dashboard-v2`. Local build; no push or Vercel deployment in this pass.

## Workflow correction

The user's latest instruction supersedes the earlier split overview/map design. `/simulator`, `/app/overview` and `/app/map` now lead to the same operational workspace. Events dock, map, affected-flight table and financial recovery dock stay together. Either dock can be collapsed without losing inputs or state. At narrow widths they stack without covering one another.

The shared API/store/websocket remain in use. The event menu comes from `/events/types`, not an invented catalog. All 22 supported types have forms. Applying/reverting a plan waits for `/recovery/apply`; cancellation waits for the API and reloads the authoritative state. Costs, violations, affected flights and actions come from backend responses.

## Fact check and corrections

- `labor_action`: old form submitted `slowdown_pct`, which the model ignored. Shared form now sends `percent_affected`.
- Blizzard, dust, fog and wind-shear controls previously exposed weather measurements that the predictor did not consume. Their forms now expose modeled severity and duration. UI states that this is not detailed weather physics.
- Deicing queue length was not consumed by the live trigger/predictor path. Its form now uses severity and duration.
- Volcanic ash predictor uses a fixed West Coast airport group. Removed the ineffective radius knob and disclosed the fixed model scope.
- Location/duration values also populate the existing constraint payload fields; this does not imply the optimizer implements a full spatial or time-window model.
- The backend optimizes the latest event, not the combined active-event set. The recovery panel explicitly states this limitation.
- `optimal` describes the objective solve, not crew legality. Real local solves returned crew violations. Candidates display the violation count and a prominent warning; applying affects simulation only.
- API/backend source was read and run locally, not modified. These backend limitations need an API-owner follow-up before making stronger operational claims.

## Aircraft and map

A brighter vector basemap uses dark aircraft, blue observed trails and dashed two-minute ground-track projections. Selected flights zoom once, not on every feed refresh. Affected simulated airport-to-airport routes are amber; selecting a table row isolates its route. These lines are schedule connections, not filed flight paths. The live feed does not supply destinations or crew assignments.

Two jitter causes were corrected: the proxy stamped stale positions with fetch time, and stale map symbols returned to their raw fix after extrapolation. The endpoint now uses upstream `now - seen_pos` (adsb.lol response `now` measured in milliseconds). Tracking rejects old/duplicate fixes, caps extrapolation at 15 seconds and freezes there. Trails contain observed samples from the current page session only. Browser tab visibility pauses updates; reduced motion uses raw fixes.

Field semantics reference: https://github.com/wiedehopf/readsb/blob/dev/README-json.md (`seen_pos`, `track`). adsb.lol's actual response timestamp units were checked separately against a live response.

The existing Cesium Air mesh remains available under the selected flight's collapsed generic preview. It is not represented as the observed aircraft type.

## Verification

- Backend existing catalog tests: 31 passed.
- `node scripts/check-flight-controls.cjs`: duplicate/out-of-order observations, stale freeze, reduced motion and form corrections.
- `VERIFY_EVENT_API=1 node scripts/check-flight-controls.cjs`: all 22 event types submitted to the real local backend, each persisted and produced affected flights plus four recovery candidates. Evidence: `docs/verification/dashboard/event-api-check.json`.
- `node scripts/check-workspace.mjs`: native validity of all forms; weather event and solve; server-confirmed Apply/Revert/Cancel; dock controls; preferences and responsive overflow checks. No mocked recovery responses.
- Remaining whole-product v2 requirements are not claimed complete. Legacy specialist routes and account/auth remain outside this dispatcher correction.

Final optimized-build validation: `npm run build` passed; final `check-workspace.mjs` passed against port 3001 including live flight selection, scoped axe AA (zero violations), and 320/768/1280/1440 overflow checks. `check-intro-reload.mjs` passed against the optimized build before the final map-only layout changes. Final screenshots: `unified-recovery.png`, `unified-flight-path.png`. Both the local web server (3001) and local API (8000) remain running.

Local API startup used the installed Python 3.11 with the surviving venv site-packages on PYTHONPATH, because the copied venv launcher still points to the old Windows user directory. No venv files or API source were changed.


## Full-screen operations correction
- The map now fills the available viewport beneath the workspace header. Events, flight details and financial recovery are bounded overlays; expanding the affected-flight tray reserves space in the docks.
- Canvas aircraft clicks use a 24px hit box and open details immediately in view. Selected observations survive missing snapshots and show their observation age.
- Removed position extrapolation/correction. A 30-second measured-fix buffer interpolates motion and freezes at the latest measurement during gaps. Older fixes are ignored. Symbol collision hiding is disabled.
- Selected paths remain highlighted during feed gaps. Solid is locally collected observation history; dashed is explicitly a ten-minute constant-track estimate. No destination, full filed route or crew information is invented.
- Fixed the shared deadReckon helper's fixed three-minute ceiling with an optional horizon; legacy motion callers retain the original cap.
- Checks: check-flight-controls.cjs, check-fullscreen-map.mjs (actual canvas click and dropped poll), check-workspace.mjs (real API trigger/apply/revert/cancel, all 22 forms, axe and responsive checks).
- Production has not been deployed by this correction. Preview remains localhost:3001/app/overview.
