"use client"
/**
 * RECOVERY DETAIL — the column half of the recovery decision.
 *
 * The split: the wide compare region answers *which plan*, this answers
 * *what this plan costs and why*. The panel it replaces did both, so the
 * 4×6 matrix rendered twice on one screen at two different sizes — and the
 * 360px copy was the unreadable one.
 *
 * Everything here is ruled rows on the module face. No cards, and
 * specifically no card-inside-a-card: a cost breakdown is a LIST of figures
 * that must line up down their right edge, and wrapping each line in its own
 * bordered box is the arrangement that makes lining them up impossible.
 *
 * Demoted on purpose: SOLVE TIME. It was a first-class impact tile sitting
 * beside "FAR 117 flags" at the same weight, which put a performance
 * statistic about the solver on the same footing as a crew-legality breach.
 * It is a footnote here, because that is what it is.
 */

import { ArrowLeftRight } from "lucide-react"
import { useSimulationStore, type RecoveryPlan } from "@/stores/simulation"
import { planMeta } from "@/lib/plan-meta"
import { c, ff, r, sp } from "@/lib/design-tokens"
import { RULE, Figure, Mark, Chip } from "@/components/simulator/board"

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${Math.round(n)}`

/** One ruled figure row. The label truncates; the figure never does. */
function LedgerRow({
  label, value, unit, tone = "ink", strong = false, help,
}: {
  label: string
  value: React.ReactNode
  unit?: string
  tone?: "ink" | "muted" | "rose" | "amber" | "teal"
  strong?: boolean
  help?: string
}) {
  return (
    <div
      className="ae-ledger-row"
      title={help}
      style={{
        display: "flex", alignItems: "center", gap: sp.xs,
        minHeight: 30, padding: `0 ${sp.sm}px`, borderBottom: RULE,
        background: strong ? c.surfaceSoft : undefined,
      }}
    >
      <span
        style={{
          flex: 1, minWidth: 0,
          fontFamily: ff.body, fontSize: 12, fontWeight: strong ? 650 : 500,
          color: strong ? c.ink : c.body,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <Figure value={value} unit={unit} tone={tone} size={strong ? 14 : 12.5} />
    </div>
  )
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", height: 26,
        padding: `0 ${sp.sm}px`, borderBottom: RULE, background: c.surfaceSoft,
        fontFamily: ff.mono, fontSize: 10.5, fontWeight: 600,
        letterSpacing: "0.12em", textTransform: "uppercase", color: c.muted,
      }}
    >
      {children}
    </div>
  )
}

export function RecoveryDetail({
  inspectedId,
  onOpenCompare,
}: {
  inspectedId: string
  onOpenCompare: () => void
}) {
  const { recoveryPlans, appliedPlanId, cascadeSummary } = useSimulationStore()
  const plan: RecoveryPlan | undefined =
    recoveryPlans.find((p) => p.plan_id === inspectedId) ?? recoveryPlans[0]

  /* ── Empty state. States the truth and names a control that EXISTS —
        the Events tab, not "the left rail", which is route navigation and
        has never had a trigger on it. ── */
  if (!plan) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <SectionHead>No plans yet</SectionHead>
        <div style={{ padding: sp.sm, display: "flex", flexDirection: "column", gap: sp.xs }}>
          <p style={{ margin: 0, fontFamily: ff.body, fontSize: 13, color: c.ink, fontWeight: 600 }}>
            All flights operating nominally.
          </p>
          <p style={{ margin: 0, fontFamily: ff.body, fontSize: 12, lineHeight: 1.5, color: c.muted }}>
            Trigger a disruption from the <strong style={{ color: c.body }}>Events</strong> tab. Four
            recovery plans are solved against it — cost, passenger impact, tomorrow&apos;s schedule and
            carbon — and appear here with their full breakdown.
          </p>
        </div>
      </div>
    )
  }

  const meta = planMeta(plan.plan_id)
  const cb = plan.cost_breakdown
  const applied = appliedPlanId === plan.plan_id
  const co2t = (plan.total_co2_kg ?? 0) / 1000

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      {/* ── Which plan this is ── */}
      <div style={{ padding: `${sp.xs}px ${sp.sm}px`, borderBottom: RULE }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: ff.mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: c.muted }}>
            PLAN {plan.plan_id}
          </span>
          {applied && <span style={{ marginLeft: "auto" }}><Mark kind="applied" /></span>}
          {!applied && plan.status !== "optimal" && (
            <span style={{ marginLeft: "auto" }}><Chip tone="amber">{plan.status.toUpperCase()}</Chip></span>
          )}
        </div>
        <h2
          style={{
            margin: "2px 0 0", fontFamily: ff.display, fontSize: 17, fontWeight: 700,
            letterSpacing: "-0.015em", color: c.ink, lineHeight: 1.15,
          }}
        >
          {plan.objective_label}
        </h2>
        <p style={{ margin: "2px 0 0", fontFamily: ff.body, fontSize: 12, color: c.muted }}>
          {meta.sublabel}
        </p>

        <button
          type="button"
          onClick={onOpenCompare}
          className="ae-bar-btn"
          style={{
            marginTop: sp.xs,
            display: "inline-flex", alignItems: "center", gap: 6,
            height: 28, padding: `0 ${sp.xs}px`, borderRadius: r.xs,
            border: RULE, background: "transparent", color: c.body,
            fontFamily: ff.body, fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}
        >
          <ArrowLeftRight aria-hidden style={{ width: 13, height: 13 }} strokeWidth={2} />
          Compare all {recoveryPlans.length} plans
        </button>
      </div>

      {/* ── Cost ── */}
      <SectionHead>Cost</SectionHead>
      {cb ? (
        <>
          {cb.cancellation_total_usd > 0 && (
            <LedgerRow
              label="Cancellations"
              value={usd(cb.cancellation_total_usd)}
              help="Lost revenue + rebooking + DOT 261 obligations"
            />
          )}
          {cb.delay_total_usd > 0 && (
            <LedgerRow
              label="Delays"
              value={usd(cb.delay_total_usd)}
              help="Ops cost + crew overtime + passenger value-of-time"
            />
          )}
          {cb.reposition_cost_usd > 0 && (
            <LedgerRow label="Repositioning" value={usd(cb.reposition_cost_usd)} />
          )}
          <LedgerRow label="Total exposure" value={usd(cb.grand_total_usd)} strong />
        </>
      ) : (
        <LedgerRow label="Total exposure" value={usd(plan.total_cost_usd)} strong />
      )}

      {/* ── Impact. Reported figures, in the operator's units. ── */}
      <SectionHead>Impact</SectionHead>
      <LedgerRow label="Passenger delay" value={Math.round(plan.total_passenger_delay_minutes).toLocaleString()} unit="pax·min" tone="muted" />
      <LedgerRow label="Legs delayed" value={plan.delayed_flights.length} tone="muted" />
      <LedgerRow label="Legs cancelled" value={plan.cancelled_flights.length} tone="muted" />
      {plan.aircraft_swaps.length > 0 && (
        <LedgerRow label="Aircraft swaps" value={plan.aircraft_swaps.length} tone="muted" />
      )}
      <LedgerRow
        label="FAR 117 flags"
        value={plan.crew_violations}
        tone={plan.crew_violations > 0 ? "rose" : "muted"}
        help="Crew duty-time breaches this plan introduces. Each needs manual scheduling review before dispatch."
      />
      <LedgerRow
        label="Carbon"
        value={`${co2t >= 0 ? "+" : ""}${co2t.toFixed(1)}`}
        unit="tCO₂e"
        tone="muted"
      />
      {plan.eu_ets_cost_usd != null && plan.eu_ets_cost_usd > 0 && (
        <LedgerRow label="EU ETS" value={usd(plan.eu_ets_cost_usd)} tone="muted" />
      )}

      {/* ── Uncertain horizon. Only present when the disruption's duration was
             unknown at trigger time — the drone-incursion case. Regret is the
             number that makes an uncertain plan judgeable, so it is stated,
             not buried. ── */}
      {plan.uncertainty && (
        <>
          <SectionHead>Uncertain horizon</SectionHead>
          <div style={{ padding: `${sp.xs}px ${sp.sm}px`, borderBottom: RULE }}>
            <p style={{ margin: 0, fontFamily: ff.body, fontSize: 11.5, lineHeight: 1.5, color: c.muted }}>
              This disruption has no known end time. The plan was solved across sampled closure lengths
              ({plan.uncertainty.distribution}, median {plan.uncertainty.median_minutes} min, p95{" "}
              {plan.uncertainty.p95_minutes} min).
            </p>
          </div>
          <LedgerRow label="Expected cost" value={usd(plan.uncertainty.expected_cost_usd)} strong />
          <LedgerRow
            label="Cost band"
            value={`${usd(plan.uncertainty.cost_low_usd)} – ${usd(plan.uncertainty.cost_high_usd)}`}
            tone="muted"
          />
          <LedgerRow
            label="Expected regret"
            value={usd(plan.uncertainty.expected_regret_usd)}
            tone="amber"
            help="How much more this plan costs than the best recovery available with hindsight."
          />
          <LedgerRow label="Max regret" value={usd(plan.uncertainty.max_regret_usd)} tone="muted" />
        </>
      )}

      {/* ── Why. The solver's own explanation, when it produced one. ── */}
      {plan.summary && (
        <>
          <SectionHead>Rationale</SectionHead>
          <p
            style={{
              margin: 0, padding: sp.sm, borderBottom: RULE,
              fontFamily: ff.body, fontSize: 12.5, lineHeight: 1.55, color: c.body,
            }}
          >
            {plan.summary}
          </p>
        </>
      )}

      {/* ── Provenance. Deliberately the quietest thing on the panel. ── */}
      <p
        style={{
          margin: 0, padding: `${sp.xs}px ${sp.sm}px ${sp.md}px`,
          fontFamily: ff.mono, fontSize: 10.5, lineHeight: 1.6, color: c.muted,
        }}
      >
        {plan.status} · solved in {plan.solve_time_ms}ms
        {cascadeSummary ? ` · against ${cascadeSummary.total_affected} affected legs` : ""}
      </p>
    </div>
  )
}
