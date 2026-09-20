# OLUS — UI/UX WORK ORDER v2
### Landing-page repair + Docs consistency + full Dashboard rebuild from scratch

> **To the agent (Astra / Claude Design / Claude Code):** this supersedes the previous Aeolus build prompt where the two conflict. The product is now **Olus**, not Aeolus. Read §0 and do the research pass before touching a single file. Sections marked **P0** are blocking bugs — fix them before any new feature work. Sections marked **STRICT COPY** mean reproduce the layout grammar, spacing, motion, and interaction of the named reference — never its logo, brand marks, proprietary imagery, or copy.

---

## 0. PRE-FLIGHT — TOOLS YOU MUST USE BEFORE BUILDING

You have MCP servers and skills available. Enumerate them first, then use them. Do not skip this.

1. **List what you have.** Run your skill/plugin listing and MCP registry search. Look specifically for:
   - **Mobbin MCP** — this is the primary research tool for this job.
   - Any **"impeccable"** design skill/plugin (non-AI-slop design principles). Load it and follow it for every visual decision. If a skill by that name exists, its rules outrank my aesthetic preferences below wherever they conflict on craft (spacing, type, iconography, shadow, radius discipline).
   - Any design-system, dataviz, or artifact-design skills. Load the dataviz skill before writing a single chart.
2. **Mobbin research pass.** Pull the full captured flows for the reference products named in §8.1 and write `/docs/dashboard-teardown.md`: a screen-by-screen table with `screen | grid | type scale | spacing rhythm | radii | shadows | color values | component inventory | interaction notes`.
3. **Live forensics.** Open the reference sites in the browser tool where publicly reachable. Recover real values: card padding, border radius, font stacks, exact hex, hover transform/duration/easing, table row heights, chart stroke widths. Log them in `/docs/dashboard-teardown.md`. **Recover numbers, do not estimate them.**
4. **Audit our own repo before deleting anything.** Write `/docs/current-state-audit.md`: what exists on the landing page, what exists in the dashboard, which components are reused across both, what is dead code, and what the current animation stack actually is (library versions, where ScrollTrigger is registered, how Lenis is wired, what is dynamically imported).
5. Only then implement, in the order given in §11.

---

## 1. BRAND: AEOLUS → OLUS

- Product name is **Olus** everywhere: page titles, meta, OG tags, nav wordmark, docs, dashboard, emails, README, package name, favicon, manifest.
- **One mark, one wordmark, used everywhere.** Right now the loading screen uses a dark rounded-square with a generic plane glyph (att. 1), the docs header uses a wind/squiggle icon (att. 3), and the landing nav uses a different circular mark (att. 4). **Pick one.** The landing nav mark (the open circular "O" loop) is the strongest — it reads as both the letter O and a closed circuit. Standardize on it.
- Deliver the mark as a single continuous SVG path so it can be draw-animated, plus a solid-fill variant, plus a 32/48/512 favicon set and a 1200×630 OG image.
- Grep the codebase for `aeolus`, `Aeolus`, `AEOLUS` and replace. Check env vars, route names, API paths, test fixtures, and the docs site.

---

## 2. DESIGN SYSTEM — LOCKED. USE THESE TOKENS ONLY.

Carry the palette forward from what we already agreed. **No new accent colors. No purple.** The purple ring on the loading screen and the purple in the Aroval reference are both off-brand — translate them to jade.

```css
:root {
  /* Surfaces */
  --ink-900:#05070A; --ink-800:#0A0E14; --ink-700:#11161E;
  --ink-600:#1A222D; --ink-500:#27323F;
  --bone-050:#F7F5F1; --bone-100:#ECE8E1; --bone-200:#D8D2C8;
  /* Text */
  --text-hi:#F4F2ED; --text-mid:#9AA5B1; --text-lo:#6B7785; --text-inv:#0A0E14;
  /* Semantic accents — meaning, not decoration */
  --disrupt:#FF7A1A;  --disrupt-dim:#C2560F;   /* delayed / degraded / the "before" */
  --recover:#2FE3A0;  --recover-dim:#17A874;   /* legal / recovered / the "after"  */
  --critical:#FF4757;                           /* cancelled / Part 117 violation   */
  --neutral-arc:#4C82F7;                        /* unaffected routing               */
}
```

**Law:** amber = disrupted, jade = recovered, red = violation, blue = unaffected. Never used decoratively. In any composition where both appear, amber resolves *into* jade along the direction of time or scroll.

**Type:** display/UI = `Space Grotesk` (or `PP Neue Montreal`/`Suisse Int'l` if licensed) · body = `Inter` variable · numbers, IDs, tail numbers, timestamps, constraint names = `JetBrains Mono` with `font-variant-numeric: tabular-nums`. **Body text never below 16px on marketing, never below 14px in the dashboard.**

**Surface discipline (this is what separates it from the current beige CRM look):** one radius scale (`8 / 12 / 20 / 999`), one shadow scale (three steps max), 1px hairlines at `--ink-500` or `--bone-200`, and **no double-nesting of cards** — a card inside a card inside a panel is the single biggest thing making the current dashboard look cheap.

---

## 3. **P0 — ANIMATIONS WORK ON LOCALHOST, DEAD IN PRODUCTION**

This is the highest-priority bug. Nothing else matters if the deployed site is static. Work through this checklist and report which one it actually was — do not shotgun fixes.

**Diagnose first:**
- Open the deployed site, check the console and the network panel. Is the GSAP chunk even downloaded? Is there a hydration error? A CSP violation? A 404 on a dynamically imported chunk?
- Compare `next build && next start` locally against dev. **If it breaks in local prod build, it is not a hosting problem** — it is one of the causes below and you can iterate fast.

**Likely causes, in order of probability:**
1. **Plugins registered in a module that gets tree-shaken or never runs on the client.** `gsap.registerPlugin(ScrollTrigger, Flip, SplitText, MotionPathPlugin)` must run in a client component, at module scope, in a file that is definitely imported by the render path. Guard with `typeof window !== 'undefined'`.
2. **SSR/hydration mismatch** — timelines built in `useEffect` against elements that render differently on the server. Use `useGSAP()` from `@gsap/react` (it handles cleanup + StrictMode double-invoke) or `useIsomorphicLayoutEffect`.
3. **React StrictMode double-mount in dev masks a cleanup bug that only bites in prod.** Every timeline must live inside `gsap.context()` with `ctx.revert()` on cleanup.
4. **ScrollTrigger measured before fonts/images settled**, so every `start`/`end` is wrong and nothing ever fires. Call `ScrollTrigger.refresh()` after `document.fonts.ready`, after `next/image` load events, and on Lenis resize. Add `ScrollTrigger.config({ ignoreMobileResize: true })`.
5. **Lenis not driving ScrollTrigger in prod** — verify `lenis.on('scroll', ScrollTrigger.update)` and the `gsap.ticker.add` RAF wiring survive minification, and that Lenis isn't double-initialized.
6. **A club/bonus plugin (SplitText, DrawSVG, MotionPath) that resolves locally from a private registry but not in CI** — the build silently drops it. Check the deploy build log for install warnings, and vendor the plugin files if needed.
7. **`prefers-reduced-motion` mis-detected** — if your `matchMedia` branch is inverted or the reduced branch is the default fallback, prod devices land in the "no animation" path. Log which branch ran.
8. **Stale CDN/edge cache** serving an old bundle. Purge and verify the bundle hash changed.
9. **`will-change`/`transform` on a pinned parent creating a containing block** that breaks `position: fixed` pinning only in prod CSS ordering.
10. **CSP blocking inline styles GSAP writes.** Check `style-src`.

**Deliverable:** `/docs/prod-animation-fix.md` naming the actual root cause, the fix, and a regression guard (a Playwright test that loads the deployed URL, scrolls, and asserts a transformed element's computed `matrix` changes).

---

## 4. **P0 — LOADING SCREEN (attachment 1)**

Current state is wrong on every axis: cream background, lavender ring, a generic AI-looking plane glyph in a dark rounded square, a beige outlined button, and a flat purple progress bar.

**Rebuild:**
- Background: **`--ink-900`, full bleed.** Black, matching the Joby preloader register. No cream.
- Center: the **Olus mark only**, white on black, ~110–130px, no rounded-square container, no drop shadow, no plane icon.
- **Liquid flow around the mark** — this is the loading indicator, replace the ring and the progress bar entirely:
  - A fluid, continuously morphing blob/aura orbiting the mark. Implement as a WebGL fragment shader on a small plane (preferred): 2–3 octaves of curl/simplex noise displacing a signed-distance ring, animated on `uTime`, colored as a jade→amber gradient at low luminance so it reads as a dark liquid halo, with an additive rim. Alternative if you want zero WebGL: animated SVG with two counter-rotating blob paths, `feTurbulence` + `feDisplacementMap` on a slow-drifting `baseFrequency`, plus a Gaussian blur — cheaper, still looks liquid.
  - Motion is **continuous and non-linear** — it must never look like a spinner. No visible period, no discrete steps.
  - The liquid **thickens/brightens with real load progress** (map actual asset/route progress to a uniform), so it communicates state without a bar.
- Copy: keep the mono sub-line but tie it to what is actually loading (`Connecting to ADS-B feed…` is fine if true, otherwise say what's real). `--text-mid`, mono, `label` scale, no purple.
- Skip control: a **ghost/text button in `--text-mid`** with a jade underline on hover — not a beige outlined box. Label it `Skip →`.
- **Exit:** the liquid collapses inward, the mark solidifies, then **Flip-morphs into the navbar slot** while the hero container unmasks downward (the sequence we already specced). Total budget **2.4s max**; proceed at 1.8s with a poster frame if assets lag. Runs **once per session** (`sessionStorage`).
- **Reduced motion:** static mark, single 200ms fade, no shader.
- The loading screen must also exist for the **dashboard** (att. 1 is the app loader) in the same language but shorter — 900ms max, since it gates the actual product.

---

## 5. **P0 — LANDING PAGE STRUCTURAL BUGS (attachments 2, 4, 5, 6)**

### 5.1 The pinned MacBook demo is broken (att. 4)
Symptoms visible in the screenshot: the MacBook demo is **overlapping the `Chaos, solved.` headline**, the gallery images are compositing on top of the laptop, the floating controls (`Pause demo`, `Rep…`, `Open the workspace ↗`) are **colliding with the fixed navbar**, and the whole thing is unreadable.

Fix:
- **One ScrollTrigger owns the section.** The headline and the demo are two layers of a *single* pinned timeline, not two independently-pinned siblings. Two competing pins on overlapping elements is what is causing the merge.
- Pin the section wrapper for a defined distance (`end: '+=' + (vh * 3.5)`), scrub the inner timeline. Order: headline enters → headline settles to its final position → demo scales up from below → demo steps through its 4 stages (`01 Command → 02 Cascade → 03 Solve → 04 Commit`) → demo shrinks and releases → next section.
- The headline must **not** sit behind the demo at full opacity. Either it moves out of the way (translate + fade to ~8% as a watermark) or the demo occupies a lane beneath it. Decide one; do not let them fight.
- **Floating controls belong to the demo, not the page.** Position them inside the pinned container, below the laptop bezel or in a bottom-anchored control bar. They must never overlap the navbar. Give the navbar a higher stacking context and a backdrop blur.
- The `Illustrative recovery · Nimbus Air` label stays — good, it is honest — but it moves into the demo's own chrome.
- Add `ScrollTrigger.refresh()` after the demo's assets load, or the pin distance will be wrong on first paint.

### 5.2 Giant empty viewport (att. 5)
An entire screen of `--bone-050` with nothing but the navbar. Causes to check: a pinned section whose spacer height is computed from a zero-height child; a section whose content is `opacity: 0` waiting on a trigger that never fires (see §3); or a `min-height: 100vh` placeholder left in. **Every section must render its content with JS disabled** — build to that standard, then layer motion on top. Verify by disabling JS and scrolling the whole page: you should see a complete, readable, correctly-ordered document.

### 5.3 Text alignment, indentation, and rhythm (att. 4, 6)
- Establish **one 12-column grid** with tokens for gutters (24/48/80) and a max width of 1440. Every section snaps to it. Right now sections are individually improvising their left edge — that is the "indentation problem."
- Left-edge alignment must be consistent: eyebrow, headline, body, and CTA in a block share the same left rail. In att. 6 the stat column, the rule, and the `See how this is defined ↗` link are each at slightly different x positions. Fix with a shared grid column, not per-element padding.
- Prose measure capped at **68ch**. The paragraph in att. 6 is close to right; the docs paragraphs in att. 3 run too wide.
- Vertical rhythm: section block padding `clamp(6rem, 12vh, 12rem)`. In att. 6 the gap between the eyebrow rule and the `22` is doing nothing — tighten intra-block spacing, keep inter-block spacing generous. **Air between groups, tightness within groups.**

### 5.4 Layout orientation across the landing page
Current flow is monotonous: everything is a full-width block with a left headline. Vary the rhythm the way the references do:
- Alternate **full-bleed media** → **two-column asymmetric (7/5)** → **centered statement** → **pinned horizontal** → **edge-anchored micro-nav over media**.
- Steal United Carriers' **edge-anchored label pattern** (tiny mono labels pinned to the extreme left and right margins of a section) — we already use it in a couple of places (`SIMULATION HIGHLIGHTS`, `Run the storm ↗` in att. 4); make it a systematic device on every major section so the page reads as one system.
- Steal Joby's **staggered vertical offsets** for any 3-card row (card 1 high, card 2 mid, card 3 low). The current news/stat rows are flat and lifeless.
- The stats section (att. 6) has a dead left half. Fill it with the two-tone giant headline treatment (`WE MODEL DISRUPTION.` grey / `WE RETURN THE PLAN.` black) as specced, plus the small media thumbnail — that is the United Carriers composition, and it fixes the imbalance.

### 5.5 Scroll reveal on body copy — **STRICT COPY of Joby (att. 2)**
Att. 2 shows our current attempt mid-transition; the mechanic is right but needs to be exact and applied consistently.
- Implementation: wrap the paragraph, apply a **`background-clip: text` linear gradient** from `--text-inv` to `--bone-200`, and scrub `background-position` with ScrollTrigger. This is smoother than per-character color tweens and survives line reflow.
- Timing: `scrub: 0.6`, the wipe completes when the block reaches ~35% viewport height, with a short trailing soft edge (the gradient has a ~12% feather so there is always a partially-revealed word, exactly as in the reference).
- Apply to **every** long statement block on the landing page, not just this one, so it reads as a house device.
- The CTA pill beneath (`Discover the Experience` → ours: `Open the workspace`) fades up after the wipe completes, `y: 12 → 0`, `DUR.sm`.
- Reduced motion: text is simply at final color.

### 5.6 Copy fixes on the landing
- Tighten the hero and section copy to the register we set: precise, quiet, no hype. Result-first sentences.
- **Every number on the site must be sourced from the repo, not from a designer's imagination.** Att. 6 says `22 disruption types` while earlier material said 11 — pick the true value, put it in `/lib/facts.ts` as the single source of truth, and have both the site and the docs import it. Add a test that fails if the site hard-codes a number that disagrees with `facts.ts`.
- Anything illustrative (the `Nimbus Air` demo, any quote) stays explicitly labeled illustrative.

---

## 6. **P0 — THE PLANE FLY-OVER AT THE BOTTOM OF THE LANDING (broken timing + ugly model)**

Required behavior, restated precisely:
- The aircraft crosses the section **while that section owns the viewport** — not before it enters, not after it leaves. Bind it to the section's own ScrollTrigger with `start: 'top bottom'`, `end: 'bottom top'`, `scrub: 0.6`, and map progress so the aircraft is at **path midpoint when section progress ≈ 0.5**. Use `gsap.utils.mapRange` and clamp; do not use a time-based tween, that is why the timing is wrong today.
- Path: a diagonal `MotionPath` from off-canvas lower-left to off-canvas upper-right, with `autoRotate` following the tangent (about −8° to −12°).
- **Model quality — replace the current asset.** Options in order of preference:
  1. A **real top-down render** at 3–4× the display size, exported as WebP with alpha: clean white fuselage, subtle panel lines, soft specular along the spine, faint engine-fan detail, a jade+amber livery stripe. No cartoon outlines, no AI-generated aircraft with melted geometry or extra engines.
  2. A **low-poly GLTF** (< 12k tris) rendered in a tiny Three.js canvas with a single soft key light and an HDRI-lit spec — this gives real motion parallax and lets the wing catch light as it banks. Only if it holds 60fps.
- **Shadow sells the altitude:** a separate blurred silhouette (`blur(18px)`, `opacity .22`), offset down-right, tweened on the same path with a ~0.04 progress delay so it lags.
- **Occlusion:** the plane renders above the type; a soft radial masked overlay following the plane applies `backdrop-filter: blur(3px)` so the text smears under it.
- Render at device pixel ratio, `image-rendering: auto`, and make sure the sprite is not being upscaled — the current one looks soft because it is.
- Reduced motion: aircraft sits static at one-third along the path.

---

## 7. **DOCS SITE (attachment 3) — olus.sh/docs**

- **Wrong logo.** The wind-squiggle mark is not the Olus mark. Replace with the standardized mark + wordmark from §1. Same size, same optical alignment as the landing nav.
- **AI-generated icons out.** The circular glyph badges next to `The $34B cascade problem` and `Recovery optimizer (MILP)` are generic AI-slop icons. Replace with either (a) no icon at all — a mono section number (`01`, `02`) and a hairline is more credible for a technical doc, or (b) a hand-drawn 1.5px stroke icon set on a 24px grid, consistent joins and terminals, no gradients, no filled blobs. Option (a) is the stronger call for a methodology page.
- Docs currently feel like a different product from the landing. Unify: same grid, same type scale, same `--bone-050` surface, same mono for code, same hairline rules, same edge labels. The docs nav (`Simulator`, `Scenarios`) should match the landing nav's treatment and include `Open workspace`.
- Prose measure to 68ch (currently too wide). Code blocks get `--ink-900` background with the jade/amber semantic colors for delay values — the current pink `+2h30m` is off-palette; delays are **amber**.
- Add: a persistent right-hand TOC with scroll-spy, anchor links on every heading, a `Copy` button on every code block (fires our toast), prev/next pagination, and a "last verified" date line tied to the repo.
- Every claim in the docs that carries a number imports from `/lib/facts.ts`.

---

## 8. **DASHBOARD — DELETE IT AND REBUILD FROM SCRATCH**

The current dashboard is not salvageable: beige 90s-CRM surface, everything crammed into one viewport, nested panels, colliding z-indexes, buttons that cannot be clicked because another element overlaps them. **Do not refactor it. Delete the directory and rebuild** against this spec. Keep only the data-fetching layer and types.

### 8.1 Reference mapping — what to take from where (**STRICT COPY** where noted)

| Reference | What to take | Notes |
|---|---|---|
| **Outcrowd dashboard** (att. 9, the one with the Anna Smith avatar) | **STRICT COPY: the whole shell language.** Pill top-nav with a filled black active pill; large white cards on a soft neutral field; 24px radii; oversized numerals with small grey secondary labels; delta chips (`+$14k` / `-$10k`) as soft-tinted pills; the hover animation on cards; the chart style (smooth multi-series lines, single dashed crosshair, a floating value bubble like `+24%`); the list rows with logo, title, region, and an arrow/expander; the map card with labeled pills. | This is the primary dashboard reference. Match spacing, radii, type weights, and hover physics. **Swap their green for our `--recover` jade and their purple for `--neutral-arc`.** Do not copy their logo, avatar, or brand imagery. |
| **Aroval** (att. 7) | **STRICT COPY: the live map view.** Dark street-level vector basemap; white aircraft glyphs rotated to heading; the selected-flight detail panel with a **3D aircraft render at the top**; the origin/destination card pair (`DAL ⟷ DCA` with city, timezone); scheduled/actual/estimated rows; the arc progress mini-chart with a marker at current position and `715 km 00:54 ago` / `1,151 km in 01:27`; the bottom horizontal ticker of active flights. | This is our websocket map. **Their purple accent becomes jade.** The 3D plane on selection is explicitly wanted — see §9. |
| **SkyMind** (att. 8) | Layout ideas only: the 4-up KPI tile row, the two-chart row, the right rail of alerts, the recent-operations table with a status column. | **It lacks contrast and its icons are AI-generated — do not copy either.** Raise contrast to AA, replace every icon with the real icon set, and kill the pastel tint-cards in favor of our surface system. |
| **Shopify Analytics** (att. 10) | The analytics-page patterns: sparkline stat tiles with a value and a comparison, the right-hand breakdown table with aligned figures, date-range + comparison-range controls, and the discipline of underlined-dotted metric labels that expose a definition on hover. | Use for our `/benchmarks` route. |
| **Copilot Money** (att. 11) | The sidebar information architecture (grouped, labeled sections with values inline), the category rows with progress bars against a limit, and the calm empty-state treatment. | Use for our crew-legality slack bars (value vs. limit is exactly the same UI problem) and for the left nav grouping. |
| **HoneyBook** (att. 12) | The dark left rail against a light content field; the greeting header with a stat strip beneath; the "Create new" action-card grid; onboarding progress in the rail. | Use for the dashboard home/overview and the "new scenario" entry point. |
| **Higgsfield** (att. 13) | The **dark-theme** treatment: near-black cards on black, the spend-overview tile row, the segmented stacked bar with a wrapped legend, the info banner with a dismiss, and the notably good button contrast on dark. | This is our dark-mode reference. Our dashboard ships **dark-first** with a light option. |

### 8.2 Non-negotiable UX rules (these are what fix "horrendous")
1. **Dark-first.** Base `--ink-900`, cards `--ink-700`, hairlines `--ink-500`. A light theme exists and uses `--bone-050`/white cards. **No beige. Ever.**
2. **One job per screen.** If a view is doing three jobs, it becomes three routes. The current everything-on-one-screen layout is the core disease.
3. **Density ladder:** `Comfortable` (default) / `Default` / `Compact`, persisted per user. At Comfortable: table rows ≥ 44px, card padding ≥ 24px, section gaps ≥ 32px, body ≥ 15px, labels ≥ 13px.
4. **No nested cards.** A panel contains content or a list — not more panels.
5. **Every number carries a unit, a label, and a path to its derivation.** No orphan metrics.
6. **Progressive disclosure:** summary → detail drawer → raw JSON/solver output.
7. **Z-index is a token scale** (`base/raised/sticky/overlay/modal/toast`), declared in one file. Every current click-blocked button is a z-index accident — this is the fix.
8. **Every panel designs its empty, loading, error, and partial states.** Skeletons match final layout so there is no CLS.
9. **Color never carries meaning alone** — pair with icon and text label.
10. **Motion is short.** `DUR.xs`/`DUR.sm` only. Dashboards feel instant, not cinematic. Card hover: `y: -2`, shadow step up, 160ms, `cubic-bezier(.22,1,.36,1)` — match Outcrowd's physics.

### 8.3 Information architecture
```
/app
  /overview          ← network health now; the landing pad after login
  /map               ← live websocket flight map (Aroval-grade)
  /scenarios         ← library: create, duplicate, compare, archive
  /scenarios/[id]/setup      ← stepped: Schedule → Fleet → Crew → Constraints → Disruptions → Review
  /scenarios/[id]/solve      ← live solver run
  /scenarios/[id]/plan       ← the recovery plan (Gantt + flight list + crew)
  /scenarios/[id]/legality   ← FAR Part 117 audit, per-rule slack
  /scenarios/[id]/explain    ← why this plan; binding constraints; what-if
  /scenarios/[id]/compare    ← side-by-side vs. baseline or another run
  /benchmarks        ← solve-time distributions, regression history
  /account           ← profile, preferences, theme, density, API keys, sessions
  /settings          ← workspace-level
```

### 8.4 Screen specs

**Shell.** Dark left rail (HoneyBook) **or** top pill-nav (Outcrowd) — pick the pill-nav, it photographs better and matches the landing's lightness of touch; put secondary nav in a collapsible left rail on `/scenarios/[id]/*` only. Global: search (`⌘K` command palette), scenario switcher, notifications, avatar menu. **The avatar menu contains Account, Theme, Density, and Sign out.**

**Overview.** Max 6 primary elements above the fold. A stat strip (`Active flights` / `Disrupted` / `Aircraft AOG` / `Crew at risk`) using Outcrowd's oversized-numeral + delta-chip treatment. Beneath: a half-width network map card (links to `/map`), a half-width "last five solver runs" list with status chips, and one prominent primary action — `Run recovery`.

**Map** — see §9.

**Scenario setup.** Six steps, one screen each, a persistent summary rail on the right showing what has been configured, and an explanation panel that teaches what each step means. The **disruption injection** step gets a visual timeline: drag a disruption onto a time window, immediately see which flights it touches highlight in amber.

**Solve.** Large progress state, not a thin bar: elapsed time, live objective-trace chart, constraints satisfied, incumbent count, and a mono event log. Cancel always available and always safe. Mirrors into a global `solving` toast so the user can navigate away.

**Plan.** The centerpiece. Gantt of tails × time. Flight blocks colored baseline vs. recovered, swap arrows for aircraft/crew reassignment. **Row heights must let you read the flight number** — this is where the old compactness hurt most. Horizontal pan/zoom, a time cursor with a readout, sticky row headers, keyboard navigation between blocks. Click a block → detail drawer: flight, tail, crew, duty-clock state, binding constraints, delta vs. baseline.

**Legality.** Crew × rule table: computed value, limit, **slack remaining as a Copilot-Money-style progress bar**, pass/fail chip. Filter by crew, rule, or margin. Every row expands to the full computation with inputs. Verbose on purpose — this is the trust screen.

**Explain.** Plain-language narration ("Flight 2291 was delayed 42 minutes so Crew 118 could take a legal 10-hour rest; this cascaded to two downline flights and cost 63 passenger-minutes"), an objective-contribution waterfall, binding constraints ranked by shadow value, and a what-if relaxation panel.

**Compare.** Two runs, synced-scroll Gantt pair, and a diff list of what changed / improved / regressed.

**Benchmarks.** Shopify-Analytics patterns: sparkline tiles, a breakdown table with right-aligned tabular figures, date-range + comparison controls.

**Account.** Profile, email, avatar, theme (system/dark/light), density, timezone (UTC default with a Z suffix everywhere), API keys with reveal/rotate/revoke, active sessions with device + last-seen + a revoke action, and a clearly-separated destructive zone. Every field saves inline with a success toast; nothing is lost on navigation.

### 8.5 Flows you must build end-to-end
- **Auth:** sign in → session → sign out. **Button coloring rules (the current site gets these wrong):** primary action = jade fill, `--ink-900` label. Secondary = transparent with `--ink-500` border, `--text-hi` label. Tertiary = text-only. **Destructive = `--critical`, and only ever used for destructive actions.** Sign out is *secondary*, not destructive, and never jade — it is not the happy path. Sign in is primary. Add `:hover`, `:active`, `:focus-visible`, `:disabled`, and `aria-busy` loading states for all four variants, and make disabled visually obvious without dropping below 3:1.
- **Simulation:** new scenario → configure (6 steps) → inject disruption → solve (live) → read plan → inspect legality → read explanation → compare to baseline → export/share. This path must be walkable by someone who has never seen Olus, without help.
- **Account changes:** edit profile → inline save → toast; change theme/density → applies instantly and persists; rotate API key → confirmation modal → new key shown once with a copy button → toast.
- **Error paths:** solver timeout, infeasible model, websocket disconnect (with reconnect state and a stale-data banner), and permission errors all get designed screens, not a thrown stack trace.

---

## 9. **LIVE MAP — AROVAL-GRADE (attachment 7) — STRICT COPY**

- **Basemap:** dark vector tiles with street-level detail at high zoom — matching the reference's density. MapLibre GL with a custom dark style; roads at very low luminance, water slightly darker than land, labels in `--text-lo`, no colored POIs. The map must feel like an instrument, not Google Maps at night.
- **Aircraft:** white top-down glyphs, rotated to true heading, scaled by zoom, with a subtle circular halo on the selected one. Positions stream over the websocket; interpolate between updates with a critically-damped tween so aircraft glide rather than teleport. Dead-reckon during gaps and mark the aircraft as stale after N seconds.
- **Selection → detail panel** (left, exactly as in the reference):
  - Header: `SWA4957, WN4957, B738` equivalent — our flight ID, tail, and type in mono, with an amber/jade status bar at the left edge and a close `×`.
  - **A 3D aircraft render at the top of the panel.** This is explicitly requested. Use a small Three.js canvas with a GLTF airframe matched to the type (a shared narrowbody/widebody/regional set is fine), soft studio lighting, a slow idle orbit, and a drag-to-rotate affordance. It must not be a flat stock photo, and it must not be AI-generated geometry — use clean, purpose-built low-poly models with proper normals and a subtle matte livery in our palette.
  - Origin/destination card pair with airport code (display scale), city, and timezone offset; a centered aircraft glyph between them.
  - Rows: `Scheduled / Actual` and `Scheduled / Estimated`, mono, tabular, with amber deltas when late.
  - The **arc progress chart**: a great-circle arc with a filled jade portion up to the current marker, `715 km 00:54 ago` on the left and `1,151 km in 01:27` on the right.
  - Below: a flight-information grid (type, registration, speed, altitude, category) in mono key/value chips.
  - Olus-specific additions the reference doesn't have: **crew duty clock with slack**, **downline impact** (which flights this tail feeds), and a `Simulate disruption on this flight →` action that deep-links into scenario setup.
- **Bottom ticker:** horizontally scrolling active-flight chips (`DXB ✈ KRK`) with airline mark, flight ID, and altitude — copy the reference's layout, our palette, pausing on hover, keyboard scrollable.
- **Performance:** aircraft as a single instanced layer, not N DOM markers. Cap DPR at 2. Pause rendering when the tab is hidden. Degrade to a static map + list when WebGL is unavailable, and say so in a toast.

---

## 10. ANTI-AI-SLOP RULES (non-negotiable; if an `impeccable` skill exists, it governs here)

- **No AI-generated icons, logos, illustrations, or aircraft.** Every icon comes from one coherent set, drawn on one grid, with one stroke width, one terminal style, one corner radius. If you cannot produce that, ship no icon and use a mono numeral or a label instead — the docs page proves this looks better anyway.
- **No gradient-blob decoration, no glassmorphism for its own sake, no drop shadows on text, no emoji as UI icons, no stock "futuristic HUD" ornament.**
- **No fake data presented as real.** Illustrative content is labeled illustrative. No invented customers, airlines, partnerships, or metrics.
- Photography, when used, is real, dark, and consistently graded (`brightness .55 contrast 1.1`) so it never fights the type.
- Copy is specific and quiet. Delete every adjective that could apply to any other product.
- **Every surface is on the grid, every color is a token, every radius and shadow is from the scale.** If something needs a one-off value, that is a signal the system is wrong, not that the rule is.

---

## 11. ORDER OF WORK

1. §0 research + audit docs. **Show me `/docs/dashboard-teardown.md` and `/docs/current-state-audit.md` before building.**
2. §3 production animation bug — root-caused, fixed, regression-tested.
3. §4 loading screen (site + app).
4. §5.1 / §5.2 pinned-demo and blank-viewport bugs.
5. §5.3–5.6 grid, alignment, scroll reveal, copy, layout rhythm.
6. §6 plane fly-over timing + new model.
7. §7 docs consistency.
8. §1 rebrand sweep + footer/responsive pass.
9. §8 dashboard — delete, then rebuild in IA order: shell → overview → map (§9) → scenarios → setup → solve → plan → legality → explain → compare → benchmarks → account.
10. Full accessibility + performance pass (§12).

---

## 12. DEFINITION OF DONE

**Landing**
- [ ] Deployed build: every animation that works locally works in production; Playwright regression test proves it
- [ ] Loading screen black with liquid-flow indicator, Flip-morph exit, once per session, reduced-motion path
- [ ] MacBook demo pinned cleanly — no overlap with the headline, gallery, or navbar
- [ ] No blank viewports; entire page readable and correctly ordered **with JavaScript disabled**
- [ ] One 12-column grid; all sections share left rails; prose ≤ 68ch; consistent vertical rhythm
- [ ] Joby-style gradient scroll reveal on every long statement block
- [ ] Plane fly-over fires at section midpoint with a clean, high-res, non-AI model + lagging shadow + text occlusion
- [ ] Footer expanded: link columns, newsletter with toast, status/security/changelog, social, legal, large lockup
- [ ] Responsive at 320 / 768 / 1024 / 1440 / 1920 / 2560 with no horizontal scroll
- [ ] Every site number imports from `/lib/facts.ts`

**Docs**
- [ ] Correct Olus mark; zero AI-generated icons; unified grid/type/color with the landing; TOC + anchors + copy buttons

**Dashboard**
- [ ] Old dashboard deleted; new shell dark-first, Outcrowd-grade card/number/hover language
- [ ] Aroval-grade live map with 3D aircraft render on selection and a bottom flight ticker
- [ ] Every route in §8.3 built, with empty/loading/error/partial states
- [ ] Zero nested cards; z-index token scale; **no button is ever blocked by an overlapping element** — verify by clicking every interactive element at 1280 and 1440
- [ ] Button variants correct everywhere; sign out is secondary, destructive is red and only destructive
- [ ] Simulation flow walkable end-to-end by a first-time user
- [ ] Density toggle persists; Comfortable default; no body text < 14px; no row < 44px

**Both**
- [ ] axe clean at WCAG 2.2 AA; full keyboard traversal; visible jade focus rings; skip link
- [ ] `prefers-reduced-motion` honored on every animation
- [ ] LCP < 2.0s, CLS < 0.02, INP < 150ms on throttled 4G / mid-tier mobile
- [ ] `/docs/motion-spec.md` documents every timeline: trigger, start/end, scrub, pin, properties, duration, ease, reduced-motion fallback

---

## 13. WORKING AGREEMENT

- Show me the research docs before you build, and a screen recording after each of steps 2–6.
- The dashboard rebuild lands on its own branch; I want to see the shell + overview + map before you build the rest.
- If a reference behavior can't be reproduced inside the performance budget, tell me the tradeoff — don't silently simplify.
- Ask before inventing content that implies real customers, airlines, partnerships, or unmeasured metrics.
