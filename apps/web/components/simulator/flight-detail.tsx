"use client"
/** Flight inspection uses recorded schedule data; live route endpoints remain explicitly inferred. */
import { useMemo, useState, type ReactNode } from "react"
import styles from "./flight-detail.module.css"
import { X, Plane, Share2, Bookmark } from "lucide-react"
import { useWatchlist } from "@/lib/use-watchlist"
import { c, ff, r, sp } from "@/lib/design-tokens"
import { useSimulationStore, type LiveFlight, type ScheduledFlight } from "@/stores/simulation"
import { NIMBUS_AIRPORTS } from "@/components/simulator/airports"
import {
  deriveLive, distanceNm, cardinal, nmToKm, ftToM, ktToKmh, fmtDuration, fmtAgo,
} from "@/lib/flight-derive"

const OPS_BLUE = c.ink

// ── Small primitives ─────────────────────────────────────────────────────

/** A label and its recorded value. */
function Cell({ label, value, mono = true, tone }: { label: string; value: string; mono?: boolean; tone?: string }) {
  return (
    <div className={styles.fact}>
      <span style={{ fontSize: 13, color: c.body, whiteSpace: "nowrap" }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? ff.mono : ff.body,
          fontSize: 13, fontWeight: 600,
          color: tone ?? c.ink,
          fontVariantNumeric: "tabular-nums",
          minWidth: 0, overflowWrap: "anywhere", textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  )
}

/** One end of the route — big IATA/ICAO code over city and role. */
function Endpoint({ code, city, role }: { code: string; city: string; role: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: "12px 0", textAlign: "left" }}>
      <div
        style={{
          fontFamily: ff.display, fontSize: 27, fontWeight: 700,
          letterSpacing: "-0.02em", lineHeight: 1, color: c.ink,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {code}
      </div>
      <div style={{ fontSize: 12, color: c.body, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {city}
      </div>
      <div style={{ fontFamily: ff.body, fontSize: 12, color: c.body, marginTop: 4 }}>
        {role}
      </div>
    </div>
  )
}

/**
 * Progress arc with the aircraft on it.
 *
 * The reference draws a smooth arc with a marker at the current position and
 * distances flown / remaining beneath. Where the fraction is UNKNOWN — a live
 * ADS-B contact whose origin we are inferring from "nearest airport behind" —
 * the arc renders in the indeterminate state rather than picking a plausible
 * position, because a progress bar is read as a fact.
 */
function ProgressArc({ frac, tone }: { frac: number | null; tone: string }) {
  // Quadratic curve from (8,44) to (232,44) with apex near y=8.
  const A = { x: 8, y: 44 }, C = { x: 120, y: 2 }, B = { x: 232, y: 44 }
  const at = (t: number) => ({
    x: (1 - t) ** 2 * A.x + 2 * (1 - t) * t * C.x + t ** 2 * B.x,
    y: (1 - t) ** 2 * A.y + 2 * (1 - t) * t * C.y + t ** 2 * B.y,
  })
  const d = `M${A.x} ${A.y} Q${C.x} ${C.y} ${B.x} ${B.y}`
  const p = frac == null ? null : at(Math.max(0, Math.min(1, frac)))
  return (
    <svg viewBox="0 0 240 52" width="100%" height={52} aria-hidden style={{ display: "block" }}>
      {/* full track */}
      <path d={d} fill="none" stroke="var(--ae-line-strong)" strokeWidth={1.5} strokeLinecap="round" />
      {/* flown portion — only drawn when the fraction is known */}
      {p != null && (
        <path
          d={d}
          fill="none"
          stroke={tone}
          strokeWidth={2.5}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - Math.max(0, Math.min(1, frac!))}
        />
      )}
      {p != null && (
        <>
          <circle cx={p.x} cy={p.y} r={8} fill={tone} opacity={0.22} />
          <circle cx={p.x} cy={p.y} r={4.5} fill={tone} stroke="var(--ae-surface)" strokeWidth={1.4} />
        </>
      )}
    </svg>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────

export function FlightDetailPanel({
  live, scheduled, onClose, headerAction, preview,
}: {
  live?: LiveFlight | null
  scheduled?: ScheduledFlight | null
  onClose: () => void
  headerAction?: ReactNode
  preview?: ReactNode
}) {
  const { flightStates, fleet } = useSimulationStore()
  const [previewOpen, setPreviewOpen] = useState(false)

  const body = live
    ? <LiveBody flight={live} />
    : scheduled
      ? <ScheduledBody flight={scheduled} state={flightStates[scheduled.id]} fleet={fleet} />
      : null

  if (!body) return null

  const title = live
    ? [live.callsign?.trim() || live.icao24.toUpperCase(), live.flight_iata, live.flight_icao]
        .filter(Boolean).join(", ")
    : scheduled!.flight_number || scheduled!.id

  return (
    <section aria-label="Flight detail" className={styles.panel}>
      <header className={styles.header}>
        <h2>{title}</h2>
        {headerAction}
        <button type="button" onClick={onClose} aria-label="Close flight detail" className="ae-detail-btn"><X size={18} aria-hidden="true"/></button>
      </header>
      <div className={styles.body}>
        {body}
        {preview&&<details className={styles.aircraft} onToggle={event=>setPreviewOpen(event.currentTarget.open)}><summary>Aircraft preview</summary>{previewOpen&&preview}</details>}
      </div>

      <style jsx global>{`
        .ae-detail-btn:hover { background: var(--ae-surface-2); color: var(--ae-text); }
        .ae-detail-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ae-focus); }
      `}</style>
    </section>
  )
}

/** Track the selected flight or open its provider link when available. */
function ActionStrip({
  flightId, trackingHref,
}: {
  flightId: string
  trackingHref?: string
}) {
  const { has, toggle } = useWatchlist()
  const watched = has(flightId)

  const btn: React.CSSProperties = {
    flex: 1, minWidth: 0, minHeight: 36, borderRadius: r.sm,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    border: `1px solid ${c.hairline}`, background: "var(--ae-surface-2)",
    color: c.body, cursor: "pointer",
    fontFamily: ff.body, fontSize: 12, fontWeight: 550,
    whiteSpace: "nowrap", textDecoration: "none",
  }
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button
        type="button"
        className="ae-detail-btn"
        onClick={() => toggle(flightId)}
        aria-pressed={watched}
        title={watched ? "Remove from watchlist" : "Add to watchlist"}
        style={{
          ...btn,
          // Visual weight follows consequence (design.md): tracked is a state
          // the operator put this flight into, so it owns the filled treatment.
          background: watched ? "var(--ae-teal-bg)" : "var(--ae-surface-2)",
          borderColor: watched ? "var(--ae-teal)" : c.hairline,
          color: watched ? "var(--ae-teal-ink)" : c.body,
        }}
      >
        <Bookmark
          style={{ width: 14, height: 14, flexShrink: 0 }}
          strokeWidth={1.9}
          fill={watched ? "currentColor" : "none"}
        />
        {watched ? "Tracked" : "Track"}
      </button>

      {trackingHref && (
        <a
          href={trackingHref} target="_blank" rel="noopener noreferrer"
          className="ae-detail-btn" style={btn}
          title="Open on an external tracker" aria-label="Open on an external tracker"
        >
          <Share2 style={{ width: 14, height: 14, flexShrink: 0 }} strokeWidth={1.9} />
          Track ext.
        </a>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: c.ink }}>{children}</span>
    </div>
  )
}

// ── Live ADS-B contact ───────────────────────────────────────────────────

function LiveBody({ flight }: { flight: LiveFlight }) {
  const d = useMemo(() => deriveLive(flight), [flight])

  const from = d.nearest ? NIMBUS_AIRPORTS[d.nearest.icao] : null
  const to = d.ahead ? NIMBUS_AIRPORTS[d.ahead.icao] : null

  // Fraction flown is UNKNOWABLE from ADS-B — we have no filed origin. What we
  // do have is distance behind the nearest airport and distance ahead to the
  // inferred one, which is enough to place the marker HONESTLY when both
  // exist, and nothing at all when they do not.
  const behindNm = d.nearest?.nm ?? null
  const aheadNm = d.ahead?.nm ?? null
  const frac =
    behindNm != null && aheadNm != null && behindNm + aheadNm > 0
      ? behindNm / (behindNm + aheadNm)
      : null


  return (
    <>
      <div className={styles.status}><strong>{d.phase.label}</strong><span>Updated {fmtAgo(d.ageSec)}</span></div>

      {/* route */}
      <div className={styles.route}>
        <Endpoint code={from?.iata ?? d.nearest?.icao ?? "—"} city={from?.city ?? "Nearest owned field"} role="Nearest field" />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, flexShrink: 0 }}>
          <span
            style={{
              width: 26, height: 26, borderRadius: 999,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "var(--ae-surface-3)", border: `1px solid ${c.hairline}`,
            }}
          >
            <Plane style={{ width: 13, height: 13, color: OPS_BLUE, transform: "rotate(90deg)" }} strokeWidth={2} />
          </span>
        </div>

        <Endpoint code={to?.iata ?? d.ahead?.icao ?? "—"} city={to?.city ?? "No field on track"} role="Inferred arrival" />
      </div>

      {/* Inference is stated, not implied. "Inferred" on the endpoint label is
          not enough on its own — a dispatcher scanning the card sees an airport
          code in a route position and reads it as the destination. */}
      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.45, color: c.muted }}>
        ADS-B carries no flight plan. The arrival above is the nearest Nimbus field
        within 55° of the current track — a guess from geometry, not a filed route.
      </p>

      <SectionLabel>Track</SectionLabel>
      <div style={{ padding: `${sp.xs}px ${sp.sm}px ${sp.xs}px`, borderRadius: r.md, background: "var(--ae-surface-2)", border: `1px solid ${c.hairline}` }}>
        <ProgressArc frac={frac} tone={OPS_BLUE} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
          <span style={{ fontFamily: ff.mono, fontSize: 11, color: c.body }}>
            {behindNm != null ? `${Math.round(nmToKm(behindNm)).toLocaleString()} km` : "—"}
            <span style={{ color: c.muted }}> from {d.nearest?.icao ?? "—"}</span>
          </span>
          <span style={{ fontFamily: ff.mono, fontSize: 11, color: c.body }}>
            {aheadNm != null ? `${Math.round(nmToKm(aheadNm)).toLocaleString()} km` : "—"}
            <span style={{ color: c.muted }}> in {d.ahead ? fmtDuration(d.ahead.etaMin) : "—"}</span>
          </span>
        </div>
      </div>

      <SectionLabel>Flight information</SectionLabel>
      <div className={styles.facts}>
        <Cell label="Speed" value={d.gs ? `${Math.round(ktToKmh(d.gs))} km/h` : "—"} />
        <Cell label="Altitude" value={d.alt ? `${Math.round(ftToM(d.alt)).toLocaleString()} m` : flight.on_ground ? "Ground" : "—"} />
        <Cell label="Ground speed" value={d.gs ? `${Math.round(d.gs)} kt` : "—"} />
        <Cell label="Flight level" value={d.alt ? `FL${String(Math.round(d.alt / 100)).padStart(3, "0")}` : "—"} />
        <Cell label="Track" value={`${Math.round(d.hdg)}° ${cardinal(d.hdg)}`} />
        <Cell label="Vertical" value={d.vs ? `${d.vs > 0 ? "+" : ""}${Math.round(d.vs)} fpm` : "Level"} />
        <Cell label="Mach" value={d.mach ? d.mach.toFixed(2) : "—"} />
        <Cell label="Squawk" value={flight.squawk || "—"} />
        <Cell label="Operator" value={flight.airline_name || "Unknown"} mono={false} />
        <Cell label="Registered" value={flight.origin_country || "—"} mono={false} />
        <Cell label="ICAO 24" value={flight.icao24.toUpperCase()} />
        <Cell label="Category" value="Live ADS-B" mono={false} tone={OPS_BLUE} />
      </div>

      <ActionStrip
        flightId={flight.icao24}
        trackingHref={flight.tracking?.flightradar24 || flight.tracking?.adsbexchange}
      />
    </>
  )
}

// ── Scheduled Nimbus leg ─────────────────────────────────────────────────

function ScheduledBody({
  flight, state, fleet,
}: {
  flight: ScheduledFlight
  state: ReturnType<typeof useSimulationStore.getState>["flightStates"][string] | undefined
  fleet: ReturnType<typeof useSimulationStore.getState>["fleet"]
}) {
  const o = NIMBUS_AIRPORTS[flight.origin]
  const dst = NIMBUS_AIRPORTS[flight.destination]
  const craft = useMemo(
    () => fleet.find((a) => a.id === flight.aircraft_id || a.id === flight.tail_number),
    [fleet, flight.aircraft_id, flight.tail_number],
  )

  const legNm = o && dst ? distanceNm(o.lat, o.lon, dst.lat, dst.lon) : null
  const delay = state?.delay_minutes ?? 0
  const cancelled = state?.status === "cancelled"

  const fmtT = (iso: string | undefined) => {
    if (!iso) return "—"
    try {
      return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + "Z"
    } catch { return "—" }
  }
  const shifted = (iso: string | undefined, mins: number) => {
    if (!iso) return "—"
    try {
      return new Date(new Date(iso).getTime() + mins * 60000)
        .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + "Z"
    } catch { return "—" }
  }

  const tone = cancelled ? c.muted : delay > 0 ? "var(--ae-amber-ink)" : OPS_BLUE

  return (
    <>
      <div className={styles.status}><strong style={{color:tone}}>{cancelled ? "Cancelled" : delay > 0 ? `Delayed ${delay} min` : "Scheduled"}</strong><span>Simulated flight</span></div>

      <div className={styles.route}>
        <Endpoint code={o?.iata ?? flight.origin} city={o?.city ?? flight.origin} role="Departure" />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, flexShrink: 0 }}>
          <span
            style={{
              width: 26, height: 26, borderRadius: 999,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "var(--ae-surface-3)", border: `1px solid ${c.hairline}`,
            }}
          >
            <Plane style={{ width: 13, height: 13, color: tone, transform: "rotate(90deg)" }} strokeWidth={2} />
          </span>
        </div>

        <Endpoint code={dst?.iata ?? flight.destination} city={dst?.city ?? flight.destination} role="Arrival" />
      </div>

      <table className={styles.schedule} aria-label="Departure and arrival times">
        <thead><tr><th scope="col">All times UTC</th><th scope="col">Departure</th><th scope="col">Arrival</th></tr></thead>
        <tbody>
          <tr><th scope="row">Scheduled</th><td>{fmtT(flight.scheduled_departure)}</td><td>{fmtT(flight.scheduled_arrival)}</td></tr>
          <tr><th scope="row">{delay > 0 ? "Revised" : "Estimated"}</th><td style={{color:tone}}>{cancelled ? "—" : shifted(flight.scheduled_departure,delay)}</td><td style={{color:tone}}>{cancelled ? "—" : shifted(flight.scheduled_arrival,delay)}</td></tr>
        </tbody>
      </table>

      <SectionLabel>Flight information</SectionLabel>
      <div className={styles.facts}>
        <Cell label="Aircraft" value={craft?.type ?? "Unassigned"} mono={false} />
        <Cell label="Tail" value={flight.tail_number ?? flight.aircraft_id ?? "—"} />
        <Cell label="Leg" value={legNm ? `${Math.round(nmToKm(legNm)).toLocaleString()} km` : "—"} />
        <Cell label="Seats" value={craft?.seats ? String(craft.seats) : "—"} />
        <Cell label="Passengers" value={flight.passengers != null ? String(flight.passengers) : "—"} />
        <Cell label="Range" value={craft?.range_nm ? `${Math.round(nmToKm(craft.range_nm)).toLocaleString()} km` : "—"} />
        <Cell
          label="Cascade"
          value={state == null || state.cascade_order < 0 ? "Unaffected" : state.cascade_order === 0 ? "Direct hit" : `Order ${state.cascade_order}`}
          mono={false}
          tone={state && state.cascade_order >= 0 ? "var(--ae-amber-ink)" : undefined}
        />
        <Cell label="Category" value="Simulated leg" mono={false} tone={c.muted} />
      </div>

      {state?.reason && (
        <p style={{ margin: 0, padding: "9px 11px", borderRadius: r.sm, background: "var(--ae-amber-bg)", border: "1px solid var(--ae-amber)", fontSize: 11.5, lineHeight: 1.45, color: c.ink }}>
          {state.reason}
        </p>
      )}

      {/* The watchlist stores SCHEDULED flight ids, which is what
          my-flights.tsx resolves against the schedule — so a live ADS-B
          contact and a Nimbus leg both pass their own id and the list stays
          one list. */}
      <ActionStrip flightId={flight.id} />
    </>
  )
}
