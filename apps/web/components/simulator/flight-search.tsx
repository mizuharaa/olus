"use client"
import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { Search, Plane, X, MapPin, Radio, ExternalLink, Loader2 } from "lucide-react"
import { useSimulationStore, type LiveFlight } from "@/stores/simulation"
import { NIMBUS_AIRPORTS } from "./airports"
import { apiClient } from "@/lib/api"
import { c, ff, r, sp, sh } from "@/lib/design-tokens"
import { Eyebrow } from "@/components/ds/primitives"

interface Props {
  selectedFlight: string | null
  onSelect: (id: string | null) => void
}

// Live ADS-B rows use the neutral register — the live layer is background
// context; disruption pigments (amber/rust) stay reserved for sim state.
const LIVE_BLUE     = "var(--ae-text-3)"
const LIVE_BLUE_BG  = "var(--ae-surface-2)"

export function FlightSearch({ selectedFlight, onSelect }: Props) {
  const { schedule, flightStates, liveFlights, setSelectedLiveFlight, selectedLiveFlight } =
    useSimulationStore()
  const [q, setQ]             = useState("")
  const [open, setOpen]       = useState(false)
  const [liveResults, setLiveResults]   = useState<LiveFlight[]>([])
  const [searching, setSearching]       = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef  = useRef<HTMLDivElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const scheduledMatches = useMemo(() => {
    const needle = q.trim().toUpperCase()
    if (!needle) return schedule.slice(0, 8)
    return schedule
      .filter((f) =>
        f.id.toUpperCase().includes(needle) ||
        (f.aircraft_id ?? "").toUpperCase().includes(needle) ||
        f.origin.toUpperCase().includes(needle) ||
        f.destination.toUpperCase().includes(needle) ||
        (NIMBUS_AIRPORTS[f.origin]?.iata ?? "").includes(needle) ||
        (NIMBUS_AIRPORTS[f.destination]?.iata ?? "").includes(needle),
      )
      .slice(0, 10)
  }, [q, schedule])

  const doLiveSearch = useCallback(async (query: string) => {
    if (query.length < 2) { setLiveResults([]); return }
    setSearching(true)
    try {
      const res = await apiClient.get<{ results?: LiveFlight[] }>(
        `/flights/search?q=${encodeURIComponent(query)}`
      )
      setLiveResults(res.data.results || [])
    } catch {
      setLiveResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const localLiveMatches = useMemo(() => {
    const needle = q.trim().toUpperCase()
    if (!needle || needle.length < 2) return []
    return liveFlights
      .filter((f) =>
        (f.callsign ?? "").toUpperCase().includes(needle) ||
        f.icao24.toUpperCase().includes(needle) ||
        (f.flight_iata ?? "").includes(needle) ||
        (f.flight_icao ?? "").toUpperCase().includes(needle),
      )
      .slice(0, 8)
  }, [q, liveFlights])

  useEffect(() => {
    clearTimeout(debounce.current)
    if (q.trim().length >= 2) {
      debounce.current = setTimeout(() => doLiveSearch(q.trim()), 400)
    } else {
      setLiveResults([])
    }
    return () => clearTimeout(debounce.current)
  }, [q, doLiveSearch])

  const mergedLive: LiveFlight[] = useMemo(() => {
    const seen = new Set<string>()
    const merged: LiveFlight[] = []
    for (const f of [...liveResults, ...localLiveMatches]) {
      if (!seen.has(f.icao24)) { seen.add(f.icao24); merged.push(f) }
    }
    return merged.slice(0, 10)
  }, [liveResults, localLiveMatches])

  const selectedSchedFlight = selectedFlight ? schedule.find((f) => f.id === selectedFlight) : null
  const activeLabel = selectedLiveFlight
    ? selectedLiveFlight.flight_icao
    : selectedSchedFlight
    ? selectedSchedFlight.id
    : null

  const handleSelectScheduled = (id: string) => {
    onSelect(id); setSelectedLiveFlight(null); setOpen(false); setQ("")
  }
  const handleSelectLive = (lf: LiveFlight) => {
    setSelectedLiveFlight(lf); onSelect(null); setOpen(false); setQ("")
  }
  const handleClear = () => {
    onSelect(null); setSelectedLiveFlight(null); setQ(""); inputRef.current?.focus()
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", fontFamily: ff.body }}>
      {/* Search input */}
      <div
        className="ae-search-shell"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderRadius: r.lg,
          background: c.canvas,
          padding: "0 16px",
          height: 44,
          border: `1px solid ${c.hairline}`,
          boxShadow: open ? sh.buttonFocus : sh.cardSoft,
          transition: "box-shadow 150ms ease",
        }}
      >
        {searching ? (
          <Loader2 className="animate-spin" style={{ width: 16, height: 16, color: c.ink, flexShrink: 0 }} />
        ) : (
          <Search style={{ width: 16, height: 16, color: c.muted, flexShrink: 0 }} />
        )}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          // A placeholder is not a label — it disappears on first keystroke and
          // several screen readers never announce it. This field had no name at
          // all. aria-label carries it without adding visible chrome.
          aria-label="Search flights by number, tail or airport code"
          placeholder={
            activeLabel
              ? `Selected: ${activeLabel} — search another…`
              : "Search any flight — AA123, UAL456, N12345, or airport code…"
          }
          style={{
            flex: 1,
            minHeight: 32, // was rendering at 21px
            background: "transparent",
            // The wrapper draws the ring (see .ae-search-shell in globals.css).
            // This input previously set outline:none with NOTHING replacing it,
            // so the most-used control on the console had no focus indicator at
            // all — not a weak one, none.
            outline: "none",
            border: "none",
            fontSize: 14,
            fontFamily: ff.body,
            color: c.ink,
          }}
        />
        {activeLabel && (
          <button
            onClick={handleClear}
            aria-label="Clear"
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              borderRadius: r.sm,
              border: "none",
              background: "transparent",
              color: c.muted,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X style={{ width: 13, height: 13 }} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 1000,
            left: 0,
            right: 0,
            marginTop: 8,
            background: c.canvas,
            borderRadius: r.lg,
            overflow: "hidden",
            border: `1px solid ${c.hairline}`,
            boxShadow: sh.overlay,
          }}
        >
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>

            {/* Live ADS-B section */}
            {(mergedLive.length > 0 || searching) && (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px",
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                    background: LIVE_BLUE_BG,
                    borderBottom: `1px solid ${c.hairline}`,
                  }}
                >
                  <Radio style={{ width: 13, height: 13, color: LIVE_BLUE }} />
                  <Eyebrow color={LIVE_BLUE}>Live ADS-B Aircraft</Eyebrow>
                  {searching && <Loader2 className="animate-spin" style={{ width: 12, height: 12, color: LIVE_BLUE, marginLeft: "auto" }} />}
                </div>
                {mergedLive.map((lf) => {
                  const isSelected = selectedLiveFlight?.icao24 === lf.icao24
                  const altStr = lf.altitude_ft != null ? `${lf.altitude_ft.toLocaleString()} ft` : ""
                  const spdStr = lf.velocity_kt != null ? `${lf.velocity_kt} kt` : ""
                  return (
                    <div
                      key={lf.icao24}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 16px",
                        background: isSelected ? LIVE_BLUE_BG : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <button
                        onClick={() => handleSelectLive(lf)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          flex: 1,
                          minWidth: 0,
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{ width: 7, height: 7, borderRadius: r.full, background: LIVE_BLUE, flexShrink: 0 }}
                        />
                        <Plane style={{ width: 16, height: 16, color: LIVE_BLUE, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: ff.mono, fontWeight: 600, color: c.ink, fontSize: 14 }}>
                              {lf.flight_icao}
                            </span>
                            {lf.flight_iata && lf.flight_iata !== lf.flight_icao && (
                              <span style={{ fontFamily: ff.mono, fontSize: 11, color: c.muted }}>{lf.flight_iata}</span>
                            )}
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: "1px 6px",
                                borderRadius: r.pill,
                                background: LIVE_BLUE,
                                color: c.onPrimary,
                              }}
                            >
                              LIVE
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {lf.airline_name}{altStr && ` · ${altStr}`}{spdStr && ` · ${spdStr}`}
                          </div>
                        </div>
                      </button>
                      {lf.tracking?.flightaware && (
                        <a
                          href={lf.tracking?.flightaware}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ flexShrink: 0, color: c.muted }}
                          title="Open in FlightAware"
                        >
                          <ExternalLink style={{ width: 13, height: 13 }} />
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Nimbus simulation section */}
            {scheduledMatches.length > 0 && (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px",
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                    background: c.surfaceSoft,
                    borderBottom: `1px solid ${c.hairline}`,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: r.full, background: c.signatureMustard, flexShrink: 0 }} />
                  <Eyebrow color={c.ink}>Nimbus Air Simulation</Eyebrow>
                </div>
                {scheduledMatches.map((f) => {
                  const state = flightStates[f.id]
                  const status = state?.status || "scheduled"
                  const delay  = state?.delay_minutes || 0
                  const cascadeOrder = state?.cascade_order ?? -1
                  const isSel  = selectedFlight === f.id
                  const o = NIMBUS_AIRPORTS[f.origin]
                  const d = NIMBUS_AIRPORTS[f.destination]
                  // Same semantic dot palette as everywhere else.
                  const dotColor =
                    status === "cancelled"     ? c.statusCancelled.dot :
                    cascadeOrder === 0         ? c.cascadeDirect       :
                    cascadeOrder >= 1          ? c.cascadeOrder1       :
                    delay > 0                  ? c.statusDelayed.dot   :
                                                  c.statusOnTime.dot
                  return (
                    <button
                      key={f.id}
                      onClick={() => handleSelectScheduled(f.id)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 16px",
                        textAlign: "left",
                        fontSize: 14,
                        background: isSel ? c.statusDelayed.bg : "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: c.ink,
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: r.full, background: dotColor, flexShrink: 0 }} />
                      <Plane style={{ width: 16, height: 16, color: c.muted, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: ff.mono, fontWeight: 600, color: c.ink }}>{f.id}</span>
                          <span style={{ fontFamily: ff.mono, fontSize: 11, color: c.muted }}>{f.aircraft_id}</span>
                          {delay > 0 && status !== "cancelled" && (
                            <span style={{ fontSize: 11, fontWeight: 500, color: c.statusDelayed.ink }}>+{delay}m</span>
                          )}
                          {status === "cancelled" && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 500,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                color: c.statusCancelled.ink,
                              }}
                            >
                              cancelled
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {o?.iata || f.origin}{o?.city ? ` (${o.city})` : ""} → {d?.iata || f.destination}{d?.city ? ` (${d.city})` : ""}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Empty state */}
            {q.trim().length >= 2 && mergedLive.length === 0 && scheduledMatches.length === 0 && !searching && (
              <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 14, color: c.muted }}>
                <p>No flights matching &ldquo;{q}&rdquo;.</p>
                <p style={{ fontSize: 12, marginTop: 4, color: c.muted, opacity: 0.7 }}>
                  Try a flight code like AA123, UAL456, or an airport like ORD.
                </p>
              </div>
            )}

            {/* Airport quick-jump */}
            {!q.trim() && (
              <div
                style={{
                  borderTop: `1px solid ${c.hairline}`,
                  padding: `${sp.sm}px ${sp.md}px`,
                  background: c.surfaceSoft,
                }}
              >
                <div style={{ marginBottom: sp.xs }}>
                  <Eyebrow>Jump to Airport</Eyebrow>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(NIMBUS_AIRPORTS).map(([icao, ap]) => (
                    <button
                      key={icao}
                      onClick={() => { setQ(icao); inputRef.current?.focus() }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        fontFamily: ff.mono,
                        padding: "4px 10px",
                        borderRadius: r.pill,
                        border: `1px solid ${c.hairline}`,
                        background: c.canvas,
                        color: c.body,
                        cursor: "pointer",
                        transition: "all 150ms ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = c.primary
                        e.currentTarget.style.color = c.onPrimary
                        e.currentTarget.style.borderColor = c.primary
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = c.canvas
                        e.currentTarget.style.color = c.body
                        e.currentTarget.style.borderColor = c.hairline
                      }}
                    >
                      <MapPin style={{ width: 11, height: 11 }} />
                      {ap.iata}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Live flight count hint */}
            {q.trim().length < 2 && liveFlights.length > 0 && (
              <div
                style={{
                  padding: "8px 16px",
                  borderTop: `1px solid ${c.hairline}`,
                  fontSize: 11,
                  color: c.muted,
                }}
              >
                {liveFlights.length.toLocaleString()} live aircraft tracked · type a flight code to search
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
