"use client"
/**
 * THE HAIRLINE MOSAIC — the console's component vocabulary.
 *
 * Direction contract: see the HTML comment at the top of `app/layout.tsx`
 * (seed 688f3053). The short version, because these primitives only make sense
 * against it:
 *
 *   A dispatcher's screen is a board that holds the whole network at once.
 *   Density is the feature. Regions are hairline-ruled MODULES packed edge to
 *   edge, each headed by a small tab. Colour never fills a surface — it appears
 *   as a narrow spectral fringe on a module's edge, and as marks. Elevation is
 *   a CUT, never a cast shadow. State is a MARK, never a hue alone.
 *
 * Why these exist as primitives rather than as classes on call sites: the drift
 * in this system has always come from re-implementing, not from gaps (design.md
 * says so, and the audit that found eight competing uppercase styles on one
 * screen proved it). A module drawn by hand is a module that will disagree with
 * the next one by a pixel, and a 1px disagreement is the whole difference
 * between "dense" and "cluttered".
 *
 * Every primitive here ships default, hover, focus-visible, active, disabled
 * and empty where the role admits them. Half a set is not a component.
 */

import { forwardRef, type CSSProperties, type ReactNode } from "react"
import { c, ff, r, sp } from "@/lib/design-tokens"

/* ════════════════════════════════════════════════════════════════════════
   RULE — the hairline. One weight, one colour, no exceptions.
   ════════════════════════════════════════════════════════════════════════ */

export const RULE = `1px solid ${c.hairline}`

/* ════════════════════════════════════════════════════════════════════════
   FRINGE — the spectral edge band.

   The ONE atmospheric use of colour on this console, and it is deliberately
   hard to misuse: it is a 2px band, it only ever attaches to an edge, and it
   cannot be given a fill. `tone` picks a single semantic hue; omitting it
   gives the full diffraction band, which is reserved for the ACTIVE module.
   ════════════════════════════════════════════════════════════════════════ */

export type FringeTone = "mint" | "rose" | "violet" | "spectral" | "none"

const FRINGE_PAINT: Record<Exclude<FringeTone, "none">, string> = {
  mint:     c.fringeMint,
  rose:     c.fringeRose,
  violet:   c.fringeViolet,
  spectral: "var(--ae-fringe)",
}

export function Fringe({
  tone = "spectral",
  side = "top",
  size = 2,
}: {
  tone?: FringeTone
  side?: "top" | "bottom" | "left" | "right"
  size?: number
}) {
  if (tone === "none") return null
  const vertical = side === "left" || side === "right"
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        [side]: 0,
        ...(vertical ? { top: 0, bottom: 0, width: size } : { left: 0, right: 0, height: size }),
        background: FRINGE_PAINT[tone],
        // The band follows the module's own corner so it never overhangs a
        // rounded edge — a 2px stripe sticking out past a corner is the tell
        // that a decoration was bolted on rather than built in.
        borderRadius: "inherit",
        pointerEvents: "none",
      } as CSSProperties}
    />
  )
}

/* ════════════════════════════════════════════════════════════════════════
   MODULE — the mosaic's unit.

   A ruled rectangle with a small header tab, packed edge to edge against its
   neighbours. `flush` drops the outer rule on the sides that meet another
   module, so a mosaic never draws a 2px double-rule down its seams. That
   doubling is what makes a dense grid read as a cage.
   ════════════════════════════════════════════════════════════════════════ */

export const Module = forwardRef<
  HTMLElement,
  {
    /** The header tab's label. Omit for a module that carries no head. */
    title?: ReactNode
    /** Right-aligned content in the head — counts, a "view all", a switch. */
    action?: ReactNode
    /** The active module wears the full spectral band. */
    fringe?: FringeTone
    /** Sides whose outer rule is dropped because a neighbour supplies it. */
    flush?: Array<"top" | "bottom" | "left" | "right">
    /** Recess the body into the module — a well rather than a face. */
    well?: boolean
    children: ReactNode
    style?: CSSProperties
    bodyStyle?: CSSProperties
    as?: "section" | "div" | "aside"
    "aria-label"?: string
    /** Removes the module and everything in it from pointer, focus and the
     *  a11y tree — used when a decision surface is covering it. */
    inert?: boolean
    "aria-hidden"?: boolean
  }
>(function Module(
  { title, action, fringe = "none", flush = [], well = false, children, style, bodyStyle, as = "section", ...rest },
  ref,
) {
  const Tag = as as "section"
  const edge = (side: "top" | "bottom" | "left" | "right") => (flush.includes(side) ? "none" : RULE)

  return (
    <Tag
      ref={ref as never}
      {...rest}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        background: c.canvas,
        borderTop: edge("top"),
        borderBottom: edge("bottom"),
        borderLeft: edge("left"),
        borderRight: edge("right"),
        ...style,
      }}
    >
      <Fringe tone={fringe} side="top" />

      {(title || action) && (
        <header
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: sp.xs,
            // A title-only tab stays compact; action targets set their own height.
            minHeight: 28,
            padding: `0 ${sp.sm}px`,
            borderBottom: RULE,
            background: c.surfaceSoft,
          }}
        >
          <ModuleTitle>{title}</ModuleTitle>
          {action && <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: sp.xxs }}>{action}</span>}
        </header>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: well ? c.surfaceSoft : undefined,
          ...bodyStyle,
        }}
      >
        {children}
      </div>
    </Tag>
  )
})

/**
 * The module's name. Mono, 10.5px, 0.12em, uppercase.
 *
 * This is a MODULE HEAD, not the banned eyebrow-above-a-heading: it labels a
 * region of a dense board where every rectangle needs to say what it is, and
 * it never sits above a display heading acting as its kicker.
 */
export function ModuleTitle({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: ff.mono,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: c.muted,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </span>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   CUT — a card cut INTO a module.

   The honest version of the glass/elevation question. On this register a card
   does not float above the white module; it is recessed into it, and the two
   hairlines of `--ae-edge` describe the thickness of the cut. There is no drop
   shadow on this console — a cast shadow implies a light source the board does
   not have, and on the dark register it does nothing at all.
   ════════════════════════════════════════════════════════════════════════ */

export function Cut({
  children,
  fringe = "none",
  interactive = false,
  selected = false,
  disabled = false,
  onClick,
  style,
  ...rest
}: {
  children: ReactNode
  fringe?: FringeTone
  interactive?: boolean
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
  style?: CSSProperties
  // HTMLElement, not HTMLDivElement: these props land on a <button> in the
  // interactive branch, and element-specific handler types are invariant.
} & Omit<React.HTMLAttributes<HTMLElement>, "onClick" | "style">) {
  // Two explicit branches rather than a dynamic tag. A `button | div` union
  // collapses this component's props to `never` under JSX inference, and the
  // cast that silences it also silences every real prop error underneath.
  const shared: CSSProperties = {
    position: "relative",
    display: "block",
    width: "100%",
    textAlign: "left",
    background: c.raised,
    border: RULE,
    // Selected is an OUTLINE, not a fill — visual weight follows
    // consequence, and selecting is not committing (design.md 2026-08-05).
    outline: selected ? `2px solid ${c.teal}` : "none",
    outlineOffset: -2,
    borderRadius: r.sm,
    boxShadow: "var(--ae-edge)",
    padding: sp.sm,
    opacity: disabled ? 0.55 : 1,
    font: "inherit",
    color: "inherit",
    ...style,
  }

  if (!interactive) {
    return (
      <div {...rest} className="ae-cut" style={shared}>
        <Fringe tone={fringe} side="left" />
        {children}
      </div>
    )
  }

  return (
    <button
      {...rest}
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      aria-pressed={selected}
      className="ae-cut ae-cut--interactive"
      style={{ ...shared, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <Fringe tone={fringe} side="left" />
      {children}
    </button>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   FIGURE — a number that is meant to be read, compared and scanned.

   Tabular numerals are not a nicety here: a column of costs whose digits do
   not align cannot be compared at a glance, which is the only reason the
   column exists. `font-variant-numeric` is one of the browser surfaces the
   craft floor names as routinely skipped.
   ════════════════════════════════════════════════════════════════════════ */

export function Figure({
  value,
  unit,
  label,
  tone = "ink",
  size = 15,
}: {
  value: ReactNode
  unit?: string
  label?: ReactNode
  tone?: "ink" | "muted" | "rose" | "amber" | "teal"
  size?: number
}) {
  const paint = { ink: c.ink, muted: c.muted, rose: c.roseInk, amber: c.amberInk, teal: c.tealInk }[tone]
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3, minWidth: 0 }}>
      <span
        style={{
          fontFamily: ff.mono,
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum" 1, "zero" 1',
          fontSize: size,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: paint,
        }}
      >
        {value}
      </span>
      {unit && (
        <span style={{ fontFamily: ff.mono, fontSize: Math.max(9.5, size - 4), fontWeight: 500, color: c.muted }}>
          {unit}
        </span>
      )}
      {label && (
        <span style={{ fontFamily: ff.body, fontSize: 11.5, fontWeight: 500, color: c.muted, marginLeft: 2 }}>
          {label}
        </span>
      )}
    </span>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   MARK — state as a mark, never as a hue alone.

   Donated by the cutting-bench world and required independently by
   design.md's ban on status dots and its never-colour-alone rule. Each mark
   is a distinct GLYPH plus a word, so the encoding survives monochrome,
   glare and colour blindness — and so a screen reader gets the word rather
   than a coloured square.
   ════════════════════════════════════════════════════════════════════════ */

export type MarkKind = "committed" | "applied" | "armed" | "deferred" | "unavailable" | "watching" | "nominal"

const MARKS: Record<MarkKind, { glyph: string; word: string; paint: string }> = {
  // A band struck across it — the editor's tape flag.
  committed:   { glyph: "▬", word: "Committed",   paint: c.tealInk },
  applied:     { glyph: "✓", word: "Applied",     paint: c.tealInk },
  armed:       { glyph: "◆", word: "Armed",       paint: c.roseInk },
  deferred:    { glyph: "↓", word: "Deferred",    paint: c.muted },
  // A punched corner — the frame that cannot be used.
  unavailable: { glyph: "✕", word: "Unavailable", paint: c.muted },
  watching:    { glyph: "◉", word: "Watching",    paint: c.amberInk },
  nominal:     { glyph: "–", word: "Nominal",     paint: c.muted },
}

export function Mark({ kind, label }: { kind: MarkKind; label?: string }) {
  const m = MARKS[kind]
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: ff.mono,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: m.paint,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ fontSize: 9, lineHeight: 1 }}>{m.glyph}</span>
      {label ?? m.word}
    </span>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   CHIP — a small bordered tag. Hairline, never a filled pill.
   ════════════════════════════════════════════════════════════════════════ */

export function Chip({
  children,
  tone = "neutral",
  onClick,
  selected = false,
  title,
}: {
  children: ReactNode
  tone?: "neutral" | "rose" | "amber" | "teal"
  onClick?: () => void
  selected?: boolean
  title?: string
}) {
  const paint = { neutral: c.body, rose: c.roseInk, amber: c.amberInk, teal: c.tealInk }[tone]
  const Tag = onClick ? "button" : "span"
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      aria-pressed={onClick ? selected : undefined}
      className={onClick ? "ae-chip ae-chip--interactive" : "ae-chip"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        // 22px tall inside a 24px hit strip — the strip is applied by
        // .ae-chip--interactive in globals.css so the visual stays compact
        // while the target clears WCAG 2.5.8.
        height: 22,
        padding: "0 7px",
        borderRadius: r.xs,
        border: `1px solid ${selected ? paint : c.hairline}`,
        background: selected ? "var(--ae-neutral-bg)" : "transparent",
        color: paint,
        fontFamily: ff.mono,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        cursor: onClick ? "pointer" : undefined,
      }}
    >
      {children}
    </Tag>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   GLASS — a panel over the map, and nowhere else.

   Its boundary is the edge, not the fill; see the note on `c.glass` in
   design-tokens.ts for the measurement that forced that. `backdrop-filter` is
   the effect, not the look: it exists so the operator keeps seeing the network
   under the panel, which is the only thing that justifies a translucent
   surface on an operations console at all.
   ════════════════════════════════════════════════════════════════════════ */

export function Glass({
  children,
  style,
  ...rest
}: { children: ReactNode; style?: CSSProperties } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        background: c.glass,
        WebkitBackdropFilter: "var(--ae-glass-blur)",
        backdropFilter: "var(--ae-glass-blur)",
        border: `1px solid ${c.glassLine}`,
        borderRadius: r.sm,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
