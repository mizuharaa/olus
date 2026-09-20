"use client"
import { useMemo } from "react"
import { motion } from "framer-motion"
import { useSimulationStore } from "@/stores/simulation"
import { c, cascade, cascadeFor, cascadeInkFor, type CascadeStep, ff, r, sp, type } from "@/lib/design-tokens"
import { useConsoleTheme } from "@/lib/use-theme"
import { Eyebrow, Type } from "@/components/ds/primitives"

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6) // 6:00–23:00 UTC

// ─── Cascade severity → shared ramp ───────────────────────────────────────
// Resolved from `cascade` in design-tokens, which the map imports too. The
// previous version of this function hardcoded its own steps under a comment
// claiming they were "the same vocabulary as the map markers" — they were
// not, and that mismatch is why the legend taught the wrong key.
/**
 * SEVERITY AND CANCELLATION ARE ORTHOGONAL, AND MUST NOT SHARE A CHANNEL.
 *
 * This function used to return the cancelled treatment BEFORE it read
 * `cascadeOrder`. In a real incident most affected flights end up cancelled —
 * measured on a KORD severe closure: 65 of 67 — so every bar took the cancelled
 * branch and the three-step severity ramp rendered on ZERO of 80 bars, while
 * the legend directly above it taught five marks. The one encoding this product
 * exists to communicate was unreachable in its own steady state.
 *
 * Severity now always drives the FILL. Cancellation is a separate flag drawn as
 * a hatch + strike over that fill, which also satisfies design.md's "cancelled
 * is never a hue" without spending the colour channel on it.
 */
function getBarColor(
  status: string,
  cascadeOrder: number,
  light: boolean,
): { bg: string; border: string; cancelled: boolean; glyph: string; ink: string } {
  const cancelled = status === "cancelled"
  // The ramp follows the console theme. It has to: the map imports the same
  // source, so a timeline stuck on one register while the map switched to the
  // other would put the two surfaces a full severity order apart in
  // APPEARANCE — the exact drift design.md records the shared import as
  // existing to prevent, arriving by a new route.
  const cascade = cascadeFor(light)
  // The GENERATION NUMBER travels with the colour. Re-spacing the ramp to 3:1
  // between neighbours made the steps visible, but "visible" is not "legible
  // at a glance across 67 stacked rows" — and DESIGN.md's own rule is that
  // severity is never colour-alone. The digit says which generation of the
  // cascade this flight belongs to: 0 = hit by the disruption, 1 = knocked
  // over by an 0, 2 = knocked over by a 1. That is the distinction between
  // fixing a cause and fixing a symptom, and it was previously carried by
  // three browns 1.5:1 apart.
  const step = (k: CascadeStep) => ({
    bg: cascade[k].fill,
    border: cascade[k].border,
    cancelled,
    glyph: cascade[k].glyph,
    ink: cascadeInkFor(k, light),
  })
  if (cascadeOrder === 0) return step("direct")
  if (cascadeOrder === 1) return step("order1")
  if (cascadeOrder === 2) return step("order2")
  // Not in the cascade. A cancelled flight still has to read as cancelled, so
  // it keeps the neutral; an operating one is the quiet nominal step.
  return cancelled ? step("cancelled") : step("none")
}

function parseHourUTC(isoStr: string): number {
  if (!isoStr) return 8
  try {
    const d = new Date(isoStr)
    return d.getUTCHours() + d.getUTCMinutes() / 60
  } catch {
    return 8
  }
}

export function CascadeTimeline({
  selectedFlight,
  onFlightSelect,
}: {
  selectedFlight: string | null
  onFlightSelect: (id: string | null) => void
}) {
  const { flightStates, schedule } = useSimulationStore()
  // One source for the ramp, resolved once per render and passed down — so the
  // legend and the bars cannot disagree about what a severity step looks like.
  const { resolved } = useConsoleTheme()
  const lightTheme = resolved === "light"
  const ramp = cascadeFor(lightTheme)

  const displayFlights = useMemo(() => {
    const withState = schedule.map((f) => ({
      ...f,
      state:
        flightStates[f.id] || {
          status: "scheduled",
          delay_minutes: 0,
          cascade_order: -1,
          p_delayed: 0,
        },
    }))
    const affected = withState
      .filter((f) => f.state.cascade_order >= 0)
      .sort((a, b) => a.state.cascade_order - b.state.cascade_order)
    const others = withState.filter((f) => f.state.cascade_order < 0).slice(0, 12)
    // EVERY affected flight is rendered. The old `.slice(0, 40)` silently hid
    // 27 of 67 on a severe closure — and because the list is sorted by cascade
    // order, the 40 that survived were ALL direct hits, so the 1st- and
    // 2nd-order steps of the ramp never appeared on screen even once. The
    // truncation was hiding exactly the propagation the operator came to read.
    // The scroller handles the length; the header states the count.
    return [...affected, ...others]
  }, [flightStates, schedule])

  // Is anything actually disrupted? The back-fill above always supplies 18
  // nominal rows, so `displayFlights.length === 0` never fired and the nominal
  // network rendered as 18 identical grey bars — noise where a statement
  // belongs. This distinguishes "nothing wrong" from "no data".
  const affectedCount = useMemo(
    () => Object.values(flightStates).filter((f) => (f.cascade_order ?? -1) >= 0).length,
    [flightStates],
  )
  const nominal = affectedCount === 0 && schedule.length > 0

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: c.canvas }}>
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp.sm,
          padding: `${sp.xs}px ${sp.md}px`,
          background: c.canvas,
          borderBottom: `1px solid ${c.hairline}`,
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0, gap: sp.lg }}>
          {/* One line, not two. This is the hero surface now, so its header
              spends as little height as possible — the two-line title block
              plus a 5-swatch legend cost 64px of a 192px dock, i.e. a third of
              the region, before a single flight row. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: sp.xs, minWidth: 0 }}>
            {/* The visible name is the MODULE TAB above this row ("Cascade
                rail"), so printing it again here was the same word twice in
                28px of vertical space. The heading itself stays in the
                document — the console's outline is what a screen-reader user
                navigates by, and it had none at all before headings were
                added — it is just no longer drawn. */}
            <h2 className="ae-sr-only">Cascade rail</h2>
            <span style={{ ...type("caption", c.muted), fontSize: 10.5, fontFamily: ff.mono, whiteSpace: "nowrap" }}>
              18h · UTC{affectedCount > 0 ? ` · ${affectedCount} affected` : ""}
            </span>
          </div>

          {/* Legend — literally the same ramp object the bars and the map
              markers read from, and it now shows all three cascade steps.
              Showing only two was how "Direct" ended up labelling the colour
              the map uses for first-order. `paddingRight` reserves the lane
              the collapse button occupies, which used to clip "On time". */}
          <div
            className="hidden md:flex flex-wrap items-center justify-end"
            style={{ gap: 16, fontSize: 11, color: c.body, fontFamily: ff.body, fontWeight: 500, paddingRight: 34 }}
          >
            {/* The swatches carry the generation digit too, so the key teaches
                the redundant channel and not only the colour. */}
            <LegendSwatch step={ramp.direct} label="Direct hit" ink={cascadeInkFor("direct", lightTheme)} />
            <LegendSwatch step={ramp.order1} label="1st order" ink={cascadeInkFor("order1", lightTheme)} />
            <LegendSwatch step={ramp.order2} label="2nd order" ink={cascadeInkFor("order2", lightTheme)} />
            <LegendSwatch step={ramp.none} label="On time" />
            {/* Cancelled is a PATTERN, not a colour — it overlays whichever
                severity fill the flight already has, so it cannot be a swatch
                in the same series as the ramp. */}
            <LegendSwatch step={ramp.none} label="Cancelled" hatched />
          </div>
        </div>
      </div>

      {/* Hour axis */}
      <div
        style={{
          display: "flex",
          borderBottom: `1px solid ${c.hairline}`,
          flexShrink: 0,
          background: c.surfaceSoft,
        }}
      >
        <div
          style={{
            width: 112,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: "8px 12px",
            borderRight: `1px solid ${c.hairline}`,
            background: c.surfaceSoft,
          }}
        >
          <Eyebrow color={c.muted}>Flight</Eyebrow>
        </div>
        <div style={{ flex: 1, display: "flex" }}>
          {HOURS.filter((_, i) => i % 3 === 0).map((h) => (
            <div
              key={h}
              style={{
                flex: 1,
                fontSize: 11,
                fontFamily: ff.mono,
                fontWeight: 500,
                color: c.body,
                padding: "8px 0 8px 8px",
                borderLeft: `1px solid ${c.hairline}`,
                background: c.canvas,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {h < 24 ? `${String(h).padStart(2, "0")}:00` : `${h - 24}:00+1`}
            </div>
          ))}
        </div>
      </div>

      {/* Flight rows */}
      <div className="cascade-timeline-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        {nominal ? (
          // The DEFAULT state of this console, so it states the network's
          // condition rather than drawing 18 undifferentiated grey bars.
          <div
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: "100%", minHeight: 140,
              padding: `${sp.lg}px ${sp.xl}px`, textAlign: "center", gap: sp.xxs,
            }}
          >
            <Type as="span" role="titleSm" color={c.ink}>
              Network nominal — {schedule.length} legs, no cascades
            </Type>
            <Type as="span" role="bodyMd" color={c.muted} style={{ maxWidth: 460 }}>
              Trigger a disruption from the Events panel and affected flights will
              appear here, ordered by cascade generation.
            </Type>
          </div>
        ) : displayFlights.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 180,
              padding: "24px 32px",
              textAlign: "center",
              gap: 6,
            }}
          >
            <Type as="span" role="titleSm" color={c.ink}>No schedule rows yet</Type>
            <Type as="span" role="bodyMd" color={c.muted} style={{ maxWidth: 480 }}>
              Load the simulator or trigger a disruption — affected flights appear here with direct vs cascade coloring.
            </Type>
          </div>
        ) : (
          displayFlights.map((flight, rowIdx) => {
            const depHour = parseHourUTC(flight.scheduled_departure)
            const arrHour = parseHourUTC(flight.scheduled_arrival)
            const delayHr = (flight.state.delay_minutes || 0) / 60
            const newDep = depHour + delayHr
            const newArr = arrHour + delayHr
            const leftPct = Math.max(0, ((newDep - 6) / 18) * 100)
            const widthPct = Math.max(1.2, ((newArr - newDep) / 18) * 100)
            const isSelected = selectedFlight === flight.id
            const palette = getBarColor(flight.state.status, flight.state.cascade_order, lightTheme)
            // Zebra striping removed. It was a third near-identical beige
            // behind bars that are now genuinely coloured, and measured 1.01:1
            // against the cancelled fill — the rows read as banding, not data.
            // Row separation is carried by the hairline below.

            return (
              <div
                key={flight.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${flight.id}, ${flight.origin} to ${flight.destination}, ${flight.state.status}, delay ${flight.state.delay_minutes || 0} minutes`}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFlightSelect(isSelected ? null : flight.id) }
                  const rows = Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="button"]') ?? [])
                  const next = e.key === "ArrowDown" ? rowIdx + 1 : e.key === "ArrowUp" ? rowIdx - 1 : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : -1
                  if (next >= 0 && next < rows.length) { e.preventDefault(); rows[next].focus() }
                }}
                onClick={() => onFlightSelect(isSelected ? null : flight.id)}
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  borderBottom: `1px solid ${c.hairline}`,
                  cursor: "pointer",
                  minHeight: 46,
                  background: isSelected ? "var(--ae-teal-bg)" : c.canvas,
                  boxShadow: isSelected ? "inset 0 0 0 1px var(--ae-teal)" : undefined,
                }}
              >
                <div
                  style={{
                    width: 112,
                    flexShrink: 0,
                    padding: "8px 12px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    borderRight: `1px solid ${c.hairline}`,
                    background: c.canvas,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: ff.mono,
                      fontWeight: 600,
                      lineHeight: 1.2,
                      color: c.ink,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {flight.id}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: ff.mono,
                      fontWeight: 500,
                      color: c.muted,
                      marginTop: 2,
                    }}
                  >
                    {flight.origin}→{flight.destination}
                  </span>
                </div>

                <div style={{ flex: 1, position: "relative", minHeight: 46 }}>
                  {HOURS.filter((_, i) => i % 3 === 0).map((h) => (
                    <div
                      key={h}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        borderLeft: `1px solid ${c.hairline}`,
                        pointerEvents: "none",
                        left: `${((h - 6) / 18) * 100}%`,
                      }}
                    />
                  ))}

                  {flight.state.delay_minutes > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: 8,
                        bottom: 8,
                        border: `1.5px dashed ${c.signaturePeach}`,
                        borderRadius: r.sm,
                        background: c.statusDelayed.bg,
                        left: `${Math.max(0, ((depHour - 6) / 18) * 100)}%`,
                        width: `${(delayHr / 18) * 100}%`,
                      }}
                    />
                  )}

                  {/* The bar carries SEVERITY in its fill. Cancellation is drawn
                      on top as a hatch + strike, so the two facts occupy
                      different channels and a cancelled direct-hit still reads
                      as a direct hit. */}
                  <motion.div
                    style={{
                      position: "absolute",
                      top: 8,
                      bottom: 8,
                      borderRadius: r.sm,
                      background: palette.bg,
                      border: `1px ${palette.cancelled ? "dashed" : "solid"} ${palette.border}`,
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      minWidth: 6,
                      overflow: "hidden",
                      boxShadow: isSelected ? `0 0 0 2px ${c.canvas}, 0 0 0 3.5px var(--ae-teal)` : undefined,
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    title={`${flight.id} ${flight.origin}→${flight.destination}${
                      palette.cancelled ? " — CANCELLED" : ""
                    }${flight.state.delay_minutes > 0 ? ` (+${flight.state.delay_minutes}m)` : ""}${
                      flight.state.cascade_order === 0 ? " · direct hit"
                      : flight.state.cascade_order === 1 ? " · 1st-order cascade"
                      : flight.state.cascade_order === 2 ? " · 2nd-order cascade" : ""
                    }`}
                  >
                    {/* Generation number — the redundant, non-colour channel.
                        Only on bars wide enough to hold a digit without
                        clipping it; a 6px minimum-width bar gets the colour
                        and the tooltip, which is the honest trade. */}
                    {palette.glyph && widthPct >= 3.5 && (
                      <span
                        aria-hidden
                        style={{
                          position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)",
                          // 11px floor. This digit is a REDUNDANT ACCESSIBILITY
                          // CHANNEL; shipping it at 9.5px would have made the
                          // fallback for the colour ramp less legible than the
                          // ramp it backs up.
                          fontFamily: ff.mono, fontSize: 11, fontWeight: 700, lineHeight: 1,
                          color: palette.ink, opacity: 0.9, pointerEvents: "none",
                        }}
                      >
                        {palette.glyph}
                      </span>
                    )}
                    {palette.cancelled && (
                      <>
                        {/* diagonal hatch — a pattern, not a hue */}
                        <span
                          aria-hidden
                          style={{
                            position: "absolute", inset: 0,
                            backgroundImage: `repeating-linear-gradient(45deg, ${cascade.cancelled.border}00 0 3px, ${cascade.cancelled.border}80 3px 5px)`,
                          }}
                        />
                        {/* strike — the same "struck out" mark the map marker uses */}
                        <span
                          aria-hidden
                          style={{
                            position: "absolute", left: 2, right: 2, top: "50%",
                            height: 1.5, background: cascade.cancelled.border, transform: "translateY(-50%)",
                          }}
                        />
                      </>
                    )}
                  </motion.div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/** A swatch takes the same {fill,border} pair the bars do, so the key and the
 *  thing it explains cannot describe different colours. The border is what
 *  keeps the lighter steps above the 3:1 non-text minimum. */
function LegendSwatch({
  step,
  label,
  hatched,
  ink,
}: {
  step: { fill: string; border: string; glyph?: string }
  label: string
  hatched?: boolean
  /** Passed for the three cascade steps so the swatch shows its generation
   *  digit — the key has to teach the redundant channel, not just the hue. */
  ink?: string
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span
        style={{
          position: "relative",
          width: 22,
          height: 12,
          borderRadius: r.sm,
          background: step.fill,
          border: `1px ${hatched ? "dashed" : "solid"} ${step.border}`,
          flexShrink: 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: hatched
            ? `repeating-linear-gradient(45deg, ${step.border}00 0 3px, ${step.border}80 3px 5px)`
            : undefined,
        }}
      >
      </span>
      {/* The digit rides in the LABEL, not inside the 12px swatch: at swatch
          scale it could only be set at 9px, i.e. below the floor, which is the
          wrong place to save four pixels on the key that teaches the console's
          most important encoding. */}
      {ink && step.glyph ? `${step.glyph} · ${label}` : label}
    </span>
  )
}
