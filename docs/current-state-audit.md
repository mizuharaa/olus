# Olus current-state audit

Research checkpoint for UI/UX work order v2. Inspected 2026-09-15, checkout `ui/olus-opening`, commit `f3a0fd8`. No UI changes made during this audit. This is a source audit, not a claim that browser acceptance tests passed.

Reference pack subsequently located at `reference/olus-ui`; all 27 images inspected against root `OLUS_UX_WORKORDER.md`. Keep the local checkout `aeolus-work` and `.venv-aeolus` names to preserve tooling paths; rename shipped identity rather than moving the environment. The root `.impeccable` directory contains configuration, live-server state and an older critique, not the installed skill source. Installed Impeccable guidance and craft floor were loaded; the August critique is historical evidence, not a current test result.

## Ownership and release

- Frontend: `apps/web`; release through Vercel Git integration on `main` only.
- Backend, AWS and AWS deployment workflow remain owned by the Claude pane. Read-only inspection here; coordinate before changing their contracts.
- Historical stale production releases were traced to CLI deployments from an old checkout. That explains previous overwrites, but does **not** prove the cause of the newly reported animation failure.
- Existing modified Hallmark/Playwright logs are unrelated working-tree changes; preserve them.

## Active pages and dependencies

| Area | Current implementation | Finding / disposition |
|---|---|---|
| Landing | `app/page.tsx` → `components/landing/scroll-experience.tsx` | Active sequence: Opening → CinematicSimulatorDemo → RecoveryStory. |
| Opening | `components/landing/opening.tsx` | Existing O-loop mark, Flip intro and hero. Latest user clarification requires the intro to replay on every reload. |
| Laptop | `components/landing/demo/cinematic-simulator-demo.tsx`, `laptop-stage.tsx` | Device pin and independently running four-stage demo. Rework around the requested section-owned sequence after runtime diagnosis. |
| Lower landing | `components/landing/recovery-story.tsx` | Gallery, journey, tech, stats, runway, validation flyover, globe, build log, sky, footer all exist. They are functions in one file, not independent section files. |
| Globe | `network-globe.tsx` → dynamic `network-scene.tsx` | Standalone Three scene, deferred near viewport, hub summaries explicitly illustrative. Existing engine is an audit/reuse candidate; not a reason to retain obsolete visuals. |
| Footer | `recovery-footer.tsx` | Four link groups, large wordmark, email field with an honest “not connected” toast. Newsletter does not save subscriptions. |
| Docs | `app/docs/page.tsx` | Separate old visual language; wind mark, icon badges, small code text, hard-coded claims. No shared facts module. |
| FAQ / 404 | `faq-screen.tsx`, `flight-not-found.tsx` | Existing route implementations to retain and bring onto the unified identity. |
| Product | `app/simulator/*`, `app/scenarios/*` | Existing dense board. Requested `/app/*` hierarchy is not the current shell. Replacement must preserve fetch/types, not the visual components. |

### Dashboard implementation

`app/simulator/page.tsx` combines the map, event injection, cascade timeline, recovery detail, search, context column, comparison, announcements and resizable chrome. This is the concrete source of the “multiple jobs in one viewport” problem. Its map loading label explicitly uses `10.5px`, below the new minimum.

Existing simulator subroutes include carbon, cascade (including flight detail), crew, passengers, plans (including detail/compare), playtest, settings, stress-test and watchlist. The replacement needs deliberate old-route redirects or links so bookmarked plans do not silently disappear.

`DashboardLoader` uses a 4,000ms cap, a 460ms fade and timed phase copy. Its plane icon and old `design-tokens` palette conflict with the unified O mark and 900ms app-loader requirement. Phase text is not reliable evidence of actual load progress.

Keep `stores/simulation.ts`, `lib/api.ts`, `lib/websocket.ts` and their domain types/contracts. API requests use the same-origin `/api/v1` proxy. Websocket configuration can come from an explicit environment URL or `/api/ws-config`; the current socket uses `/ws/simulation`, reconnects after 3s and pings every 25s. Preserve this integration while replacing presentation.

No account sign-in, session-management or API-key rotation implementation was found in the inspected frontend routes or `apps/api/src/routes` search. Provider authentication status in the flight feed is **not** user authentication. These requested account flows require a backend contract, not localStorage pretending to be security.

## Actual animation stack

Package declarations: Next 15.5.18, React 19, GSAP 3.15, Lenis 1.3.25, Three 0.185.1, React Three Fiber 9.6.1, Drei 10.7.7, Framer Motion 11.10, Tailwind 3.4, Sonner 1.5 and Recharts 2.13. `@gsap/react` is not installed. Existing map dependencies include Leaflet/react-leaflet and Mapbox; MapLibre is not the current map implementation.

`components/landing/gsap.ts` is a client module. It registers ScrollTrigger, SplitText and Flip at module scope behind `typeof window !== 'undefined'`. Registration is already present: do not add duplicate registrations as a speculative fix.

`lib/scroll.ts` owns a reference-counted Lenis singleton (`lerp: 0.085`, `wheelMultiplier: 1`, `syncTouch: false`, `autoRaf: false`). Its scroll callback updates ScrollTrigger and the GSAP ticker drives Lenis. It also coordinates R3F frames. Refresh waits for fonts and animation frames, resizes Lenis and refreshes ScrollTrigger, but intentionally avoids refreshing mid-scroll beyond 200px. The required-assets set is currently empty. Development-only debug globals are not evidence that production wiring is missing.

| Construction | Current trigger / range | Current behavior |
|---|---|---|
| Laptop device | root, `top top`, `+=240%` mobile / `+=320%` desktop | pin, pinSpacing, scrub 1.1; inner demonstration also has a time-driven loop |
| Gallery | root, `top top`, `+=400%` | pin inner section, scrub 1; separate non-pinning progress trigger |
| Journey arc | `top 65%` → `center 35%` | scrub .7; SVG point sampling moves plane |
| Tech | `top bottom` → `bottom top` | image yPercent 8 → -8, scrub true |
| Stats heading | desktop, `top 110px` → `bottom bottom` | pin heading with pinSpacing false |
| Runway | `top 50%` → `bottom 80%` | scrub .6; simulated clock 0–1439 minutes |
| Validation plane | `top 60%` → `bottom 15%` | scrub .6, percent translations, power1.inOut; shadow starts .04 timeline units later |
| Sky | `top bottom` → `bottom top` | independent cloud and plane parallax |

The flyover is already scroll-linked, **not a time-only tween**. Its current trigger range and path differ from v2; fix those actual differences rather than repeating the report's hypothetical diagnosis. Its plane/shadow/blur paths also differ, so alignment must be verified at the midpoint.

The reported laptop/gallery collision is not yet root-caused. Source shows separate sequential pins, which is insufficient to prove overlapping trigger ranges. Measure their bounds in production and local production before changing ownership. Likewise, a blank viewport is not yet attributed to a particular spacer.

## Shared design and content defects

- `components/ds/logo.tsx` exports a multi-path wind mark while Opening uses the O loop. Docs import the former: verified identity mismatch.
- Root layout uses Inter and Sonner. Landing CSS, old `lib/design-tokens.ts`, global CSS and docs utility classes currently form competing systems.
- Docs `Section` sets initial opacity 0 through Framer Motion; the header does likewise. This fails the intended progressive-enhancement model when JavaScript does not run. Browser-wide no-JS inspection remains required.
- Docs code blocks use `text-xs`; table rows use `text-sm` and compact vertical padding. Code and prose must move to the new readable scale.
- Docs contain hard-coded `$34B`, `74%`, `18+ hours` and other claims without a shared provenance module. Audit each; do not merely move unsupported numbers into `facts.ts`.
- The currently reused aircraft asset has generated-model provenance from the earlier build. It does not satisfy v2's non-AI geometry requirement. Replace it with a verified clean source and retain provenance/license evidence.
- Remaining `aeolus` strings found under `apps/web` are in the old-storage migration and its regression test. Blind replacement would break migration of existing users' settings; keep the legacy key only as an explicitly documented compatibility input.

## Dead code status

Older landing files such as `flight-intro-stage.tsx`, `final-cta-stage.tsx`, `trusted-by.tsx` and `pricing.tsx` are outside the active top-level landing composition. They are **candidates**, not proven globally dead: search all importers, sandbox usage and shared exports before deletion. Do not delete the whole components directory; live routes share UI and data helpers.

## Implementation checkpoints

1. Finish exact-reference research and show both audit documents (current checkpoint).
2. Diagnose runtime production vs local production; record console/network, section bounds and computed-transform changes. Write `prod-animation-fix.md` only with the actual cause and guard.
3. Loader → pin/blank repairs → grid/reveals/facts → clean flyover → docs/rebrand. Record each requested repair checkpoint.
4. Separate dashboard branch: new shell, overview and map first; show them before remaining routes. Preserve fetching/types and coordinate missing auth contracts.
5. Test keyboard, no-JS landing, reduced motion, clickability, responsive layouts and measured performance. No AA or performance pass is claimed by this audit.

## Repair progress after research

- Reproduced late-pin measurement failure on restored navigation; shared refresh now preserves scroll and remeasures downstream triggers. See `prod-animation-fix.md`.
- Landing/app loaders use shared O mark and black liquid treatment. Landing intro replays on every reload; app has a 900ms CSS deadline and 200ms reduced-motion fade. Fonts/image readiness and schedule readiness drive their respective indicators.
- Demo uses a single 3.5-viewport pin with scroll-controlled recovery stages. Controls are bottom anchored and clear the cookie banner; the regression hit-tests each action.
- Not yet completed: whole-document no-JS/blank-section audit, landing grid/reveals/facts, clean aircraft replacement/flyover retiming, full docs overhaul, favicon/OG sweep, remaining dashboard routes, full accessibility and performance acceptance. No new deployment has been made.

### Dashboard checkpoint
The user reprioritized the dashboard after reporting the unchanged legacy screen. Branch `ui/olus-dashboard-v2` now replaces the `/simulator` entry with `/app/overview`, adds a new dark/light workspace shell and `/app/map`, and preserves data/API types. See `dashboard-checkpoint.md` for actual scope, verification, missing contracts and remaining legacy routes. This is the requested shell/overview/map review checkpoint, not completion of the full dashboard rebuild.
