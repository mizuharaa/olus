# Design — Olus

## Current dashboard direction: Floating tools (2026-09-16)

User selected Floating tools from `/design-review`. This supersedes older console surface decisions below: full-screen map, independently collapsible floating event/inspection/recovery/timeline panels, 8px corners, 1px neutral boundaries, no decorative colored stripes or layered shadows. Neutral selection and short 160ms color transitions; semantic color remains on operational states and keyboard focus. Keep 48px event rows and readable body text. Preserve all existing operations, 3D aircraft, financial plans A/B/C/D and map interactions. Implementation: `apps/web/components/workspace/operations.module.css`. Older dated decisions remain historical context.


A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

---

## Decision record (2026-08-19): ONE WORLD, ONE REGISTER — THE PAPER BOARD

The console is rebuilt as a **departure board rendered in warm paper**. This
replaces the visual world; it does not touch product truth, the API, the
macrostructure, or the landing.

**What this reverses.** The 2026-08-16 record made the console a dark ops
surface, and a later pass added a third register — a cool-grey board floor
(`#E9EDF3`, hue 218) scoped to `.simulator-shell`. Three registers existed at
once: warm paper on `:root`, cool grey on the console, dark behind a toggle.
The console had drifted off the product's own beige world entirely, which is
what "keep the beige theme" was actually asking for. **The cool-grey values and
the dark register are both deleted. There is one register.**

**Why a departure board.** The dispatcher's own object. Its grammar coincides
with three rules this system already enforced rather than fighting them: status
is a **word**, cancelled is a **word**, and flight IDs and times are
**fixed-pitch**. It also refuses both category ruts — the dark mission-control
console with neon glow, and the pastel SaaS dashboard with KPI donuts.

**The seam is a motion artifact, not an ornament.** At rest a card is a clean
rounded module. A split-flap seam appears only for the duration of a real state
change. A permanent printed seam is skeuomorphic decoration and is banned.

**Consequence: elevation has only one channel now.** With the static seam gone,
figure and ground rest entirely on the surface step and the gap between modules.
That is why the separation floor is raised below.

## Decision record (2026-08-19): THE SEPARATION FLOOR IS 1.25, NOT 1.12

The gate was right and its threshold was too low. The previous light board
passed `SEPARATION` at **1.17 / 1.15 / 1.17** against a floor of 1.12 and still
read as flat to its user. An assertion that admits the failure it exists to
prevent is not doing work.

`check-contrast.mjs` now asserts **≥1.25 between consecutive elevation steps**.
Every value below was solved against that script's own maths, not eyeballed.

Keep the 2026-08-16 lesson that produced the check in the first place, because
it is the durable part: WCAG 1.4.3 governs text against ITS OWN background and
1.4.11 governs a control's boundary. Neither says anything about whether a
LAYOUT has a figure and a ground, so a screen can pass both completely and be
unreadable. A zero-failure contrast report is not evidence of a readable screen.

## Genre

Operational board — a dispatcher's departure board rendered in warm paper.

## Macrostructure family

- Marketing pages (`/`): staged scroll experience. Owned by `scroll-experience.tsx`.
  **Untouched by this world.** See the landing boundary below.
- App pages (`/simulator/*`): **the board.** A FIXED shell (`100dvh`,
  `overflow: hidden`, every region scrolling internally) laid out as:

  ```
  rail · [ masthead strip                    ]
         [ network module    | recovery module ]
         [ cascade board module               ]
  ```

  A full-width **masthead strip** of status tiles runs under the top bar and
  carries the headline counts and the burn meter — these are board headlines,
  not nav chrome. Below it, **modules are cut into the paper floor**: each is a
  white face on the buff floor with a real gap between them, and a small header
  tab. The map is a module, not wallpaper. The cascade board is a module.
- Content pages (`/docs`, legal): Long Document, typography only.

## THE LANDING BOUNDARY — read before touching any token

`:root` belongs to the landing. **10+ landing components read `--ae-*` directly**
(`components/landing/*`, the demo subtree, footer, pricing, four-plans,
masked-wordmark, methodology, final-cta, aviation-substrate).

- The console's register is scoped to **`.simulator-shell`**. Never re-derive
  `:root` to serve the console.
- A rendered baseline of the landing's 46 `:root` values is kept at
  `.landing-baseline/root-tokens.json` (gitignored, local guard). Re-capture
  after any token work and diff; **any change there is a landing regression.**

## Colors

Authoritative source: `apps/web/app/globals.css`, surfaced through
`apps/web/lib/design-tokens.ts`. Verify every change with
`node apps/web/scripts/check-contrast.mjs`, which fails the build.

### The elevation ladder (console register)

Solved at ≥1.25 between consecutive steps. A module RAISES by being lighter
than the floor; a well RECESSES by being darker.

| Token | Value | Job | Step |
|---|---|---|---|
| `--ae-surface` | `#FFFEF9` | module face | — |
| `--ae-bg` | `#E8DFCB` | board floor | 1.312 below surface |
| `--ae-surface-2` | `#D2C4A5` | well, tab bar, masthead ground | 1.301 below bg |
| `--ae-surface-3` | `#BFAE88` | track fill, deep recess | 1.265 below surface-2 |

**A card inside a module steps DOWN to the floor colour.** The module face is
already the lightest surface, so a card on it cannot raise. There is no separate
`--ae-raised` step; that token is retired.

### Type

| Token | Value | Job |
|---|---|---|
| `--ae-text` | `#1C1426` | headings, emphasis, identity ink |
| `--ae-text-2` | `#38332A` | running text |
| `--ae-text-3` | `#443F31` | captions, labels — **AA on every surface incl. `#BFAE88`** |
| `--ae-focus` | `#5B3FA8` | focus ring — solid, ≥3:1 as a non-text mark |

`--ae-text-3` was `#56503F` and measures **3.68:1** on the new darkest surface,
i.e. an AA failure. It is re-inked to `#443F31` (4.81:1). Do not lighten either
text step without re-running the gate.

### Pigments — semantic, never decorative

| Pigment | Value | Job | On floor |
|---|---|---|---|
| plum | `--ae-teal` `#5B3FA8` | identity, action, recovery, active state | 5.82:1 |
| gold | `--ae-amber` `#9A6B27` | events, ops status, delayed | 3.52:1 |
| rose | `--ae-rose` `#C13A6B` | disruption | 3.88:1 |
| ops blue | `#1C6FA8` (map literal) | a flight that is OPERATING | 4.08:1 |
| ambient | `#93A9BC` (map literal) | other carriers' traffic — deliberately quiet | 1.83:1 |

**Gold was `#B8863C` and fails on the deeper paper: 2.43:1 as a mark, 3.19:1 as
text.** It is re-inked to `#9A6B27`, the lightest value that clears both
thresholds. This is the cost of a floor that actually separates, and it is the
right trade.

**Colour never fills a region.** Strategy is Restrained: paper neutrals plus
pigment as marks, underlines and narrow edge accents only.

**Cancelled is NEVER a hue.** Neutral, struck, dashed edge, and the word
CANCELLED. It recedes; it does not compete.

### Cascade ramp — one source, gated on adjacency

`lib/design-tokens.ts` owns it; the map and the cascade board both import it and
neither redeclares it. They once disagreed by a full cascade order under a
comment claiming they matched.

| Step | Fill | Adjacent ratio |
|---|---|---|
| 0 · direct | `#1E1533` | — |
| 1 · first order | `#906520` | 3.36:1 from direct |
| 2 · second order | `#DCD2B9` fill + `#5E4E2E` border | 3.43:1 from first |

Span 11.54:1. Step 2 is a pale fill whose **border** carries its contrast —
three steps at 3:1 need 9:1 of span, and requiring the middle step to also clear
3:1 against near-white needs ~27:1, which this surface does not have. The
constraint is real, so it is recorded rather than rediscovered.

**Severity is never colour alone.** Every bar and marker carries its generation
digit `0`/`1`/`2`. Operating blue stays lighter than direct, so a nominal flight
can never out-weigh a disrupted one.

## Typography

- Display: Inter Display 600–800, roman only. No display serif anywhere.
- Body: Inter 400/500.
- Mono: **JetBrains Mono, promoted.** It is the board's native voice — every
  flight ID, time, count, money figure, and status word.
- Eyebrow: 10.5px mono, 600, 0.14em, uppercase — THE one caps style. The
  `Eyebrow` primitive in `components/ds/primitives.tsx` is its only correct
  implementation.

## Spacing

4-pt scale via `tokens.spacing`. Named tokens only.

## Motion

- **The flip is the signature gesture and the only one.** It fires on a genuine
  state change — a flight's status changing, a plan committing — never on
  hover, never on mount, never on scroll. The seam exists only during the flip.
- **Hover changes rule weight, never position.** A card that translates on hover
  is banned outright; it was the single most-cited tell in the surface this
  world replaces.
- Easing `cubic-bezier(0.22, 0.9, 0.28, 1)`. App chrome ≤240ms, transform and
  opacity only.
- Reduced motion: the flip becomes an instant word swap at ≤150ms, no transform.

## Absolute bans

Enforceable ones are checked by `scripts/check-design.mjs`; a line the ban does
not describe is exempted inline with `design-ok: <reason>`.

- No hover translate or lift, anywhere.
- No glow, bloom, or `drop-shadow` used as atmosphere. The aircraft glyph's
  plum glow (`MARK_GLOW`) is deleted; a contact shadow for legibility on the
  basemap is the only shadow a mark may carry.
- No gradient sheen.
- No status dots — status is text with a pigment underline.
- No cancelled-as-hue.
- No second caps style.
- No permanent printed flap seam.
- No dark register, no theme toggle.
- App pages MUST NOT use enrichment; function carries the page. The globe
  remains the one exception, granted on function.

## Microinteractions stance

- Silent success over celebratory toasts; toasts carry data.
- Nothing auto-opens and nothing pre-decides. Collapsed launchers carry a count.
- Irreversible actions arm before they fire, stating the consequence in the
  operator's own units ("67 delayed · 14 FAR 117 flags · $3.18M"). Inline.
- Visual weight follows consequence: committed and applied own the filled
  treatment; selecting, inspecting and hovering get outline or tint.
- Focus ring: 3px `var(--ae-focus)`, instant, never animated.

## Navigation

- The **wordmark is a link.** From any `/simulator/*` route it returns to
  `/simulator`. A separate explicit control reaches the marketing site. The
  console previously had no home affordance at all.
- `SimulatorRail` is canonical for route↔icon pairing; the rail PUSHES, it does
  not overlay.

## Components

Shared primitives in `components/ds/primitives.tsx`; simulator chrome in
`components/simulator/`. Reuse before adding — the drift in this system has come
from re-implementing, not from gaps.

| Component | Contract |
|---|---|
| `Eyebrow` | the ONE caps style |
| `StatusBadge` | pigment UNDERLINE + text, never a dot |
| `Module` | white face on the floor, header tab, gap-separated. The board's unit. |
| `FlapCard` | rounded card; flips only on real state change; no resting seam |
| `SimulatorPageShell` | wrapper for secondary `/simulator/*` routes |

Every interactive component ships default, hover, focus-visible, active,
disabled, loading and empty. Half a set is not a component.

- Empty states state the truth and name a control that exists.
- Targets ≥24px, ≥44px for primary actions.
- Map overlay lanes are owned, one each; a new overlay claims a lane or joins a
  cluster, never stacks.

## What pages MUST share

Paper/ink register and semantic pigments · Inter / Inter Display / JetBrains
Mono · the eyebrow style · the focus ring · no-status-dots · the honest-copy
rule (no invented metrics; simulation data labelled as simulation; Nimbus Air is
fictional and never presented as a real carrier).

## What pages MAY differ on

The landing runs GSAP-staged registers and keeps its own `:root` values; the
console stays on the board register end to end. Map and cascade data-viz use
canvas-literal pigments imported from `design-tokens`, because Leaflet's canvas
renderer cannot read a CSS variable.

## Olus opening direction — 2026-09-14

The current rebrand brief is `docs/OLUS-MASTER-BUILD-PROMPT.md`. Its dark aviation photography, semantic amber/jade, readable operator UI and staged review override older landing palette and art-direction notes. Stage B is implemented on `ui/olus-opening`; motion and verification scope are in `docs/motion-spec.md` and `docs/opening-handoff.md`. The MacBook remains a working DOM demo. Globe and dashboard UX work follow opening review.
