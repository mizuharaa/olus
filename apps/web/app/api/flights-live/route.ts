/**
 * Vercel-native live flights endpoint using adsb.lol.
 *
 * OpenSky blocks all cloud-provider IPs (Railway, Vercel Node.js, Vercel Edge)
 * at the TCP level. adsb.lol is a free community ADS-B aggregator that allows
 * cloud access without authentication and returns data already normalised to
 * feet / knots / fpm — no unit conversion required.
 *
 * Coverage: ONE query, radius 1400nm from (37°N, -95°W) — reaches every CONUS
 * corner (SEA ~1370nm is the farthest) without dragging in half the Atlantic
 * like the old 2500nm did. Measured against a degraded feed (2026-07-15):
 * 1400nm ≈ 9.5s / ~1000 aircraft, while 2500nm was still streaming at 20s —
 * which, against the old 6s abort, is exactly why prod maps rendered empty.
 * Parallel regional fan-out is NOT an option: adsb.lol rate-limits per IP
 * (measured 429/420 on a 10-request burst). One request per cycle it is.
 * Alaska/Hawaii are outside the circle but the app focuses on CONUS.
 *
 * adsb.lol field reference:
 *   hex        ICAO 24-bit transponder code
 *   flight     callsign (may have trailing spaces)
 *   lat / lon  position
 *   alt_baro   barometric altitude in feet (string "ground" when on ground)
 *   gs         ground speed in knots
 *   track      true track / heading in degrees (0 = north, clockwise)
 *   baro_rate  vertical rate in ft/min
 *   squawk     squawk code (4-digit string)
 *   r          registration
 */
import { NextResponse } from "next/server"

export const runtime = "edge"
export const dynamic = "force-dynamic"

const ADSB_LOL_URL = "https://api.adsb.lol/v2/lat/37/lon/-95/dist/1400"
// Fallback when the wide query times out or comes back empty: a tighter
// circle answers much faster on a degraded feed — fewer planes beats an
// empty map.
const ADSB_LOL_URL_NARROW = "https://api.adsb.lol/v2/lat/37/lon/-95/dist/900"

// ICAO callsign prefix → IATA two-letter code (from apps/api/src/data/airlines.py)
const ICAO_TO_IATA: Record<string, string> = {
  AAL: "AA", UAL: "UA", DAL: "DL", SWA: "WN", JBU: "B6",
  ASA: "AS", NKS: "NK", FFT: "F9", AAY: "G4", HAL: "HA",
  SXJ: "XP", SKW: "OO", RPA: "YV", PDT: "OE", ENY: "MQ",
  GJS: "G7", CPZ: "CP", ERA: "7H", ASH: "AX", BTA: "WQ",
  TSO: "KS", GPD: "G1", FDX: "FX", UPS: "5X", GTI: "GB",
  ATN: "8C", ABX: "GB", WJA: "WS", ACA: "AC", TRS: "TS",
  BAW: "BA", VIR: "VS", EZY: "U2", DLH: "LH", CFG: "DE",
  AFR: "AF", TOM: "BY", KLM: "KL", IBE: "IB", VLG: "VY",
  AZA: "AZ", SAS: "SK", JAL: "JL", ANA: "NH", KAL: "KE",
  AAR: "OZ", CPA: "CX", SIA: "SQ", QFA: "QF", UAE: "EK",
  ETD: "EY", QTR: "QR", SVA: "SV", THY: "TK", TAM: "JJ",
  GLO: "G3", AZU: "AD", AMX: "AM", VOI: "Y4", AVA: "AV",
  LAN: "LA", JKK: "JJ", EIN: "EI", ETH: "ET", MSR: "MS",
}

const AIRLINE_NAMES: Record<string, string> = {
  AA: "American Airlines", UA: "United Airlines", DL: "Delta Air Lines",
  WN: "Southwest Airlines", B6: "JetBlue Airways", AS: "Alaska Airlines",
  NK: "Spirit Airlines", F9: "Frontier Airlines", G4: "Allegiant Air",
  HA: "Hawaiian Airlines", OO: "SkyWest Airlines", YV: "Mesa Airlines",
  MQ: "Envoy Air", G7: "GoJet Airlines", FX: "FedEx Express",
  "5X": "UPS Airlines", AC: "Air Canada", WS: "WestJet",
  BA: "British Airways", VS: "Virgin Atlantic", LH: "Lufthansa",
  AF: "Air France", KL: "KLM", IB: "Iberia", AZ: "ITA Airways",
  SK: "SAS", JL: "Japan Airlines", NH: "All Nippon Airways",
  KE: "Korean Air", OZ: "Asiana Airlines", CX: "Cathay Pacific",
  SQ: "Singapore Airlines", QF: "Qantas", EK: "Emirates",
  EY: "Etihad Airways", QR: "Qatar Airways", SV: "Saudia",
  TK: "Turkish Airlines", ET: "Ethiopian Airlines", LA: "LATAM Airlines",
  AM: "Aeroméxico", AV: "Avianca",
}

interface AdsbLolAircraft {
  hex?: string
  flight?: string
  lat?: number
  lon?: number
  alt_baro?: number | string
  alt_geom?: number
  gs?: number
  track?: number
  baro_rate?: number
  squawk?: string
  r?: string
  seen_pos?: number
  observed_at?: number
}

async function fetchAdsb(url: string, timeoutMs: number): Promise<AdsbLolAircraft[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": "Olus/0.2 (github.com/mizuharaa/olus)" },
    })
    if (!res.ok) return []
    const body = (await res.json()) as { ac?: AdsbLolAircraft[]; now?: number }
    // adsb.lol's readsb-compatible response uses milliseconds for `now`.
    const timestamp = typeof body.now === "number" && Number.isFinite(body.now)
      ? (body.now > 1e12 ? body.now / 1000 : body.now) : Date.now() / 1000
    return (body.ac ?? []).map(ac => ({ ...ac, observed_at: timestamp - (typeof ac.seen_pos === "number" && Number.isFinite(ac.seen_pos) ? Math.max(0, ac.seen_pos) : 60) }))
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export async function GET() {
  // 11s abort on the wide query: clears the measured ~9.5s degraded-feed
  // latency (the old 6s abort was shorter than the feed's own response time
  // — guaranteed empty maps). If it still comes back empty, one narrow
  // retry — the pair (~17s worst case) stays inside the client's 13s poll
  // abort + CDN stale-while-revalidate, and well under Edge's 25s window.
  let aircraft = await fetchAdsb(ADSB_LOL_URL, 11000)
  if (aircraft.length === 0) {
    aircraft = await fetchAdsb(ADSB_LOL_URL_NARROW, 6000)
  }
  if (aircraft.length === 0) {
    return NextResponse.json(
      { flights: [], error: "Live traffic is unavailable. Retained positions may be stale." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    )
  }

  const flights = []
  for (const ac of aircraft) {
    const callsignRaw = (ac.flight ?? "").trim()
    if (!callsignRaw) continue

    const lat = ac.lat
    const lon = ac.lon
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) continue

    // Skip ground traffic (alt_baro is the string "ground" when on ground)
    const onGround = ac.alt_baro === "ground" || ac.alt_baro === 0
    if (onGround) continue

    const altFt = typeof ac.alt_baro === "number" ? ac.alt_baro : null
    const icao24 = (ac.hex ?? "").toLowerCase()

    // Derive IATA airline code from the 3-letter ICAO callsign prefix
    const icaoPrefix = callsignRaw.slice(0, 3).toUpperCase()
    const iata = ICAO_TO_IATA[icaoPrefix] ?? null
    const num = callsignRaw.slice(3).replace(/\s+$/, "")
    const flightIata = iata && num ? iata + num : null
    const airlineName = iata ? (AIRLINE_NAMES[iata] ?? "Unknown") : "Unknown"

    flights.push({
      icao24,
      callsign: callsignRaw,
      flight_iata: flightIata,
      flight_icao: callsignRaw,
      airline_iata: iata,
      airline_name: airlineName,
      origin_country: "",
      lat,
      lon,
      altitude_ft: altFt,
      on_ground: false,
      velocity_kt: ac.gs != null ? Math.round(ac.gs) : null,
      heading: ac.track ?? null,
      vertical_fpm: ac.baro_rate != null ? Math.round(ac.baro_rate) : null,
      squawk: ac.squawk ?? null,
      last_contact: ac.observed_at,
      tracking: {
        flightaware: callsignRaw
          ? `https://www.flightaware.com/live/flight/${callsignRaw}`
          : null,
        flightradar24: flightIata
          ? `https://www.flightradar24.com/${flightIata}`
          : `https://www.flightradar24.com/${callsignRaw}`,
        adsbexchange: `https://globe.adsbexchange.com/?icao=${icao24}`,
        opensky: `https://opensky-network.org/aircraft-profile?icao24=${icao24}`,
      },
    })
  }

  return NextResponse.json(
    { flights, total: flights.length, source: "adsb.lol" },
    {
      headers: {
        // Vercel CDN serves all clients from one upstream burst per 15s
        // (matches the client poll interval); stale answers beat empty maps.
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=120",
      },
    },
  )
}
