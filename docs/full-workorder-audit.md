# Olus full work-order and feature-parity audit

> Historical audit snapshot. Subsequent fixes and current verification limits are tracked in the [audit resolution appendix](verification/audit-resolution-status.md). The original findings below are preserved as evidence.

Date: 2026-09-16. Checkout: `ui/olus-dashboard-v2`, HEAD `f3a0fd8`, including the current uncommitted workspace changes.

## Verdict

The revamp is incomplete. Restoring the original map and event panel did not restore the complete operations workflow. Financial detail and broad flight search were disconnected, legacy tools remain in a separate shell, and several requested workflows were never implemented. A newly added clean-start reset also erases an explicitly loaded scenario.

This is an audit, not a completion certificate or deployment report. No product fixes, backend changes, commit, or deployment were made as part of this audit. Existing dirty files were preserved.

## Governing requirements

Later corrections take precedence over the original work order:

- Keep the full-screen map. Events, financial recovery, plan comparison and flight detail belong in collapsible layers on that screen.
- Preserve the old simulator's information and actions. A redesign must not substitute a smaller demonstration for working features.
- Replay the landing logo on reload. This overrides the earlier once-per-session instruction.
- Start localhost without stale applied events, while preserving an explicit scenario load.
- Show individual blue aircraft, airport nodes and useful selected-flight paths. Never present an inferred destination as confirmed.
- Preserve the 3D aircraft preview, A/B/C/D plans, cascade information and financial detail.
- Research references through Mobbin; document measured reference values separately from implementation choices.

## Evidence and limitations

- **Runtime:** Edge/Playwright against localhost:3001; 16 route responses, scenario entry, six viewport widths, event-row density, JavaScript-disabled landing inspection. Results: [full-audit-runtime.json](verification/full-audit-runtime.json).
- **Source:** current workspace and landing components, legacy simulator components and the simulator page at HEAD. Source presence alone is not a behavior pass.
- **Earlier checks:** existing feature-parity and verification records. These are historical evidence, not rerun proof for every current feature.
- **Unverified:** live production parity, full accessibility, all 22 disruption outcomes, hardware frame rate, throttled performance budgets and every interactive control.
- Existing [dashboard teardown](dashboard-teardown.md), [current-state audit](current-state-audit.md), [feature-parity notes](dashboard-feature-parity.md) and work order were reviewed. Earlier partial restoration claims must not be read as complete parity.
- Impeccable's static detector was run. Its Space Grotesk warning conflicts with the explicitly requested font and is not counted as a defect. A nearly empty detector report does not prove usability or accessibility.
- No new Mobbin measurements were recovered during this feature audit. Existing research is not a claim of exact animation fidelity. Unknown reference values stay unknown.

## Prioritized defects

### F01 - P0: Loading a scenario into a fresh localhost workspace erases it

**Evidence:** `apps/web/components/workspace/workspace-data.tsx:11` posts `/simulator/reset`; the boot query at line 17 invokes it unconditionally on localhost. `apps/web/app/scenarios/page.tsx` first loads a scenario and navigates to `/simulator`, which redirects to `/app/overview`. The new provider then resets the scenario.

**Runtime reproduction:** Open `/scenarios` in a fresh browser context, click the first Run scenario button, wait for Operations. The resulting control reads `Events 0`. This was reproduced by the audit script.

**Fix:** distinguish an intentional scenario handoff from a fresh clean boot. Do not reset an explicitly loaded scenario. Keep the explicit Reset simulation action.

**Acceptance:** fresh reload clears unwanted previous simulation state; Run scenario preserves that scenario and its events; both work in a fresh context. The reset endpoint is server-side, so its multi-tab/shared-session scope also needs a dedicated check.

### F02 - P1: Financial detail exists but is no longer mounted

**Evidence:** the old simulator page mounted `RecoveryDetail`. The new `components/workspace/overview.tsx` mounts the comparison board but not that component. `components/simulator/recovery-detail.tsx:80` remains in the repo, with cost breakdown at line 113 and uncertainty detail at line 214.

**Lost from the operations screen:** cancellation/delay/reposition cost components, aircraft-swap count, EU ETS cost and expected-cost/regret information. The comparison board's aggregate cost is not a replacement.

**Fix:** reuse RecoveryDetail in a collapsible Recovery detail view tied to the selected A/B/C/D plan.

**Acceptance:** switching plans updates totals and components together; uncertainty fields appear only when returned; committing/unapplying stays accessible without leaving the map.

### F03 - P1: The replacement search removes established search capabilities

**Evidence:** `components/simulator/flight-search.tsx:20` supports partial matches, tail, airports and backend `/flights/search` lookup. It is not mounted in the new workspace. The overview toolbar uses exact local identifiers instead.

**Fix:** reuse the existing search component and its selection behavior; preserve airport, tail, partial flight and live search.

**Acceptance:** each supported query can locate a flight, open its detail, and highlight it without resetting map state.

### F04 - P1: Selected paths and aircraft use different position clocks

**Evidence:** `components/simulator/flight-map.tsx:1740` uses buffered track position, while the selected live path around lines 1815-1835 uses dead reckoning from the latest raw observation, potentially projecting up to 300 seconds. The refresh tick around line 1417 is five seconds.

**Impact:** the path origin can diverge from the rendered plane. The code does not establish continuous movement simply because a track buffer exists. The selected inferred path is also not the requested full observed trail.

**Fix:** use one sampled position/time for the selected aircraft, trail endpoint and direction estimate. Render stored observations as observed history; retain explicit labeling for inferred heading/destination.

**Acceptance:** selected path remains attached during repeated feed updates; no backward jump from mixing clocks; stale data is labeled; unknown destinations stay unknown.

### F05 - P1: Comfortable density does not enlarge event rows

**Evidence:** `components/simulator/event-panel.tsx:1057` renders cmdk items, not buttons. Workspace event sizing targets buttons and misses those rows. Runtime Weather Closure row height is **30px in Comfortable and 30px in Compact**.

**Fix:** apply the shared density row token to actual command/list rows. Cover legacy controls reused inside the workspace.

**Acceptance:** Comfortable event rows meet the requested minimum 44px. Map/Globe controls currently measure 34px, header controls 40px and Hide live traffic 37.5px; review these against the product target too. These measurements alone are not a WCAG 2.2 failure declaration.

### F06 - P1: Cascade timeline remains mouse-only and is not the requested plan Gantt

**Evidence:** `components/simulator/cascade-timeline.tsx:276` uses clickable div rows without keyboard equivalents. Its viewport at line 223 hides horizontal overflow.

**Missing:** keyboard block navigation, tail-by-time plan rows, explicit pan/zoom, time cursor and synchronized baseline/recovered comparison.

**Fix:** retain the useful cascade timeline, make existing selection keyboard-accessible, and expose the requested plan timeline as another operations layer. Do not discard cascade information to add it.

### F07 - P1: Requested workflows are absent, not merely hard to find

**Evidence:** the new app route tree contains Operations and Map, with no implemented six-step setup, live solver workspace, account or benchmarks screen. Runtime returns 404 for `/benchmarks`, `/app/account`, and representative setup/solve/explain URLs. Exact route spelling is not itself the issue: later instructions prefer same-screen layers, but the capabilities are absent there too.

**Missing capabilities:** guided schedule/fleet/crew/constraints/disruptions/review, live objective trace and safe cancellation, complete explanation/what-if workflow, scenario duplicate/archive management, account/session/API-key management and benchmark range comparisons.

**Fix:** add capabilities around existing data contracts. Do not fabricate solver progress, shadow values, authentication or key management to satisfy a visual mockup. Coordinate backend needs with its owner.

### F08 - P1: Docs and marketing do not share a factual source

**Evidence:** `app/docs/page.tsx:104` labels the optimizer MILP, while its own architecture and landing identify CP-SAT. `components/landing/recovery-story.tsx` hard-codes stats. No shared `facts.ts` exists. Docs contain numerical claims and crew tables directly in JSX.

**Fix:** trace each claim to code or a documented source, centralize factual product counts, and align solver terminology. This audit does not establish that every existing number is false or legally validate the crew tables.

### F09 - P1: The legality ledger is explicitly a proxy, not the requested crew audit

**Evidence:** `components/simulator/crew-legality-ledger.tsx:1` describes an aircraft-rotation proxy; line 24 defines a fixed 13-hour FDP. Computation groups the schedule by tail.

**Gap:** this cannot serve as every crew member by applicable rule, with inputs, limits and remaining slack.

**Fix:** keep proxy labeling, retain legacy crew tools, and build the full audit only from actual crew/rule results. Do not relabel this proxy as regulatory verification.

### F10 - P1: Landing motion requirements remain only partially applied

**Evidence:** long statements in `components/landing/recovery-story.tsx` remain plain paragraphs; the gradient wipe is not a house device on every long statement. Its fly-over trigger is `top 60%` to `bottom 15%`, not the specified `top bottom` to `bottom top` mapping. It uses transform interpolation rather than the specified MotionPath construction.

**Fix:** apply the shared reveal consistently; align aircraft midpoint with section progress and verify visually. Existing shadow/blur are present. Aircraft asset quality and provenance require separate inspection; this audit does not label it AI-generated.

### F11 - P2: Docs utility features and footer are unfinished

**Evidence:** `app/docs/page.tsx:28` CodeBlock renders a pre without Copy; no completed TOC scroll-spy, verification date or prev/next flow. `components/landing/recovery-footer.tsx` explicitly says updates are not connected and its form shows a preview toast.

**Fix:** implement docs utilities; connect a real newsletter endpoint before calling email capture complete. Add requested status/security/changelog/social destinations only when they exist. The current preview disclosure is honest.

### F12 - P1: Existing checks cannot certify the rebuilt workspace

**Evidence:** older `scripts/check-workspace.mjs` selectors expect an earlier map marker, Events label and event select, rather than the current original-panel integration. A successful old report is not a pass for today's DOM or behavior.

**Fix:** update checks around actual user outcomes: load scenario, search, inject, compare four plans, inspect costs, commit/unapply, reset, keyboard selection and reconnect. Keep performance/production checks separate.

### F13 - P2: Legacy tool access survives, but the shell and information hierarchy split

**Evidence:** `/simulator/*` tools retain `app/simulator/layout.tsx` and the old rail. The new palette lists only Operations. Original resize behavior is not used by the new fixed-size comparison/timeline layers; the old rail's OpsBrief is not integrated into the new screen.

**Fix:** preserve all tools and reuse their content where same-screen access matters. Restore useful resizing and meaningful navigation before another visual rewrite.

## Requirement matrix

Status: Present = source exists, not a blanket runtime pass; Partial = incomplete; Missing = no implementation found; Regression = previously available behavior lost/broken; Unverified = requires further proof; Superseded = later instruction replaces it.

### Research, branding and system

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Reference folders and work order | Present | Root work order and reference/olus-ui exist |
| Mobbin reference research | Partial | Existing teardown docs; no proof every full flow/value recovered |
| Exact reference motion measurements | Unverified | Do not replace unavailable values with estimates |
| Impeccable review | Present | Audit guidance and detector used; usability findings above |
| Shared Olus mark | Partial | Shared logo exists; full asset/use-site sweep outstanding |
| Continuous SVG draw and fill | Partial | Opening implementation exists; asset variants not fully audited |
| 32/48/512 icons and 1200x630 OG | Unverified | No complete export/dimension verification in this audit |
| All shipped Aeolus references removed | Unverified | Complete shipping/env/docs sweep not certified |
| Local directory/venv renamed | Superseded | Leave path names intact per later migration guidance |
| Semantic palette only | Partial | Workspace scoped tokens; legacy tools still diverge |
| Type, radii and shadow discipline | Partial | Density failure; exhaustive CSS token audit outstanding |
| Central stacking scale | Partial | No complete overlap/click proof |
| Tailwind v4 and useGSAP stack | Partial | Current package uses Tailwind 3; GSAP context patterns exist |

### Landing and docs

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Production animation root cause and guard | Unverified | Existing prod-animation-fix doc; current deployment not retested |
| Black logo loader and liquid aura | Present | Opening and shared LoadingAura |
| Real loading progress | Present | Fonts/images loading inputs; not an invented feed connection |
| Replay logo on reload | Present | Opening replay path; existing focused reload check |
| Once-per-session loader | Superseded | Latest request requires reload replay |
| Flip into centered nav without glitch | Partial | Implementation exists; current multi-width recording needed |
| Skip and reduced-motion loader | Present | Skip/fade path; exhaustive preference test outstanding |
| Dashboard loader <=900ms | Unverified | Loader exists; actual timings not measured here |
| Hover mega-panel morph/reveal | Present | landing-nav with dialog and transition handling |
| Hero unmask/scale/radius | Present | Existing landing timelines; deployed behavior unverified |
| MacBook four-stage demo / one pin | Present | Existing 3.5 viewport pin; overlap regression not rerun here |
| No blank viewport with JS off | Partial | 11 headings visible; demo text screens retain opacity zero |
| Shared grid and consistent rails | Partial | No full screenshot alignment measurement |
| Long-copy gradient wipe everywhere | Partial | F10 |
| Pinned horizontal gallery | Present | Gallery timeline and cards |
| Journey panel and recovery timeline | Present | Recovery story composition |
| Tech parallax and spec list | Present | Recovery story tech section |
| Two-tone stats and thumbnail | Present | Current stats composition restored |
| All figures sourced from facts.ts | Missing | F08 |
| Vertical runway/scroll aircraft | Present | Recovery story runway section |
| Fly-over correct timing and model | Partial | F10; shadow/occlusion present |
| Dot-map to sphere | Present | network-scene shader mixes flatPosition and sphere |
| Globe drag/inertia/hover/selection | Present | network-scene quaternion and interaction paths |
| Scroll velocity affects globe planes | Present | network-scene render loop |
| Globe instanced planes and arcs | Present | Low-poly airframe layer and route trails |
| Globe 60fps on target hardware | Unverified | No target hardware measurement |
| News/build-log stagger | Present | Section exists; exact reference fidelity unverified |
| Sky interlude | Present | Section exists |
| Complete footer and newsletter | Partial | F11 |
| Toast lifecycle, ARIA and pause | Unverified | Toast system exists; all variants not exercised |
| FAQ search/category/deep links/keyboard | Present | faq-screen handlers and accordion |
| 404 split-flap/arc/pointer aircraft | Present | flight-not-found motion and fallback |
| Docs mark/grid/type consistency | Partial | Mark reused; legacy typography/utilities remain |
| Docs replace badges with mono numbering | Missing | Section icon badges remain; not evidence they are AI-generated |
| Docs TOC/copy/anchors/pagination/date | Partial | Anchors exist; F11 |
| Motion spec complete and current | Partial | Existing doc; not reconciled to every current timeline |
| Recordings after phases 2-6 | Unverified | No complete current recording set established |

### Full-screen operations and map

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Full-screen map retained | Present | Original FlightMap mounted in Operations |
| Events/recovery/details collapsible together | Present | Workspace layers; complete collision pass pending |
| Old disruption catalog preserved | Present | Original EventPanel and event forms restored |
| Every event actually applies correctly | Unverified | All 22 forms/outcomes not executed in this audit |
| Reset button | Present | Explicit Reset simulation action |
| Clean localhost startup | Regression | Clears stale state but also intentional scenario, F01 |
| Clear high-contrast basemap | Partial | Light map restored; all overlay contrast unmeasured |
| Blue individual aircraft, no clustering | Present | Canvas traffic layer; no density aggregation required |
| No duplicated world | Partial | Prior focused world-map check; current zoom-range recheck pending |
| No accumulated sockets/render layers | Unverified | Earlier bounded DOM/socket check; sustained soak needed |
| Smooth non-glitching positions | Partial | F04 |
| Airports and hub/focus/spoke nodes | Present | Original map layers restored |
| Airport selection information | Present | Original airport detail; exhaustive runtime check pending |
| Selected flight complete detail | Partial | Scheduled/live detail retained; available data differs |
| Confirmed origin/destination | Partial | Available for schedules; must not invent live route metadata |
| Observed trail and heading estimate | Partial | F04; buffer is not itself a rendered trail |
| Paths reflect disruption and recovery | Present | Original cascade/cancel/swap styling; all plan cases unverified |
| Weather/FAA/event layers | Present | Original map capabilities retained |
| Legend and live-traffic visibility | Partial | Controls restored; actual hide/render consistency needs soak |
| Search flight/tail/airport/partial | Regression | F03 |
| 3D aircraft on selection | Present | Generic airframe with rotation/pause |
| Type-matched model set | Missing | Generic model is not narrowbody/widebody/regional matching |
| Live bottom flight ticker | Missing | Cascade layer is not the requested active-flight ticker |
| Street-level vector map | Partial | Original Leaflet map used; installing MapLibre is not implementation |
| WebGL fallback and hidden-tab pause | Unverified | Separate map/globe/preview paths need combined check |

### Recovery and retained legacy functionality

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| A/B/C/D plan selection | Present | PlanCompareBoard and map preview |
| Preview without committing | Present | Selection separate from applied plan |
| Commit / unapply | Present | Existing original-operations focused check; not rerun here |
| Aggregate financial comparison | Present | Comparison matrix |
| Cost component detail | Regression | F02 |
| Swap counts, EU ETS, regret band | Regression | F02 |
| Changed-flight list | Present | Comparison board |
| Manual panel resize | Regression | Old useResizable integration no longer used |
| Cascade timeline | Partial | Exists; F06 |
| Complete keyboard plan Gantt | Missing | F06 |
| Synced baseline/recovery Gantt | Missing | Legacy comparison route is not this implementation |
| Crew legality tools | Partial | Legacy route retained; full per-rule audit absent, F09 |
| Passenger analysis | Present | Legacy route returns 200; functional behavior not certified |
| Carbon analysis | Present | Legacy route returns 200; functional behavior not certified |
| Watchlist | Present | Legacy route returns 200; persistence not exercised |
| Stress test | Present | Legacy route returns 200; not benchmark analytics |
| Playtest | Present | Legacy route returns 200 |
| Settings | Present | Legacy route returns 200; new account workflow absent |
| Ops brief | Partial | Old rail implementation retained, not operations integration |
| Legacy counterfactual explanation | Partial | Existing plan detail is not the full requested Explain workflow |

### New workflows and quality gates

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Scenario library | Partial | Existing cards; F01 blocks fresh workspace entry |
| Create/duplicate/archive/compare scenarios | Missing | Full management flow not found |
| Six-step scenario setup | Missing | F07 |
| Visual drag disruption window | Missing | Existing form does not implement timeline injection |
| Live solve objective trace/log/cancel | Missing | F07 |
| Global solving toast | Unverified | No completed live-solve lifecycle established |
| Full Explain/what-if/objective waterfall | Missing | Must use actual solver outputs |
| Benchmarks date/comparison controls | Missing | Route 404; F07 |
| Auth sign in/session/sign out | Missing | No complete requested auth flow found |
| Account/API keys/session revoke | Missing | F07 |
| Theme/density settings | Partial | Dark/light available; legacy rows ignore density |
| System theme/timezone preference | Partial | Full account preference flow absent |
| Command palette navigation/actions | Partial | Operations-only navigation inventory |
| Empty/loading/error/partial for every panel | Partial | Feed errors exist; all requested panels/states not built |
| Keyboard, focus return, drawer traps | Partial | Timeline failure; full traversal not recorded |
| Charts with captions and table alternative | Unverified | No complete chart accessibility audit |
| No blocked buttons at1280/1440 | Unverified | Width check does not exercise all controls |
| No horizontal overflow | Runtime pass, limited | Operations document at320/768/1280/1440/1920/2560 |
| Comfortable rows >=44px | Fail | Runtime30px event rows |
| Body >=14px dashboard /16px marketing | Unverified | No exhaustive computed-font census |
| Full axe/WCAG2.2AA | Unverified | No full current axe audit |
| LCP<2s /CLS<.02 /INP<150ms | Unverified | No prescribed throttled-device measurement |
| Production matches local | Unverified | Current audit is localhost only |
| Full first-time dispatcher flow | Fail | F01 plus missing workflow capabilities |

## Runtime results and how to repeat

From `apps/web`, with local web/API services running:

```powershell
node scripts/audit-full-workorder.mjs
```

This script intentionally loads a local scenario through the UI. It is a diagnostic recorder, not a passing acceptance suite: inspect the JSON for failures and findings.

Observed:

- 11 existing URLs returned 200; five requested workflow URLs returned 404.
- Scenario load into a fresh workspace ended with Events 0.
- Comfortable and Compact event rows both measured 30px.
- No document horizontal overflow at the six tested widths. This does not rule out overlapping panels or clipped controls.
- No pageerror was captured in that run. This does not prove all interactions work.
- All 11 landing headings remained visible without JavaScript. Several MacBook demo screens retained zero opacity; a complete readable fallback was not demonstrated.
- An unnamed26px button in the raw measurements may be development UI; it is excluded from product findings.

## Repair sequence

1. Fix scenario handoff versus clean boot; cover fresh reload, explicit scenario load and reset in one runnable regression check.
2. Restore RecoveryDetail and FlightSearch using their existing implementations; keep them inside collapsible operations layers.
3. Unify aircraft/path sampling and expose observed history without pretending inferred airports are confirmed destinations.
4. Fix event density, timeline keyboard access and panel resizing; verify actual clicks and focus at1280/1440.
5. Run the event catalog against real local API behavior and compare plan preview, commit, unapply, cost components and map changes.
6. Fill missing dispatcher workflow capabilities using real backend contracts, preserving all legacy analysis tools.
7. Resolve docs/facts and remaining landing motion gaps.
8. Complete accessibility, no-JS, reconnect/soak and performance checks; then separately verify the production deployment.

Do not start another visual replacement before this parity ledger is satisfied. A component being present in the repository is not evidence that users can reach it, and a screenshot is not evidence that its actions work.

## Resolution appendix — landing, docs and account (2026-09-16)

- F08 / docs and facts: shared `lib/facts.ts` is checked against the event registry and recovery objectives by `scripts/check-product-facts.mjs` (PASS). Docs now describe CP-SAT accurately, distinguish modeled crew checks from complete regulatory certification, share the Olus mark, and include TOC scroll-spy, anchors, real clipboard copy/toasts, source verification date and page links.
- F10 / landing motion and fallback: long statement gradients use scoped ScrollTrigger timelines; fly-over maps section progress to its path midpoint with a lagging shadow and local text blur. Aircraft uses a reproducible render of the licensed Cesium model. MacBook has a complete four-stage no-JavaScript narrative and the gallery releases into normal flow without JavaScript. Logo reload replay remains intact. `scripts/check-landing-docs-repair.mjs` PASS: clipboard, TOC, 320px overflow, changed fly-over transform and no-JS fallback.
- F11 / brand and content: shared open-O favicon sizes/manifest/OG image are present. Fake newsletter submission was removed; the footer links to real documentation. No social/security/status destination was invented.
- Private account flow now exists at `/app/account`: operator-provisioned sign-in, persisted profile/preferences, session list/revocation, one-time API keys with rotation/revocation, password/email reauthentication and account deletion. No localStorage identity. Account responses are no-store; HttpOnly sessions require CSRF for mutations. React Query cache is cleared when identity changes.
- Evidence: `tests/test_account.py` has four passing isolated backend cases. `scripts/check-account-integration.mjs` PASS through an isolated real Next proxy: sign-in, HttpOnly/Lax cookie, CSRF rejection, profile persistence, key rotation invalidating the old key, key revocation, sign-out. No production account was provisioned by these checks. See `docs/account-auth.md` for deployment and provisioning requirements.

Remaining scope is explicit: detailed commercial-airliner asset provenance is unavailable, so the fly-over is a licensed generic turboprop; newsletter delivery, avatar storage, verified-email/password-reset delivery and self-service registration are not implemented. No claim is made that full WCAG 2.2 AA, real-device M1 60fps, mobile LCP/CLS/INP budgets or production parity have been certified by these focused checks. Account deployment requires a persistent protected database and operator provisioning; code alone does not create production access.

### Leaflet lifecycle correction

The workspace runs React19 but had react-leaflet4.2.1. Its MapContainer ref callback closes over the initial null context and can initialize the same DOM node again after a Suspense/ref reattachment, throwing `Map container is already initialized`. Upgraded the existing dependency to react-leaflet5.0.0/core3. The official v5 package declares React19 peers and its MapContainer uses a synchronous instance ref to guard initialization. Analysis tools also have a local Suspense boundary so loading them does not hide and reattach the whole workspace. No map visual behavior was changed.

Sources: https://github.com/PaulLeCam/react-leaflet/blob/v5.0.0/packages/react-leaflet/src/MapContainer.tsx and https://github.com/PaulLeCam/react-leaflet/blob/v5.0.0/packages/react-leaflet/package.json . Regression: `node scripts/check-map-lifecycle.mjs` opens/closes both analysis tools and asserts one unchanged Leaflet instance and zero page errors; it must be run against the rebuilt server.
