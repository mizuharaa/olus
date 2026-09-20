"use client"
/**
 * PLAN COMPARE — the decision surface.
 *
 * Direction contract: the HTML comment at the top of `app/layout.tsx`
 * (seed 688f3053). Primitives: `components/simulator/board.tsx`.
 *
 * ── Why this is a grid and not four cards ─────────────────────────────────
 *
 * The surface this replaces drew each plan as its own rounded card holding
 * four nested sub-cards, each sub-card holding one figure. Two failures, and
 * the first is functional rather than a matter of taste:
 *
 *   1. COMPARISON WAS IMPOSSIBLE. The operator's actual question is "which of
 *      these four costs least / strands fewest passengers", and answering it
 *      means reading one metric ACROSS four plans. In a card grid that metric
 *      appears at four different vertical positions, so the eye has to hunt
 *      and hold values in memory. Here the metric is a ROW: $389.9K sits
 *      directly above $389.9K and the comparison is free.
 *   2. Nested cards are the lazy container — a box inside a box inside a box,
 *      each with its own border, none of which encodes anything. The craft
 *      floor bans them outright and this file is the reason why.
 *
 * So: ONE continuous ruled grid. Plans are columns, metrics are rows, and the
 * only things drawn are hairlines. No card owns a plan.
 *
 * ── Ranked vs reported ────────────────────────────────────────────────────
 *
 * Only COST and FAR 117 carry a "best" mark. Pax·min, tCO₂e and Cancels are
 * REPORTED, never ranked, because cancelling a flight drives all three of them
 * down at once — a naive `min()` crowns the most destructive plan. That is not
 * a style choice; it is the reason a previous revision named Plan D "best on
 * Pax·min" precisely because D cancelled all 39 flights.
 *
 * ── The degenerate case ───────────────────────────────────────────────────
 *
 * Four objectives can converge on one plan. When every figure matches, this
 * says so once, in a line, and drops the per-row emphasis — rather than
 * rendering four identical columns and letting them read as a broken query.
 */

import { useEffect, useMemo, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Check, X } from "lucide-react"
import { useSimulationStore, type RecoveryPlan } from "@/stores/simulation"
import { planMeta } from "@/lib/plan-meta"
import { c, ff, r, sp } from "@/lib/design-tokens"
import { RULE, Module, Figure, Mark, Chip, Fringe } from "@/components/simulator/board"

/* ── Formatting ────────────────────────────────────────────────────────── */

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${Math.round(n)}`

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)))

/* ── The metric rows ───────────────────────────────────────────────────────
   `rank` is the whole editorial position of this surface, so it lives in the
   row definition rather than in the render: "lower" marks a best value,
   `null` means the metric is reported and never marked. */
type Row = {
  key: string
  label: string
  unit?: string
  value: (p: RecoveryPlan) => number
  render: (p: RecoveryPlan) => string
  rank: "lower" | null
  /** Why this metric is not ranked. Surfaced as the row's tooltip. */
  note?: string
}

const ROWS: Row[] = [
  {
    key: "cost",
    label: "Cost",
    value: (p) => p.cost_breakdown?.grand_total_usd ?? p.total_cost_usd,
    render: (p) => usd(p.cost_breakdown?.grand_total_usd ?? p.total_cost_usd),
    rank: "lower",
  },
  {
    key: "pax",
    label: "Passenger-minutes",
    value: (p) => p.total_passenger_delay_minutes,
    render: (p) => compact(p.total_passenger_delay_minutes),
    rank: null,
    note: "Reported, not ranked — cancelling a flight drives passenger-delay minutes down.",
  },
  {
    key: "co2",
    label: "tCO₂e",
    value: (p) => (p.total_co2_kg ?? 0) / 1000,
    render: (p) => {
      const t = (p.total_co2_kg ?? 0) / 1000
      return `${t >= 0 ? "+" : ""}${t.toFixed(1)}`
    },
    rank: null,
    note: "Reported, not ranked — a cancelled flight burns no fuel.",
  },
  {
    key: "far117",
    label: "Crew violations",
    value: (p) => p.crew_violations,
    render: (p) => String(p.crew_violations),
    rank: "lower",
  },
  {
    key: "cancels",
    label: "Cancellations",
    value: (p) => p.cancelled_flights.length,
    render: (p) => String(p.cancelled_flights.length),
    rank: null,
    note: "Reported, not ranked — fewer cancellations is not automatically the better recovery.",
  },
  {
    key: "delays",
    label: "Delayed flights",
    value: (p) => p.delayed_flights.length,
    render: (p) => String(p.delayed_flights.length),
    rank: null,
  },
]

/* ── Column head ───────────────────────────────────────────────────────── */

function PlanHead({
  plan, inspected, applied, onInspect,
}: {
  plan: RecoveryPlan
  inspected: boolean
  applied: boolean
  onInspect: () => void
}) {
  const meta = planMeta(plan.plan_id)
  return (
    <button
      type="button"
      onClick={onInspect}
      aria-pressed={inspected}
      className="ae-plan-col"
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: `${sp.xs}px ${sp.sm}px`,
        border: "none",
        borderRight: RULE,
        // The inspected column is the white module face rising out of the
        // well; every other column stays in the well. No card, no shadow.
        background: inspected ? c.canvas : "transparent",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      {inspected && <Fringe tone="violet" side="top" />}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
        <span
          style={{
            fontFamily: ff.mono, fontSize: 15, fontWeight: 700,
            color: inspected ? c.ink : c.body, lineHeight: 1,
          }}
        >
          {plan.plan_id}
        </span>
        <span
          style={{
            fontFamily: ff.body, fontSize: 12.5,
            fontWeight: inspected ? 650 : 500,
            color: inspected ? c.ink : c.body,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          {plan.objective_label}
        </span>
        {applied && <span style={{ marginLeft: "auto" }}><Mark kind="applied" /></span>}
      </div>
      <div
        style={{
          marginTop: 2, fontFamily: ff.body, fontSize: 11, color: c.muted,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {meta.sublabel}
      </div>
    </button>
  )
}

/* ── What a plan does, leg by leg ──────────────────────────────────────────
   A ruled ledger, not a chip cloud. The surface this replaces rendered 26
   cancellations as undifferentiated pills in one grid with no sort and no
   filter, which is a pile rather than a list: nothing about it told the
   operator which cancellation mattered. Rows carry the delay, so the list
   sorts itself by consequence. */
function LegLedger({ plan }: { plan: RecoveryPlan }) {
  const legs = useMemo(() => {
    const cancelled = plan.cancelled_flights.map((id) => ({ id, delay: Infinity, cancelled: true }))
    const delayed = [...plan.delayed_flights]
      .sort((a, b) => b.delay_minutes - a.delay_minutes)
      .map((d) => ({ id: d.flight_id, delay: d.delay_minutes, cancelled: false }))
    return [...cancelled, ...delayed]
  }, [plan])

  if (legs.length === 0) {
    return (
      <p style={{ margin: 0, padding: `${sp.sm}px`, fontFamily: ff.body, fontSize: 12.5, color: c.muted }}>
        This plan changes no legs — the network absorbs the disruption as scheduled.
      </p>
    )
  }

  return (
    <div style={{ borderTop: RULE }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: sp.xs,
          height: 26, padding: `0 ${sp.sm}px`, borderBottom: RULE, background: c.surfaceSoft,
        }}
      >
        <span
          style={{
            fontFamily: ff.mono, fontSize: 10.5, fontWeight: 600,
            letterSpacing: "0.12em", textTransform: "uppercase", color: c.muted,
          }}
        >
          Legs changed by plan {plan.plan_id}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <Figure value={legs.length} label="legs" size={12} tone="muted" />
        </span>
      </div>

      <div
        style={{
          display: "grid",
          // Auto-fills to the width available, so the same ledger works at
          // 900px and at 1900px without a breakpoint.
          gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
        }}
      >
        {legs.map((leg) => (
          <div
            key={leg.id}
            style={{
              display: "flex", alignItems: "center", gap: sp.xs,
              minHeight: 44, padding: `0 ${sp.sm}px`,
              borderRight: RULE, borderBottom: RULE,
            }}
          >
            <span style={{ fontFamily: ff.mono, fontSize: 14, fontWeight: 600, color: c.ink }}>
              {leg.id}
            </span>
            <span style={{ marginLeft: "auto" }}>
              {leg.cancelled
                ? <Mark kind="unavailable" label="Cancelled" />
                : <Figure value={`+${leg.delay}`} unit="min" size={12} tone="muted" />}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── The board ─────────────────────────────────────────────────────────── */

export function PlanCompareBoard({
  inspectedId,
  onInspect,
  onCommit,
  onClose,
  busy=false,
}: {
  inspectedId: string
  onInspect: (id: string) => void
  onCommit: (id: string | null) => void
  onClose: () => void
  busy?: boolean
}) {
  const { recoveryPlans, appliedPlanId, cascadeSummary } = useSimulationStore()
  const [armed, setArmed] = useState(false)
  useEffect(() => setArmed(false), [inspectedId])

  const plans = recoveryPlans
  const inspected = plans.find((p) => p.plan_id === inspectedId) ?? plans[0]

  /**
   * THE ONE AUTHORED MOMENT.
   *
   * This region takes the map, which is the biggest thing that happens on
   * this console short of committing — so it is the one place motion is
   * spent, and it is spent once, orchestrated, rather than scattered across
   * hover states. The board WIPES down from the tab that summoned it
   * (`clip-path` on the container) while the metric rows ladder in behind it
   * on a short stagger, so the eye follows the reveal down the grid it is
   * about to read rather than being handed a finished table.
   *
   * clip-path rather than height: animating height reflows Leaflet
   * underneath on every frame. clip-path is composited and touches nothing.
   *
   * Reduced motion collapses the whole thing to a 120ms fade — design.md's
   * app-chrome ceiling — and the stagger goes to zero.
   */
  const reduce = useReducedMotion()
  const wipe = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.12 } }
    : {
        initial: { clipPath: "inset(0 0 100% 0)", opacity: 0.6 },
        animate: { clipPath: "inset(0 0 0% 0)", opacity: 1 },
        transition: { duration: 0.34, ease: [0.22, 0.9, 0.28, 1] as const },
      }
  const rowIn = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: -4 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.22, delay: 0.10 + i * 0.035, ease: [0.22, 0.9, 0.28, 1] as const },
        }

  /**
   * Do all four objectives return the same plan?
   *
   * Compared on the RANKED metrics plus the two headline reported ones. When
   * this is true the grid stops marking a winner and says so in one line,
   * because four identical columns with one of them underlined is a screen
   * that looks like it is lying.
   */
  const converged = useMemo(() => {
    if (plans.length < 2) return false
    return ROWS.every((row) => {
      const first = row.value(plans[0])
      return plans.every((p) => Math.abs(row.value(p) - first) < 0.005)
    })
  }, [plans])

  /** Best value per ranked row — only when the plans actually differ. */
  const bestByRow = useMemo(() => {
    const m: Record<string, number | null> = {}
    for (const row of ROWS) {
      if (row.rank !== "lower" || converged) { m[row.key] = null; continue }
      const values = plans.map(row.value)
      const min = Math.min(...values)
      // A "best" that every column ties on is not a best.
      m[row.key] = values.filter((v) => v === min).length === values.length ? null : min
    }
    return m
  }, [plans, converged])

  if (!inspected) return null

  const isApplied = appliedPlanId === inspected.plan_id
  const cols = `160px repeat(${plans.length}, minmax(0, 1fr))`

  return (
    <motion.div style={{ height: "100%" }} {...wipe}>
    <Module
      flush={["top", "left", "right"]}
      title="Recovery — compare"
      aria-label="Recovery plan comparison"
      action={
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the comparison and return to the map"
          title="Back to the map"
          className="ae-bar-btn"
          style={{
            width: 24, height: 24, borderRadius: r.xs, border: RULE,
            background: "transparent", color: c.muted, cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <X style={{ width: 12, height: 12 }} strokeWidth={2} />
        </button>
      }
      style={{ height: "100%" }}
      bodyStyle={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      {/* ── Scope line. The numbers the whole decision is about. ── */}
      <div
        style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: sp.sm,
          padding: `${sp.xxs}px ${sp.sm}px`, borderBottom: RULE,
          background: c.surfaceSoft, flexWrap: "wrap",
        }}
      >
        <Figure value={cascadeSummary?.total_affected ?? 0} label="affected" size={13} />
        <span style={{ color: c.muted, fontSize: 11 }}>·</span>
        <Figure value={cascadeSummary?.directly_affected ?? 0} label="direct" size={13} tone="muted" />
        <span style={{ color: c.muted, fontSize: 11 }}>·</span>
        <Figure
          value={(cascadeSummary?.cascade_1 ?? 0) + (cascadeSummary?.cascade_2 ?? 0)}
          label="cascade"
          size={13}
          tone="muted"
        />
        {converged && (
          <span
            style={{
              marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
              fontFamily: ff.body, fontSize: 12, color: c.amberInk,
            }}
          >
            <Chip tone="amber">CONVERGED</Chip>
            All four objectives return the same plan — there is no trade-off to make here.
          </span>
        )}
      </div>

      {/* ── The grid. Columns are plans, rows are metrics. ── */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div role="table" aria-label="Recovery plans compared across metrics" style={{ minWidth: 620 }}>
          {/* Head */}
          <div role="row" style={{ display: "grid", gridTemplateColumns: cols, borderBottom: RULE, background: c.surfaceSoft }}>
            <div role="columnheader" style={{ borderRight: RULE }} />
            {plans.map((p) => (
              <div role="columnheader" key={p.plan_id}>
                <PlanHead
                  plan={p}
                  inspected={p.plan_id === inspected.plan_id}
                  applied={appliedPlanId === p.plan_id}
                  onInspect={() => { setArmed(false); onInspect(p.plan_id) }}
                />
              </div>
            ))}
          </div>

          {/* Metric rows */}
          {ROWS.map((row, i) => {
            const best = bestByRow[row.key]
            // Cost is the anchor of the whole grid — it is the metric the
            // decision is usually made on, and it gets the weight to say so.
            const anchor = row.key === "cost"
            return (
              <motion.div
                role="row"
                key={row.key}
                className="ae-plan-row"
                {...rowIn(i)}
                style={{
                  display: "grid",
                  gridTemplateColumns: cols,
                  borderBottom: anchor ? `1px solid ${c.borderStrong}` : RULE,
                }}
              >
                <div
                  role="rowheader"
                  title={row.note}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: `0 ${sp.sm}px`, height: anchor ? 40 : 32, borderRight: RULE,
                    // The label gutter is a WELL, so the figures beside it read
                    // as sitting on the module face. Without it the grid is one
                    // undifferentiated white field and the row labels float.
                    background: c.surfaceSoft,
                    fontFamily: ff.mono, fontSize: 10.5,
                    fontWeight: anchor ? 700 : 600,
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    color: anchor ? c.ink : c.muted,
                  }}
                >
                  {row.label}
                  {row.rank === null && (
                    <abbr
                      title={row.note ?? "Reported, not ranked."}
                      style={{ textDecoration: "none", color: c.borderStrong, fontSize: 11, cursor: "help" }}
                    >
                      *
                    </abbr>
                  )}
                </div>

                {plans.map((p) => {
                  const isBest = best != null && row.value(p) === best
                  const on = p.plan_id === inspected.plan_id
                  return (
                    <div
                      role="cell"
                      key={p.plan_id}
                      style={{
                        display: "flex", alignItems: "center",
                        height: anchor ? 40 : 32, padding: `0 ${sp.sm}px`, borderRight: RULE,
                        background: on ? c.canvas : c.raised,
                      }}
                    >
                      <span
                        style={{
                          // Best-in-row is an UNDERLINE, not a fill or a hue —
                          // it survives monochrome and never competes with the
                          // applied plan's mark for "already decided".
                          borderBottom: isBest ? `2px solid ${c.fringeMint}` : "2px solid transparent",
                          paddingBottom: 1,
                        }}
                      >
                        <Figure
                          value={row.render(p)}
                          size={anchor ? 17 : 13}
                          tone={on ? "ink" : "muted"}
                        />
                      </span>
                    </div>
                  )
                })}
              </motion.div>
            )
          })}
        </div>

        {/* ── Footnote. States the editorial rule in the operator's words
               rather than leaving the asterisks unexplained. ── */}
        <p
          style={{
            margin: 0, padding: `${sp.xs}px ${sp.sm}px`,
            fontFamily: ff.body, fontSize: 11.5, lineHeight: 1.5, color: c.muted, maxWidth: 760,
          }}
        >
          Underline: lowest cost or fewest crew violations. Other metrics are reported without ranking;
          cancellations can reduce passenger-delay and emissions totals.
        </p>

        {/* ── What the inspected plan actually DOES ────────────────────────
               The grid answers "which plan"; this answers "to what". Without
               it the region below the footnote is void, and the operator has
               to commit a plan whose effects they have only seen summed into
               a count. Legs are ordered by delay, worst first — the ones that
               decide whether the plan is acceptable are the ones at the top,
               and a flight-number sort would bury them. */}
        <LegLedger plan={inspected} />
      </div>

      {/* ── Commit. The only filled control on this surface, because it is the
             only irreversible one. It arms first and states the consequence
             in the operator's own units. ── */}
      <div
        style={{
          flexShrink: 0, borderTop: RULE, background: c.surfaceSoft,
          padding: `${sp.xs}px ${sp.sm}px`,
          display: "flex", alignItems: "center", gap: sp.sm, flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: ff.body, fontSize: 12.5, fontWeight: 650, color: c.ink }}>
            Plan {inspected.plan_id} · {inspected.objective_label}
          </div>
          <div style={{ fontFamily: ff.body, fontSize: 11.5, color: c.muted }}>
            {armed && !isApplied ? (
              <span role="alert" style={{ color: c.roseInk }}>
                Commits {inspected.delayed_flights.length} delays,{" "}
                {inspected.cancelled_flights.length} cancellations and{" "}
                {inspected.crew_violations} FAR 117 flag{inspected.crew_violations === 1 ? "" : "s"} to the simulated
                schedule. Click again to confirm.
              </span>
            ) : (
              planMeta(inspected.plan_id).sublabel
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (isApplied) { onCommit(null); setArmed(false); return }
            if (!armed) { setArmed(true); return }
            setArmed(false)
            onCommit(inspected.plan_id)
          }}
          onKeyDown={(e) => { if (e.key === "Escape" && armed) { e.stopPropagation(); setArmed(false) } }}
          disabled={busy||inspected.status==="infeasible"}
          aria-busy={busy}
          className="ae-commit"
          aria-label={
            isApplied
              ? `Unapply plan ${inspected.plan_id}`
              : armed
                ? `Confirm — commit plan ${inspected.plan_id} to the simulated schedule`
                : `Commit plan ${inspected.plan_id} — asks for confirmation first`
          }
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            minHeight: 34, padding: `0 ${sp.sm}px`, borderRadius: r.xs,
            border: `1px solid ${isApplied ? c.borderStrong : armed ? c.rose : c.primary}`,
            background: isApplied ? "transparent" : armed ? c.rose : c.primary,
            // c.onPrimary, not a literal white. On the light board primary is
            // near-black ink and the label is white; on the dark register
            // primary is a LIGHT plum and a white label measures 3.23:1. This
            // is the exact trap `--ae-on-primary` exists for, and hardcoding
            // it here would have reintroduced it in a brand-new file.
            color: isApplied ? c.body : c.onPrimary,
            fontFamily: ff.body, fontSize: 13, fontWeight: 650,
            cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          {isApplied ? (
            <><X style={{ width: 14, height: 14 }} strokeWidth={2} /> Unapply</>
          ) : armed ? (
            <><Check style={{ width: 14, height: 14 }} strokeWidth={2} /> Confirm commit</>
          ) : (
            <>Commit plan {inspected.plan_id}</>
          )}
        </button>
      </div>
    </Module>
    </motion.div>
  )
}
