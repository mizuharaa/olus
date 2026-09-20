/**
 * Olus Design System — canonical tokens. CONTROL-TOWER EDITORIAL edition (landing palette).
 *
 * The vocabulary:
 *
 *   ink    #141019   warm ink          — type, dark marks, primary CTA
 *   paper  #F5F0E3   warm beige         — surfaces
 *   sky    #8B6FD0   the atmosphere     — gradients, chrome accents
 *   teal   #5B3FA8   the identity color — actions, links, recovery, active
 *   pink   #C13A6B   the disruption     — events, cascade energy (landing)
 *   amber  #B8863C   THE status color   — delayed / warning (simulator ops)
 *
 * "Cancelled / not operating" is NOT a hue: it renders as neutral gray with
 * a strike, dash, or x. Severity within amber is carried by opacity steps.
 *
 * TWO REGISTERS, ONE TOKEN SET. `:root` carries the landing/docs register;
 * `.register-dark` (name kept for call-site stability — its values are now
 * BRIGHT) carries the denser simulator app register. Components reference
 * the same `c.*` token in both worlds.
 *
 * Chromatic constants that must survive *outside* CSS (Leaflet's canvas
 * renderer resolves colors in JS) live in `pigment.*` as literal hex.
 */

// ── Literal pigments (canvas-safe; identical in both registers) ─────────
export const pigment = {
  ink:   "#1C1426",
  paper: "#F5F1E8",
  gray:  "#8C8272", // warm-gray mid neutral
  sky:   "#8B6FD0", // lavender atmosphere
  teal:  "#5B3FA8", // royal plum — identity/action (name kept, value re-inked)
  amber: "#B8863C", // beige gold — status
  rose:  "#C13A6B", // disruption rose (landing narrative; plum = recovery)
} as const

/**
 * Cascade severity — THE single source for this encoding.
 *
 * This exists because the timeline and the map had drifted into meaning
 * different things by the same pixel: #B8863C labelled "Direct" in the
 * timeline legend while rendering *first-order cascade* on the map, and a
 * comment in cascade-timeline.tsx asserted the two vocabularies matched. For
 * a product whose whole premise is reading how a disruption propagates, an
 * operator learning the key from one surface mis-read the other by exactly
 * one cascade order. A comment cannot enforce an invariant; a shared import
 * can, so both surfaces now resolve their colours from here.
 *
 * Literal hex, not var(), because Leaflet's canvas renderer resolves colours
 * in JS and cannot read a CSS custom property.
 *
 * The ramp varies LIGHTNESS, not alpha. The previous ramp was one amber at
 * three alpha steps, which is unfixable at this contrast: any alpha faint
 * enough to read as "less severe" also drops under 3:1. Where a step must
 * stay visually light, its border carries the contrast instead of its fill —
 * which also stops severity being conveyed by colour alone.
 */
/**
 * Cascade severity ramp — the console's single most important encoding.
 *
 * RE-SPACED 2026-08-10. The previous ramp varied lightness, as this comment
 * block has always claimed, but it varied it nowhere near enough: adjacent
 * steps measured 1.61:1 (direct→order1) and 1.53:1 (order1→order2), and the
 * full semantic span was 2.47:1 — under the 3:1 non-text floor for the WHOLE
 * ramp, not just between neighbours. Rendered, every bar was the same brown.
 * `order2.border` was also `#A0691C`, byte-identical to `order1.fill`, so the
 * border could not separate them either.
 *
 * The new steps are ≥3:1 apart from their neighbours — verified, not asserted,
 * by `scripts/check-contrast.mjs`, which now gates adjacency and not only each
 * step against the surface.
 *
 * The three constraints cannot all be maximised at once and it is worth
 * recording why. Three steps at 3:1 each spans 9:1; requiring the MIDDLE step
 * to also clear 3:1 against near-white paper needs 27:1 of range, and black on
 * this surface is ~21:1. So `order2` is deliberately a PALE FILL whose dark
 * border carries its 3:1 — the same device `none` and `cancelled` already use.
 *
 * `direct` stays darker than operating blue on the basemap (13.81 vs 5.10), so
 * DESIGN.md's rule that a nominal flight can never out-weigh a disrupted one
 * still holds. Note it is deliberately NOT 3:1 from the blue: gold and blue are
 * 168 degrees apart and separate by hue; forcing a luminance gap as well would
 * push one of them out of its family for no perceptual gain.
 *
 * Severity is never colour-alone regardless — `glyph` is the redundant channel
 * (see cascade-timeline.tsx and flight-map.tsx), so the ramp degrades to a
 * readable generation number under monochrome, glare, or colour blindness.
 */
/**
 * INVERTED FOR THE DARK CONSOLE, 2026-08-16.
 *
 * The ramp used to run dark→light because it was drawn on warm paper: the
 * worst cascade generation was the heaviest ink. On the #14161C console floor
 * that reads backwards — `direct` at #C2560F measures 1.4:1 against the panel,
 * so the MOST severe step would be the least visible thing on screen. Severity
 * now runs light→dark: the hit itself is the brightest mark in the frame.
 *
 * The three-step constraint recorded in design.md holds in this direction too,
 * and the arithmetic is worth writing down because it is not obvious that it
 * would. Requiring every step to clear 3:1 against the panel puts a floor of
 * L ≥ 0.124 on all three; requiring consecutive steps to clear 3:1 of each
 * other then forces L ≥ 0.471 on the second and L ≥ 1.513 on the third. There
 * is no colour with luminance above 1. So, exactly as on paper, the MIDDLE
 * step is the one that gives: `order2` is a dark fill whose brighter BORDER
 * carries its 3:1 against the surface, and `glyph` carries the ordering as a
 * redundant channel that survives monochrome and colour blindness.
 *
 * `direct` → `order1` IS gated at 3:1 (measures 3.35) because that pair is the
 * one an operator reads under time pressure: "was this hit, or is it downstream
 * of something that was hit". See scripts/check-contrast.mjs.
 */
export const cascade = {
  direct: { fill: "#FF7A1A", border: "#FF7A1A", glyph: "0" }, // the hit itself — brightest mark on the console
  order1: { fill: "#C2560F", border: "#FF7A1A", glyph: "1" },
  order2: { fill: "#1A222D", border: "#FF7A1A", glyph: "2" }, // dark fill, border holds 3:1 vs surface
  none:   { fill: "#1E222A", border: "#5C6474", glyph: "" },  // nominal — quiet, still bounded
  // Cancelled is never a hue (design.md): neutral + a dashed edge at the mark.
  cancelled: { fill: "#191D24", border: "#7C8494", glyph: "✕" },
} as const

/**
 * The same ramp for the LIGHT console register.
 *
 * Severity runs dark→light here — the direct hit is the HEAVIEST ink, which is
 * the correct direction on paper and the exact inverse of the dark register's
 * light→dark. That inversion is the whole reason this is a second table rather
 * than an alpha or a filter: "most severe" means "furthest from the surface",
 * and which direction that is depends on the surface.
 *
 * The three-step constraint recorded above holds identically, and so does its
 * resolution: the MIDDLE step is the one that gives, so `order2` is a pale fill
 * whose darker BORDER carries its 3:1, and `glyph` remains the redundant
 * channel that survives monochrome and colour blindness in both registers.
 */
export const cascadeLight = {
  direct: { fill: "#C2560F", border: "#C2560F", glyph: "0" },
  order1: { fill: "#C2560F", border: "#C2560F", glyph: "1" },
  order2: { fill: "#FF7A1A", border: "#C2560F", glyph: "2" }, // pale fill, border holds 3:1
  none:   { fill: "#ECE8E1", border: "#6B7785", glyph: "" },
  cancelled: { fill: "#EDEAE3", border: "#6B7785", glyph: "✕" },
} as const

export type CascadeRamp = typeof cascade
export type CascadeStep = keyof typeof cascade

/** The ramp for a resolved console theme. */
export const cascadeFor = (light: boolean): CascadeRamp =>
  (light ? cascadeLight : cascade) as CascadeRamp

/**
 * Ink that reads ON a given cascade step.
 *
 * Which steps need light ink flips with the register, because which steps are
 * DARK flips with it: on the console only `direct` is bright enough to need
 * dark ink; on paper `direct` and `order1` are the two dark steps.
 */
export const cascadeInkFor = (step: CascadeStep, light: boolean): string =>
  light
    ? (step === "direct" || step === "order1" ? "#FFFFFF" : "#1C1426")
    : (step === "direct" ? "#171308" : "#F2F3F7")

/** Dark-register convenience wrapper, kept for call sites that never theme. */
export const cascadeInk = (step: CascadeStep): string => cascadeInkFor(step, false)

export const tokens = {
  colors: {
    // ── Brand & action ────────────────────────────────────────────────
    // Light register: ink button, paper label. Dark register: teal button,
    // ink label. One primary action color per register.
    primary:        "var(--ae-primary)",
    primaryActive:  "var(--ae-primary-active)",

    // ── Surfaces ──────────────────────────────────────────────────────
    canvas:              "var(--ae-surface)",    // card / panel floor
    surfaceSoft:         "var(--ae-surface-2)",  // recessed panel, tab well
    surfaceStrong:       "var(--ae-surface-3)",  // track fills, deep recess
    /**
     * A card sitting ON a panel.
     *
     * The elevation ladder had no rung for this, so every card inside the
     * context column was drawn with `canvas` — the same value as the panel
     * behind it, 1.00:1 — and a 1px hairline was the only thing describing it.
     * That is the "punched-out box that looks like it has layers" defect: an
     * outline standing in for a surface. Pair it with `sh.edge`; on a near-
     * black register the lit top edge does most of the work a cast shadow
     * would do on paper.
     */
    raised:              "var(--ae-raised)",
    surfaceDark:         pigment.ink,            // ink card (both registers)
    surfaceDarkElevated: "#123349",              // raised step on ink
    hairline:            "var(--ae-line)",       // 1px borders, dividers

    /**
     * GLASS — a translucent panel, and ONLY over the map.
     *
     * Not a decorative treatment. It exists where a surface has to sit on the
     * map and the operator still needs to see the network through it; anywhere
     * else, use `canvas`. Its boundary is `glassLine`, not its fill: a white
     * panel over the Positron basemap composites to 1.05:1 against the tile, so
     * the fill cannot describe the panel and no alpha value fixes that. The
     * edge carries the 3:1 instead — the same remedy the cascade ramp's pale
     * `order2` step uses. Both halves are asserted by check-contrast.mjs's
     * GLASS block, which composites the alpha rather than trusting the token.
     */
    glass:      "var(--ae-glass)",
    glassLine:  "var(--ae-glass-line)",

    /**
     * THE SPECTRAL FRINGE — the one atmospheric use of colour on the console.
     *
     * Confined to a 1–2px band on a module's edge; it never fills a surface and
     * the text field stays achromatic. Taken from cloud-edge diffraction, which
     * is the product's own subject rather than a gradient preset. Each hue
     * still clears 3:1 on its register's surfaces, so a fringe that happens to
     * carry meaning is never the weak channel — but meaning is carried by a
     * MARK first, per the never-colour-alone rule.
     */
    fringeMint:   "var(--ae-fringe-mint)",   // nominal / recovered
    fringeRose:   "var(--ae-fringe-rose)",   // disrupted
    fringeViolet: "var(--ae-fringe-violet)", // the active band

    // ── Type ──────────────────────────────────────────────────────────
    ink:           "var(--ae-text)",    // headings, emphasis
    body:          "var(--ae-text-2)",  // running text
    muted:         "var(--ae-text-3)",  // captions, labels
    borderStrong:  "var(--ae-line-strong)",
    onPrimary:     "var(--ae-on-primary)",
    /**
     * The label that sits ON a `teal` fill.
     *
     * Teal is a DARK plum on paper and on the light board, and a LIGHT plum on
     * the dark console — so the label that reads on it inverts with the
     * register, and no single literal is correct. Four call sites hardcoded
     * `#12101A` (right for dark, 2.44:1 on the light board) and shipped an
     * unreadable notification count. Reach for this token, never a literal.
     */
    onTeal:        "var(--ae-on-teal)",

    // ── Chromatic accents (register-aware text steps) ────────────────
    sky:       "var(--ae-sky)",        // atmosphere accent
    skyInk:    "var(--ae-sky-ink)",
    skyBg:     "var(--ae-sky-bg)",
    teal:      "var(--ae-teal)",       // graphic teal (dots, bars, borders)
    tealInk:   "var(--ae-teal-ink)",   // teal as small text — AA per register
    amber:     "var(--ae-amber)",
    amberInk:  "var(--ae-amber-ink)",
    rose:      "var(--ae-rose)",      // disruption pink
    roseInk:   "var(--ae-rose-ink)",
    roseBg:    "var(--ae-rose-bg)",
    roseSoft:  "var(--ae-rose-soft)",
    roseSoft2: "var(--ae-rose-soft2)",
    // Legacy names — rust was retired; both alias amber. Do not use.
    rust:      "var(--ae-rust)",
    rustInk:   "var(--ae-rust-ink)",

    // ── Legacy signature aliases — every old call site snaps into the
    //    five-color system through these. Do not use in new code. ────
    signatureCoral:   "var(--ae-amber)",
    signatureForest:  "var(--ae-teal-ink)",
    signatureCream:   "var(--ae-surface-2)",
    signaturePeach:   "var(--ae-amber)",
    signatureMint:    "var(--ae-teal)",
    signatureYellow:  "var(--ae-amber)",
    signatureMustard: "var(--ae-amber)",

    // ── Semantic ──────────────────────────────────────────────────────
    link:          "var(--ae-teal-ink)",
    linkActive:    "var(--ae-teal-ink)",
    info:          "var(--ae-teal-ink)",
    infoBorder:    "var(--ae-teal)",
    success:       "var(--ae-teal-ink)",
    successBorder: "var(--ae-teal)",

    // ── Status palette — same color = same meaning everywhere ────────
    // dot = graphic pigment (markers, swatches); ink = AA text step;
    // bg = 10–16% tint of the pigment on the register surface.
    // On-time is deliberately QUIET (neutral) — nominal state shouldn't shout.
    statusOnTime: {
      ink: "var(--ae-text-2)",
      bg:  "var(--ae-neutral-bg)",
      dot: "var(--ae-teal)",
    },
    statusDelayed: {
      ink: "var(--ae-amber-ink)",
      bg:  "var(--ae-amber-bg)",
      dot: "var(--ae-amber)",
    },
    // Cancelled = not operating = NEUTRAL. Always pairs with a strike,
    // dash, or x — never a status hue, never color-alone.
    statusCancelled: {
      ink: "var(--ae-text-2)",
      bg:  "var(--ae-neutral-bg)",
      dot: "var(--ae-line-strong)",
    },
    statusRecovered: {
      ink: "var(--ae-teal-ink)",
      bg:  "var(--ae-teal-bg)",
      dot: "var(--ae-teal)",
    },

    // ── Cascade severity — resolved from the shared `cascade` ramp above,
    //    so the timeline and the map cannot drift apart again. ──
    cascadeDirect:  cascade.direct.fill,
    cascadeOrder1:  cascade.order1.fill,
    cascadeOrder2:  cascade.order2.fill,
    cascadeNone:    cascade.none.border,
  },

  radius: {
    xs:   2,
    sm:   6,
    md:   10,
    lg:   12,
    pill: 9999,
    full: 9999,
  },

  spacing: {
    xxs:     4,
    xs:      8,
    sm:     12,
    md:     16,
    lg:     24,
    xl:     32,
    xxl:    48,
    section: 112, // vertical rhythm between landing sections
  },

  fontFamily: {
    // ONE typeface family. Inter Display is Inter's optical-size variant —
    // same family, tuned cap-height for headlines. Mono is reserved for
    // code blocks, flight IDs, timestamps, and tabular ops data only.
    display: '"Inter Display", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    body:    '"Inter", "Inter Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono:    '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },

  // Typography roles. Three real tiers — display, body, label — with a
  // couple of intermediate sizes for dense panel UI. No five-near-identical
  // sizes; no default uppercase anywhere except `eyebrow`.
  typography: {
    displayXl:  { size: 56,  weight: 600, lh: 1.04, ls: "-0.022em" }, // landing h1
    displayLg:  { size: 40,  weight: 600, lh: 1.10, ls: "-0.018em" }, // CTA band h2
    displayMd:  { size: 28,  weight: 600, lh: 1.16, ls: "-0.012em" }, // section h2
    titleLg:    { size: 20,  weight: 550, lh: 1.30, ls: "-0.008em" }, // card titles
    titleMd:    { size: 16,  weight: 550, lh: 1.40, ls: "0" },        // panel titles
    titleSm:    { size: 14,  weight: 550, lh: 1.40, ls: "0" },        // row titles
    labelMd:    { size: 14,  weight: 500, lh: 1.40, ls: "0" },
    button:     { size: 14,  weight: 500, lh: 1.40, ls: "0" },
    bodyMd:     { size: 14,  weight: 400, lh: 1.55, ls: "0" },        // running text
    caption:    { size: 12,  weight: 450, lh: 1.45, ls: "0" },        // meta text
    legal:      { size: 12,  weight: 450, lh: 1.45, ls: "0" },
    eyebrow:    { size: 11,  weight: 550, lh: 1.2,  ls: "0.14em" },   // THE caps style
    monoSm:     { size: 11.5,weight: 450, lh: 1.5,  ls: "0" },
    monoMd:     { size: 13,  weight: 500, lh: 1.5,  ls: "0" },
  },

  shadow: {
    flat:        "none",
    /** 1px lit top edge — what "raised" looks like on a near-black surface. */
    edge:        "var(--ae-edge)",
    buttonRest:  "0 1px 2px rgba(11,36,52,0.10)",
    buttonFocus: "0 0 0 3px var(--ae-focus)",
    cardSoft:    "0 1px 2px rgba(11,36,52,0.05)",
    cardElev:    "0 6px 24px rgba(11,36,52,0.10)",
    overlay:     "0 16px 48px rgba(11,36,52,0.16)",
  },
} as const

export type Tokens = typeof tokens

// Convenience aliases used by inline-style call sites.
export const c  = tokens.colors
export const r  = tokens.radius
export const sp = tokens.spacing
export const ty = tokens.typography
export const ff = tokens.fontFamily
export const sh = tokens.shadow

// ── Typography helper ────────────────────────────────────────────────
export function type(role: keyof typeof tokens.typography, color?: string) {
  const t = tokens.typography[role]
  return {
    fontSize: t.size,
    fontWeight: t.weight,
    lineHeight: t.lh,
    letterSpacing: t.ls,
    fontFamily: role.startsWith("display") ? ff.display : role.startsWith("mono") ? ff.mono : ff.body,
    color: color ?? c.body,
    ...(role === "eyebrow" ? { textTransform: "uppercase" as const } : {}),
  } as const
}

// Status badge background + ink for a flight state.
export function statusTokens(state: "on-time" | "delayed" | "cancelled" | "recovered") {
  switch (state) {
    case "on-time":    return c.statusOnTime
    case "delayed":    return c.statusDelayed
    case "cancelled":  return c.statusCancelled
    case "recovered":  return c.statusRecovered
  }
}
