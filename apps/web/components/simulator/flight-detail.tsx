"use client"
/**
 * FlightDetailPanel — the inspector for one flight, live or scheduled.
 *
 * ── 2026-08-16: this lives in the CONTEXT COLUMN, not over the map ────────
 *
 * The previous inspector was a card floating on the map's top-left lane. That
 * put the most detailed surface on the console on top of the surface it
 * describes, so reading a flight's numbers meant covering the airspace around
 * it — and it forced a whole overlay-lane ownership scheme (design.md's
 * "overlay lanes are owned, one each") to stop it colliding with the search
 * box, the disruption banner and the zoom column. Docked in the column, it
 * cannot collide with anything, it can be taller than a map overlay could ever
 * be, and the map keeps every pixel it has.
 *
 * ── Honesty ──────────────────────────────────────────────────────────────
 * ADS-B carries position, altitude, velocity, track and vertical rate. It does
 * NOT carry origin, destination, scheduled times, aircraft age or passenger
 * counts. The reference card shows all of those; this one shows them only for
 * SCHEDULED Nimbus legs, where the simulator genuinely has them, and for live
 * ADS-B contacts it labels the inferred arrival as inferred. Fields with no
 * data say so rather than rendering a plausible number.
 */

import { useMemo } from "react"
import { X, Plane, Share2, Crosshair, Bookmark } from "lucide-react"
import { useWatchlist } from "@/lib/use-watchlist"
import { c, ff, r, sp } from "@/lib/design-tokens"
import { useSimulationStore, type LiveFlight, type ScheduledFlight } from "@/stores/simulation"
import { NIMBUS_AIRPORTS } from "@/components/simulator/airports"
import { AircraftSilhouette, aircraftFamily } from "@/components/simulator/aircraft-silhouette"
import {
  deriveLive, distanceNm, cardinal, nmToKm, ftToM, ktToKmh, fmtDuration, fmtAgo,
} from "@/lib/flight-derive"

const OPS_BLUE = "#4FA3E3"

// ── Small primitives ─────────────────────────────────────────────────────

/** A bordered cell in the two-column information grid. */
function Cell({ label, value, mono = true, tone }: { label: string; value: string; mono?: boolean; tone?: string }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8,
        padding: "9px 11px", borderRadius: r.sm, minWidth: 0,
        background: "var(--ae-surface-2)",
        border: `1px solid ${c.hairline}`,
      }}
    >
      <span style={{ fontSize: 11.5, color: c.muted, whiteSpace: "nowrap" }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? ff.mono : ff.body,
          fontSize: 12.5, fontWeight: 600,
          color: tone ?? c.ink,
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
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
    <div style={{ flex: 1, minWidth: 0, padding: "12px 10px", textAlign: "center" }}>
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
      <div style={{ fontFamily: ff.mono, fontSize: 10, color: c.muted, marginTop: 3, letterSpacing: "0.06em" }}>
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
  live, scheduled, onClose,
}: {
  live?: LiveFlight | null
  scheduled?: ScheduledFlight | null
  onClose: () => void
}) {
  const { flightStates, fleet } = useSimulationStore()

  const body = live
    ? <LiveBody flight={live} />
    : scheduled
      ? <ScheduledBody flight={scheduled} state={flightStates[scheduled.id]} fleet={fleet} />
      : null

  if (!body) return null

  const title = live
    ? [live.callsign?.trim() || live.icao24.toUpperCase(), live.flight_iata, live.flight_icao]
        .filter(Boolean).join(", ")
    : `${scheduled!.flight_number || scheduled!.id}, ${scheduled!.origin}–${scheduled!.destination}`

  return (
    <section aria-label="Flight detail" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* header — accent bar + identifier + close */}
      <header
        style={{
          display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          padding: "11px 10px 11px 0",
          borderBottom: `1px solid ${c.hairline}`,
        }}
      >
        <h2
          style={{
            flex: 1, minWidth: 0, margin: 0,
            fontFamily: ff.mono, fontSize: 12.5, fontWeight: 600,
            color: c.ink, letterSpacing: "0.01em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close flight detail"
          className="ae-detail-btn"
          style={{
            width: 28, height: 28, flexShrink: 0, borderRadius: r.sm,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: `1px solid ${c.hairline}`, background: "transparent",
            color: c.muted, cursor: "pointer",
          }}
        >
          <X style={{ width: 14, height: 14 }} strokeWidth={2} />
        </button>
      </header>

      <div className="ae-scroll-smooth" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: sp.sm, display: "flex", flexDirection: "column", gap: sp.sm }}>
        {body}
      </div>

      <style jsx global>{`
        .ae-detail-btn:hover { background: var(--ae-surface-2); color: var(--ae-text); }
        .ae-detail-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ae-focus); }
      `}</style>
    </section>
  )
}

/**
 * Action strip.
 *
 * ── 2026-08-16: every button here now does something ──────────────────────
 *
 * This shipped as four glyph buttons copied from the reference card's layout,
 * of which TWO were inert: a bookmark that wrote nowhere and a "More" that
 * opened nothing. Both looked identical to the two that worked, which is worse
 * than not having them — a control that renders enabled, takes hover and focus,
 * and then silently does nothing teaches the operator to distrust the strip.
 *
 * "More" is DELETED rather than filled. There was no fifth action it was
 * hiding; it existed because the reference image had four glyphs. An overflow
 * menu with nothing in it is decoration shaped like a control.
 *
 * Bookmark is WIRED. A real watchlist already existed in `my-flights.tsx`,
 * privately, on `localStorage["olus-watched-flights"]` — see
 * `lib/use-watchlist.ts`, which lifts it so both surfaces share one list. The
 * button is a real toggle with a distinct pressed state, so it also reports
 * whether this flight is already tracked, which the strip could not say before.
 *
 * Labels, not bare glyphs. Four unlabelled icons in a row is exactly the
 * "icon-only navigation" a first-time operator cannot decode, and there is room
 * for words in a 364px column.
 */
function ActionStrip({
  flightId, onFocus, trackingHref,
}: {
  flightId: string
  onFocus?: () => void
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
        type="button" className="ae-detail-btn" style={btn} onClick={onFocus}
        title="Centre the map on this flight" aria-label="Centre the map on this flight"
      >
        <Crosshair style={{ width: 14, height: 14, flexShrink: 0 }} strokeWidth={1.9} />
        Centre
      </button>

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
  const setSelectedLiveFlight = useSimulationStore((s) => s.setSelectedLiveFlight)

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

  const family = aircraftFamily(null)

  return (
    <>
      {/* airframe plate */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: 132, borderRadius: r.md, position: "relative", overflow: "hidden",
          background: "var(--ae-surface-2)", border: `1px solid ${c.hairline}`,
        }}
      >
        <AircraftSilhouette family={family} size={124} fill="var(--ae-text-3)" line="var(--ae-surface-2)" />
        <span
          style={{
            position: "absolute", left: 10, top: 9,
            fontFamily: ff.mono, fontSize: 10, fontWeight: 600,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: d.phase.tone,
          }}
        >
          {d.phase.label}
        </span>
        <span
          style={{
            position: "absolute", right: 10, top: 9,
            fontFamily: ff.mono, fontSize: 10, color: c.muted,
          }}
        >
          {fmtAgo(d.ageSec)}
        </span>
      </div>

      {/* route */}
      <div style={{ display: "flex", alignItems: "stretch", borderRadius: r.md, background: "var(--ae-surface-2)", border: `1px solid ${c.hairline}`, overflow: "hidden" }}>
        <Endpoint code={from?.iata ?? d.nearest?.icao ?? "—"} city={from?.city ?? "Nearest owned field"} role="NEAREST" />
        <div style={{ width: 1, background: c.hairline }} />
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
        <div style={{ width: 1, background: c.hairline }} />
        <Endpoint code={to?.iata ?? d.ahead?.icao ?? "—"} city={to?.city ?? "No field on track"} role="INFERRED" />
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
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
        onFocus={() => setSelectedLiveFlight(flight)}
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
  const family = aircraftFamily(craft?.type)

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
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: 132, borderRadius: r.md, position: "relative", overflow: "hidden",
          background: "var(--ae-surface-2)", border: `1px solid ${c.hairline}`,
          opacity: cancelled ? 0.6 : 1,
        }}
      >
        <AircraftSilhouette family={family} size={124} fill="var(--ae-text-3)" line="var(--ae-surface-2)" />
        <span
          style={{
            position: "absolute", left: 10, top: 9,
            fontFamily: ff.mono, fontSize: 10, fontWeight: 600,
            letterSpacing: "0.12em", textTransform: "uppercase", color: tone,
          }}
        >
          {cancelled ? "✕ Cancelled" : delay > 0 ? `Delayed +${delay}m` : "Scheduled"}
        </span>
        {craft?.type && (
          <span style={{ position: "absolute", right: 10, top: 9, fontFamily: ff.mono, fontSize: 10, color: c.muted }}>
            {craft.type}
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "stretch", borderRadius: r.md, background: "var(--ae-surface-2)", border: `1px solid ${c.hairline}`, overflow: "hidden" }}>
        <Endpoint code={o?.iata ?? flight.origin} city={o?.city ?? flight.origin} role="DEPARTURE" />
        <div style={{ width: 1, background: c.hairline }} />
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
        <div style={{ width: 1, background: c.hairline }} />
        <Endpoint code={dst?.iata ?? flight.destination} city={dst?.city ?? flight.destination} role="ARRIVAL" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <Cell label="Scheduled" value={fmtT(flight.scheduled_departure)} />
        <Cell label="Scheduled" value={fmtT(flight.scheduled_arrival)} />
        <Cell
          label={delay > 0 ? "Revised" : "Estimated"}
          value={cancelled ? "—" : shifted(flight.scheduled_departure, delay)}
          tone={delay > 0 ? "var(--ae-amber-ink)" : undefined}
        />
        <Cell
          label={delay > 0 ? "Revised" : "Estimated"}
          value={cancelled ? "—" : shifted(flight.scheduled_arrival, delay)}
          tone={delay > 0 ? "var(--ae-amber-ink)" : undefined}
        />
      </div>

      <SectionLabel>Flight information</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
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
