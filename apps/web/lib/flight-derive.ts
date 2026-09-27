/**
 * Pure flight geometry and ADS-B interpretation.
 *
 * Extracted from `components/simulator/flight-map.tsx` 2026-08-16 so the flight
 * DETAIL panel can answer "how fast, how high, what phase, how far to run" from
 * the same arithmetic the MAP uses to draw the mark. Duplicating it would have
 * reproduced the exact failure design.md already records for the cascade ramp:
 * two surfaces describing the same flight in numbers that quietly disagree.
 *
 * Nothing in here touches Leaflet or the DOM — that is the point. The map is a
 * `next/dynamic` chunk carrying Leaflet; importing these helpers from it would
 * have pulled the whole mapping stack into any panel that wanted a ground
 * speed.
 *
 * Everything is computed from ADS-B fields that actually exist on the wire. No
 * invented route, passenger or aircraft-age data (design.md, honest copy).
 */

import { NIMBUS_AIRPORTS } from "@/components/simulator/airports"
import type { LiveFlight } from "@/stores/simulation"

/** Great-circle distance in nautical miles. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  return (
    ((Math.atan2(
      Math.sin(Δλ) * Math.cos(φ2),
      Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ),
    ) * 180) / Math.PI + 360) % 360
  )
}

const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
export function cardinal(deg: number): string {
  return CARDINALS[Math.round((deg % 360) / 22.5) % 16]
}

/** Approximate speed of sound (kt) at a given pressure altitude (ft). */
export function machFor(gsKt: number, altFt: number): number | null {
  if (!gsKt || gsKt <= 0) return null
  const h = Math.min(altFt, 36089)
  const a = 661.5 * Math.sqrt(Math.max(0.55, 1 - 6.8756e-6 * h))
  return gsKt / a
}

/** Dead-reckon a position forward along its track. Clamped to 180s — beyond
 *  that a straight-line extrapolation of a turning aircraft is fiction. */
export function deadReckon(lat: number, lon: number, hdgDeg: number, velKt: number, sec: number, maxSeconds = 180): [number, number] {
  const s = Math.min(Math.max(sec, 0), maxSeconds)
  const distNm = velKt * (s / 3600)
  if (distNm < 0.0001) return [lat, lon]
  const R = 3440.065, d = distNm / R
  const hdg = (hdgDeg * Math.PI) / 180
  const φ1 = (lat * Math.PI) / 180, λ1 = (lon * Math.PI) / 180
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(hdg))
  const λ2 = λ1 + Math.atan2(Math.sin(hdg) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2))
  return [(φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI]
}

export function interp(lat1: number, lon1: number, lat2: number, lon2: number, t: number): [number, number] {
  return [lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t]
}

export function isoToHour(iso: string): number {
  try { const d = new Date(iso); return d.getUTCHours() + d.getUTCMinutes() / 60 } catch { return 12 }
}

/** Quadratic bezier arc — a natural-looking curved leg between two points. */
export function arcPoints(lat1: number, lon1: number, lat2: number, lon2: number, n = 28): [number, number][] {
  const midLat = (lat1 + lat2) / 2 + Math.abs(lat2 - lat1) * 0.18
  const midLon = (lon1 + lon2) / 2
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    return [
      (1 - t) * (1 - t) * lat1 + 2 * (1 - t) * t * midLat + t * t * lat2,
      (1 - t) * (1 - t) * lon1 + 2 * (1 - t) * t * midLon + t * t * lon2,
    ] as [number, number]
  })
}

export type FlightPhase = { label: string; tone: string; pct: number }
export type LiveDerived = ReturnType<typeof deriveLive>

/**
 * Rich derived state for a live ADS-B contact: phase of flight, nearest Nimbus
 * airport (behind = likely origin, ahead-in-track = likely arrival with a rough
 * ETA), signal age.
 *
 * `ahead` is a GUESS and is labelled as one wherever it surfaces — it is the
 * nearest owned airport within ±55° of the current track, which is a heuristic,
 * not a filed flight plan. ADS-B carries no destination field.
 */
export function deriveLive(f: LiveFlight) {
  const alt = f.altitude_ft ?? 0
  const vs = f.vertical_fpm ?? 0
  const gs = f.velocity_kt ?? 0
  // Tones are the CONSOLE register's pigments. On the paper register these were
  // #553B9E / #B8863C / #5B3FA8, which measure 1.9–2.6:1 on the #16181F panel.
  const phase: FlightPhase = f.on_ground
    ? { label: "On ground", tone: "#9BA2B4", pct: 0 }
    : vs > 350
      ? { label: "Climbing", tone: "#B9A3EE", pct: Math.min(1, alt / 38000) }
      : vs < -400
        ? { label: alt < 10000 ? "Approach" : "Descending", tone: "#E8BE6B", pct: Math.min(1, alt / 38000) }
        : alt > 18000
          ? { label: "Cruise", tone: "#4FA3E3", pct: Math.min(1, alt / 38000) }
          : { label: "Level", tone: "#4FA3E3", pct: Math.min(1, alt / 38000) }

  let nearest: { icao: string; nm: number } | null = null
  let ahead: { icao: string; nm: number; etaMin: number } | null = null
  const hdg = f.heading ?? 0
  for (const icao in NIMBUS_AIRPORTS) {
    const ap = NIMBUS_AIRPORTS[icao]
    const nm = distanceNm(f.lat, f.lon, ap.lat, ap.lon)
    if (!nearest || nm < nearest.nm) nearest = { icao, nm }
    const brg = bearing(f.lat, f.lon, ap.lat, ap.lon)
    const diff = Math.abs(((brg - hdg + 540) % 360) - 180)
    if (f.heading !== null && diff < 55 && gs > 60) {
      const etaMin = (nm / gs) * 60
      if (!ahead || nm < ahead.nm) ahead = { icao, nm, etaMin }
    }
  }
  const ageSec = Math.max(0, Math.round(Date.now() / 1000 - f.last_contact))
  const mach = machFor(gs, alt)
  return { phase, nearest, ahead, ageSec, mach, alt, vs, gs, hdg }
}

// ── Unit formatting ──────────────────────────────────────────────────────
// The reference detail card is metric; the operational feeds are ADS-B, which
// is knots and feet. Both are shown rather than converted away — a dispatcher
// reads flight levels and knots, and converting those to metres would make the
// console disagree with every other instrument they have open.
export const nmToKm = (nm: number) => nm * 1.852
export const ftToM  = (ft: number) => ft * 0.3048
export const ktToKmh = (kt: number) => kt * 1.852

export function fmtDuration(min: number): string {
  if (!isFinite(min) || min < 0) return "—"
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m} min`
}

export function fmtAgo(sec: number): string {
  if (sec < 60) return `${sec}s ago`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")} ago`
  return `${Math.floor(m / 60)}h ago`
}
