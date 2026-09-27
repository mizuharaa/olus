# Layout QA — olus-recovery workspace geometry (read-only, source inference)

**Method:** static reading of the changed files against `docs/OLUS-UI-PROMPTS.md`. **Nothing here was reproduced at runtime** — no server, no browser, no screenshots. Every finding below is cascade/geometry inference from source. Also note: `operations.module.css` changed *underneath me mid-review* (`.layerMode` moved from line 95 → 98, `.comparison` gained `display:flex`), so line numbers are a snapshot of the file as of this pass.

---

### 1. Light theme: status bar is dark-on-dark (highest confidence)
`apps/web/components/workspace/workspace.module.css:83` sets `.feedline{background:var(--ink-900)}`. The new shared-rail block at `:151` only overrides `padding-inline`/`max-width`, not `background`. The header's equivalent hard-coded `--ink-900` *was* fixed (`:129` `background: var(--field)`); the feedline was missed.

In `[data-theme=light]` the bar therefore stays `#05070A` while its text is `color:var(--secondary)` → `--ink-500` `#27323F` (≈1.5:1), and `.workspace[data-theme=light] .good` (`:7`) is `--text-inv` `#0A0E14` — effectively invisible. Contract §"Every component has … states" + the theme-switch step in §7.

**Smallest fix:** add `background: var(--field);` to the `.feedline` rule at `workspace.module.css:151`.

### 2. Light theme: selection states forced to a dark surface
`workspace.module.css:112` redefines `--ae-surface-3: var(--ink-600)` on `.workspace` for *both* themes, discarding `globals.css`'s per-theme values (light `#D3C4A4`, dark `#2D3342`). `--ink-600` (`#1A222D`) is never re-declared in the `[data-theme=light]` block (`:3`).

Consumers: `operations.module.css:61` (`[cmdk-item][data-selected=true]` background), `:106` (`.ae-cmd-item[data-selected-kind=true]` background, `!important`), `:8` (`--ae-raised`). In light theme these paint a dark-navy row whose text is `--ae-text` → `--foreground` → `--text-inv` `#0A0E14`. Selected disruption rows become unreadable; `:107`'s `::after{content:"Selected"; color:var(--foreground)}` has the same problem.

**Smallest fix:** one declaration in the light block, `workspace.module.css:3` → add `--ink-600: var(--bone-100);`. (Fixes `:8`, `:61`, `:106`, `:107` at once — root cause, not per-call-site.)

### 3. `.events` / `.inspector` overlap after a viewport resize
`operations.module.css:117-119` puts both panels in `grid-column:1; grid-row:3` at ≤1099px, `width:min(380px,100%)`, inspector `justify-self:end`. Mutual exclusion is enforced only in JS at *click* time — `overview.tsx:35,36,42` all gate on `innerWidth<1100`. Nothing re-evaluates on resize, so dragging 1440→768 with a flight selected and Events open leaves both mounted: at 768px content width is 736px, two 380px panels overlap by ~24px, and the right panel wins the hit test over the left panel's controls.

Contract §2 says "Below 900px show one side panel at a time" — the CSS implements the column collapse but not the exclusivity.

**Smallest fix:** inside the `@media (max-width:1099px)` block, `.console[data-events=true] .inspector{display:none}` — CSS enforces what the JS already intends, no listener needed.

### 4. `check-workspace-layout.mjs` cannot fail on the resize case it is meant to cover
The check (`apps/web/scripts/check-workspace-layout.mjs:17-65`) only ever calls `setViewportSize` *before* opening panels, and every panel interaction re-opens from a clean state at each width. It therefore asserts panel separation (`:39-40`) only for states the JS guards already guarantee — `assert.equal(compared.events,null)` at <1100 passes because the Recovery click itself closed Events. Finding 3 is invisible to it. Similarly `:50` asserts the inspector against `m.preview.bottom` where `m` is the *pre-interaction* measurement, not a fresh one.

This is a false-negative surface, not a false positive: the script's `PASS` line at `:68` claims "panel separation" coverage it does not have.

**Smallest fix:** after the inspector opens at a wide width, `await page.setViewportSize({width:768,height:900})` and re-assert `events`/`inspector` non-overlap before closing.

### 5. `check-workspace-layout.mjs` hard-depends on 4 pre-existing recovery plans
`:26` dereferences `m.preview.y`, where `preview` is `box('[aria-label="Map recovery preview"]')` — the plan switcher, rendered only when `recoveryPlans.length>0` (`overview.tsx:43`). `:33-36` then waits for ≥6 `[role=row]` inside `[aria-label="Financial recovery"]`; with no plans the panel renders `s.empty` (`overview.tsx:46`) and that wait times out.

It happens to work only because `check-scenario-integration.mjs:30-31` enters via `/app/overview?run=<id>` with a solved run. Invoked on the plain demo route it throws `TypeError: Cannot read properties of null` at `:26` — a crash that reads as a layout regression.

**Smallest fix:** at `:26`, guard — `if(m.preview) assert.ok(m.preview.y>=m.toolbar.bottom+7)` — and skip the Recovery block when `m.preview` is null.

### 6. Large stale legacy geometry block is dead, not overriding — but obscures review
`workspace.module.css:30-108` is the previous absolutely-positioned map chrome (`.operations`, `.dock`, `.selectedFlight`, `.opsHeading`, `.mapToolbar`, `.impact`, `.opsStrip`, `.mapLegend`, `.panelControls`, `.layers`). I grepped every `styles.*` consumer: the only file still referencing those classes is `apps/web/components/workspace/flight-context.tsx`, and `ScheduledDetails`/`AirportDetails` are **imported by nothing**. So these rules do not currently fight the new `operations.module.css` grid.

They do, however, still cascade over live classes through duplicate `.header`/`.feedline`/`.main`/`.nav` declarations (`:77-108`), which is exactly how findings 1 and 2 survived — the "fixed" value at `:129` sits ~50 lines after a stale one at `:77`, and a reader checking only the new block at the bottom sees a correct file.

**Smallest fix:** none required for correctness; I did not delete pre-existing dead code. Flagging only: `flight-context.tsx` and `workspace.module.css:30-108` are removable in a separate cleanup, and doing so would make the remaining theme bugs visible by inspection.

---

### Checked and clean (source inference)
- `.header .nav a:last-child{display:none}` at `:48` (Account link) is **not** in effect — `.header .nav a{display:flex}` at `:135` ties on specificity (0,2,1) and wins on order. Routes are not hidden at ≤700px, per §1.
- Header `display:none` at `:71`/`:108` is likewise overridden by `:160`'s `display:flex` in the ≤1199 block.
- Rails agree: header `padding:0 var(--workspace-rail)` (`:128`) vs console `padding:16px var(--workspace-rail)` (`operations.module.css:6`) — the script's `|events.x - toolbar.x| <= 1` assertion (`:31`) holds.
- Grid gaps satisfy the script's `+7`/`+11` thresholds: `--panel-gap:12px` desktop, `8px` at ≤700 (`operations.module.css:121`).
- `.map{z-index:-1}` inside `.console{isolation:isolate}` with `pointer-events:none` on the container and `auto` on children correctly leaves empty grid space to the map (§2, "no hidden interactive layers").
- Account dialog width resolves to `min(480px, 100vw − 32px)` via `account.module.css:1` `max-width` + `:9` `width` — matches §5.

### Not verified
Actual `getBoundingClientRect` values, 44×44 hit tests, `elementFromPoint` occlusion, 200%-zoom reflow, and whether the ≤700px nav (three links at 14px in a `justify-content:center` scroll container, ~299px of content in ~296px) actually clips its first item. That last one is marginal in arithmetic and needs a real render to call either way.

## Implementation disposition

1. Fixed the shared status strip to use the theme field background. Account integration checks its light-theme computed color.
2. Fixed the shared light-theme raised surface token; all selection consumers inherit it. Account integration checks the token.
3. Added CSS mutual exclusion for Events/Inspector and Events/Recovery below 1100px, including resize with panels already open.
4. Added a desktop-to-tablet resize check with both panels open, then verified the inspector is reachable after Events closes. Inspector separation uses a fresh measurement.
5. This helper intentionally belongs to the real solved-run scenario check. Added a descriptive precondition instead of silently skipping recovery coverage. It is not a demo-route audit.
6. Deferred unrelated dead CSS removal; existing working consumers and landing styles were preserved.

Claude's source-inference report is retained above unchanged. Runtime evidence is separate in `dashboard/workspace-layout.json` and the isolated account/scenario checks.
