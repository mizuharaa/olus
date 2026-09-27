# Full audit resolution status

Updated 2026-09-16. Applies to the current uncommitted workspace, not a production-release certificate. Read alongside `../full-workorder-audit.md`. Status distinguishes repaired regressions, newly implemented backend workflows, and remaining product or verification limits.

| Finding | Status | Change and evidence | Remaining scope |
|---|---|---|---|
| F01 Scenario erased on entry | Fixed, local browser verified | Navigation-only `workspace-handoff.ts` preserves explicit scenario load; real reload clears it. `check-operations-parity.mjs` exercises both. | Anonymous demo reset remains shared across local tabs. Saved scenarios and their runs are now owner-scoped and isolated; they never reset or apply to the public demo engine. |
| F02 Financial detail disconnected | Fixed, local browser verified | Existing RecoveryDetail restored alongside comparison; plan selector, cancellation/delay/reposition costs, impact, EU ETS and returned uncertainty fields. Plan D checked by parity script; financial screenshots at1280/1440. | Display only fields actually supplied by the solver. |
| F03 Search regression | Fixed, local browser verified | Original FlightSearch restored: partial flight, tail, airport and backend lookup. ICAO matching and nullable feed fields hardened. Airport query checked. | All third-party search/provider failure modes not exhaustively tested. |
| F04 Aircraft/path clocks | Fixed, agent tests verified | Shared buffered sampling, observed trail and separate forecast; duplicate selected glyph removed. `check-map-sampling.mjs`, track regression tests, TypeScript, WebGL fallback and `map-soak.json`. | Production hardware FPS unmeasured; destination remains unconfirmed when feed supplies no route. |
| F05 Density/touch targets | Fixed in restored controls | Command rows use density token; comfortable event rows at least44px. Financial ledger rows measured72px. Projection/traffic controls at least44px. | Complete every legacy route typography review separately. |
| F06 Keyboard/tail Gantt | Implemented, local checks | Cascade Enter/Space/arrows/Home/End. Existing keyboard/pointer resize handles restored. Parent workbench adds paired baseline/recovery tail timelines, zoom, synchronized pan, cursor, flight details, swap regrouping and table alternative. `plan-workbench.json` and parity test. | Full keyboard recording and comprehensive assistive-technology review still pending. |
| F07 Missing workflows | Core backend workflows implemented and tested | Owner-scoped SQLite scenario create/edit/save/duplicate/archive/restore; six-step setup; immutable run snapshots, real solver event polling and process cancellation; benchmark history/ranges; real session authentication, profile/preferences and API-key/session management. Same-screen plan explanation/raw data/JSON export retained. `test_scenario_workspaces.py`, `test_run_manager.py`, `test_account.py`, `check-account-integration.mjs`, `check-scenario-integration.mjs`; `dashboard/scenario-integration.json`. | Scenario editing starts from the illustrative Nimbus network: row add/delete/import and drag-to-inject timeline are not built. Regulatory constraints are versioned code, not configurable fake controls. Run progress is actual backend events polled over HTTP. No shadow-price claims. Final integrated production verification remains open. |
| F08 Facts/docs mismatch | Fixed, agent tests verified | Shared `lib/facts.ts`:22 event defaults,4 recovery strategies,1 replay worker. Docs/landing/FAQ import it. CP-SAT terminology and scope corrected; unsupported claims removed. `check-product-facts.mjs` checks Python authority. | Numerical regulatory claims require actual model/source evidence; none implied by proxy views. |
| F09 Proxy legality | Real modeled crew audit implemented | Private run crew audit computes crew-by-rule values, limits, slack, inputs and pass/fail/unknown from the saved crew members, pairings and selected plan. UI provides filtering and expanded derivations. `test_run_manager.py::test_crew_audit_uses_members_and_marks_missing_inputs_unknown` checks the distinction. | These are the rules implemented by the existing model, not comprehensive FAR Part 117 certification. Missing timezone/rest/history inputs remain explicitly unknown. The separate legacy tail-duty proxy stays labeled as a proxy. |
| F10 Landing motion | Fixed in local source/checks | Consistent long-statement wipes; section-owned MotionPath/scrub timing, shadow and occlusion; licensed aircraft render; JS-disabled demo stages/gallery readable. `check-landing-docs-repair.mjs`. | Reference timing fidelity, production performance and requested per-stage recordings not fully certified. |
| F11 Docs/footer utility | Docs fixed; subscription unavailable | TOC/scroll-spy/anchors, Copy+toast, verification/source line, pagination and section numerals. Dead newsletter preview replaced by real docs action. | Email subscriptions need backend destination; status/security/social pages need canonical content. No fake successful signup. |
| F12 Stale checks | Updated | `check-workspace.mjs` now sequences current catalog/parity/commit/reset/tools/accessibility checks. `check-fullscreen-map.mjs` sequences current sampling/soak checks. Additional missing Cancel event action restored instead of removing its regression coverage. | Entire composed suite must be rerun against final production build. Old screenshots/reports are historical, not fresh passes. |
| F13 Split legacy shell/access | Implemented; production tools check passed | Parent unified simulator routes under WorkspaceShell, removed duplicate shell hydration/socket/topbar, expanded command navigation, same-screen crew/plan/brief, resizable operations layers. | Production tools check verified command navigation, one workspace shell, all retained legacy routes returning200, no horizontal overflow at320/768/1280/1440, and one current-document simulation socket. Deep legacy content remains incremental polish scope. |

## Current measured evidence

- `dashboard/event-api-check-current.json`: all22 actual frontend default payloads were accepted by local API; matching event kinds and4 plans returned, affected counts9-113; API reset between cases and at end. This checks request/response integration, not independent optimization correctness.
- `dashboard/operations-accessibility.json`:1280/1440 events/comparison/financial detail; no document overflow; no visible clipped-region-aware non-map control obstruction; financial rows72px; no browser errors.
- Axe findings were limited to `target-size` on overlapping or partly covered geographic Leaflet markers. These findings remain in the JSON. This is **not an axe-clean or WCAG2.2AA certification**. Visible geographic placement and full contact density impose a real target-spacing tradeoff; keyboard/list alternatives must remain available.
- Screenshots: `dashboard/operations-{1280,1440}-{events,compare,finance}.png`.
- `map-soak.json`:6000 synthetic contacts, one traffic canvas, steady DOM sample counts, max one concurrent simulation WebSocket, socket closed on leaving workspace. Local development measurement; not mobile4G or production-M1 FPS proof.
- `plan-workbench.json`: keyboard selection, paired scroll, zoom, actual API explanation, source data and JSON download passed before final table/swap refinements.

## Release gates still open

1. Final production build and composed regression suite; verify actual public deployment SHA/assets independently.
2. Production animation parity and full-page reduced-motion/no-JS evidence after final integration.
3. Full accessibility traversal/recording, geographic target-spacing review and every legacy tool's contrast/density.
4. Actual LCP/CLS/INP on throttled target hardware, production frame-rate and long-session behavior.
5. Remaining interaction limits in F07, regulatory coverage limits in F09, and anonymous-demo multi-tab reset isolation. Owner-scoped saved runs are separate from that shared demo.

No code was committed or deployed by the parity workstream. Do not report all audit requirements complete while the explicit open items above remain.

### Final socket and workflow checks

`check-workspace-tools.mjs` passed against the local production build: cancelling an event cleared backend events/plans; preferences persisted through reload; command navigation reached the legacy crew route; retained legacy routes returned200; viewport widths320/768/1280/1440 had no document overflow.

The earlier socket count of2 was a test-accounting defect: Playwright did not emit the old document's WebSocket close event when reload destroyed that document. An isolated reproduction showed exactly one native OPEN socket in each document. The check now instruments native WebSocket construction per document, asserts one CONNECTING/OPEN socket after reload, and records a maximum ofone across same-document legacy navigation. The revised production check passed; no product socket change was needed for this finding.

`check-scenario-integration.mjs` provisions an isolated temporary account and database, then exercises real sign-in, creation, all six saved setup steps, a changed passenger count, catalog disruption, actual four-plan solver output, and private map navigation. It asserts no public simulator/event mutations. Evidence: `dashboard/scenario-integration.json`, `dashboard/scenario-review.png`, `dashboard/scenario-private-map.png`.

`check-account-integration.mjs` passed sign-in through the Next proxy, HttpOnly session cookie, CSRF refusal, persisted profile, one-time API-key creation, rotation/revocation and sign-out. Credentials are generated in memory for the isolated test. `test_scenario_workspaces.py` additionally checks owner isolation, SQLite persistence, optimistic revision conflict, duplication, archival and rejection of invalid network/crew inputs without changing saved state.

`test_run_manager.py` passed all four tests (3.37s reported by the solver workstream): real spawned CP-SAT progress and owner-filtered persisted history, private apply, process cancellation, modeled crew audit with unknown inputs, and spawn-failure capacity cleanup. `check-run-monitor.mjs` passed UI progress/table/cancel/map-link/unknown-crew/320px checks using mocked responses; the scenario integration above separately checks the real solver handoff. See [run lifecycle and limits](../recovery-run-lifecycle.md). The supervisor currently supports two workers within one API process; multi-process deployment requires coordinated worker ownership.

These checks are local evidence. The final complete production build/suite, public deployment verification and target-hardware performance gates above remain required.


## Integrated verification update ? 2026-09-16

- Full API suite: **146 passed** after backend integration and trust-boundary validation.
- Production frontend build passes. React Leaflet was upgraded from 4 to 5 for React 19 compatibility; opening lazy analysis no longer reinitializes the map. `check-map-lifecycle.mjs` passed on the built server.
- `check-private-run-isolation.mjs` passed: delayed public feed responses cannot overwrite private run results, and committing a plan refreshes the already-open crew audit. Apply/reset completion is also guarded against navigation/account changes.
- Final built-server workbench checks passed: keyboard flight selection, paired timeline scroll/zoom, real explanation endpoint, source data and JSON download. Workspace cancellation/preferences/legacy navigation/single-socket checks passed.
- `check-scroll-motion.mjs` passed against a local production build, with changed computed matrices and all four demo stages. Recording: [production-motion/page@841fccfef365bf0b59f053356b3b19f5.webm](production-motion/page@841fccfef365bf0b59f053356b3b19f5.webm). This proves production-mode local behavior, not the currently public deployment.
- Built-server docs navigation, responsive layout, flyover movement and no-JS demo check passed. Intro top/mid-scroll replay and reduced motion passed before the combined check exposed the dashboard loader mounting behind a failed boot request. The loader was moved outside that gate; the final combined check now passes: top/mid-scroll reload replay, same-node Flip, reduced motion, and bounded dashboard loader without backend.
- Public deployment remains unchanged by this repair pass. Operator credentials must be provisioned explicitly using the documented interactive CLI; no live account or password was invented.

Final rebuilt server: `npm run build` passed; `check-intro-reload.mjs`, `check-map-lifecycle.mjs` and `check-private-run-isolation.mjs` passed again after the loader fix. Local web remains running on http://localhost:3001 and API on http://127.0.0.1:8000.
