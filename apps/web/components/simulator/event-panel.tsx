"use client"
import { FORM_SCHEMA, eventParams } from "@/lib/event-forms"
import React, { useState, useEffect, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Cloud, OctagonAlert, Ban, ShieldAlert, Wrench,
  HeartPulse, AlertTriangle, Radio, Mountain, ServerCrash,
  Zap, Activity, Loader2, RefreshCw, CloudLightning, Wind,
  TriangleAlert, Globe, MapPin, Gauge,
  CloudSnow, Tornado, Droplets, Bird, Snowflake, Flame, Users, ChevronDown, Eye, Radar,
} from "lucide-react"
import { apiClient } from "@/lib/api"
import { useSimulationStore } from "@/stores/simulation"
import { toast } from "sonner"
import { airportLabel } from "@/lib/labels"
import { AirportCode } from "./airport-code"
import { c, ff, r } from "@/lib/design-tokens"
import { ButtonPrimary, Eyebrow } from "@/components/ds/primitives"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

// Airports + ARTCC facilities are surfaced as ICAO-only codes that mean nothing
// to a non-airline-ops viewer. These helpers turn raw codes into "KORD — Chicago
// O'Hare" inside <option> labels (where we can't render JSX) and to expose a
// canonical name for ARTCC centers in the same dropdowns.

function airportOptionLabel(icao: string): string {
  const ap = airportLabel(icao)
  if (!ap.name && !ap.city) return icao
  const tail = [ap.city, ap.name].filter(Boolean).join(" ")
  return `${icao} — ${tail}`
}

const DETECTION_LABELS: Record<string, string> = {
  radar: "Radar / C-UAS track (corroborated)",
  pilot_report: "Pilot report (unverified)",
}

const ARTCC_NAMES: Record<string, string> = {
  ZAU: "Chicago Center",
  ZTL: "Atlanta Center",
  ZFW: "Fort Worth Center",
  ZLA: "Los Angeles Center",
  ZDV: "Denver Center",
  ZNY: "New York Center",
  ZSE: "Seattle Center",
  ZMA: "Miami Center",
  ZAB: "Albuquerque Center",
  ZMP: "Minneapolis Center",
}

function isAirportField(key: string) {
  return key === "airport" || key === "destination_airport" || key === "base"
}

function selectOptionLabel(fieldKey: string, raw: string): string {
  if (isAirportField(fieldKey)) return airportOptionLabel(raw)
  if (fieldKey === "detection") return DETECTION_LABELS[raw] ?? raw
  if (fieldKey === "facility_id") {
    const name = ARTCC_NAMES[raw]
    return name ? `${raw} — ${name}` : raw
  }
  return raw
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AIRPORTS = ["KORD","KATL","KDFW","KLAX","KDEN","KJFK","KSEA","KMIA","KPHX","KLAS","KBOS","KSFO","KIAH","KDTW","KMSP"]
const AIRCRAFT  = Array.from({ length: 40 }, (_, i) => `N${String(i + 1).padStart(3, "0")}NB`)

const EVENT_TYPES = [
  // Uncrewed aircraft — the only event type whose duration is unknown when it fires
  { value: "drone_incursion",   label: "Drone Incursion",     Icon: Radar,          color: "amber"   },
  // Weather
  { value: "weather_closure",   label: "Weather Closure",     Icon: Cloud,          color: "sky"     },
  { value: "thunderstorm",      label: "Thunderstorm Cell",   Icon: CloudLightning, color: "blue"    },
  { value: "blizzard",          label: "Winter Storm",        Icon: CloudSnow,      color: "slate"   },
  { value: "sandstorm",         label: "Sandstorm / Haboob",  Icon: Wind,           color: "amber"   },
  { value: "dense_fog",         label: "Dense Fog",           Icon: Eye,            color: "stone"   },
  { value: "wind_shear",        label: "Wind Shear",          Icon: Gauge,          color: "cyan"    },
  { value: "hurricane",         label: "Hurricane / Cyclone", Icon: Tornado,        color: "purple"  },
  { value: "volcanic_ash",      label: "Volcanic Ash",        Icon: Mountain,       color: "stone"   },
  // ATC & Airspace
  { value: "ground_stop",       label: "Ground Stop",         Icon: OctagonAlert,   color: "orange"  },
  { value: "airspace_closure",  label: "Airspace Closure",    Icon: Ban,            color: "red"     },
  { value: "atc_staffing",      label: "ATC Shortage",        Icon: Radio,          color: "indigo"  },
  // Aircraft & Operations
  { value: "mechanical_aog",    label: "Mechanical AOG",      Icon: Wrench,         color: "amber"   },
  { value: "bird_strike",       label: "Bird Strike / FOD",   Icon: Bird,           color: "lime"    },
  { value: "deicing_shortage",  label: "Deicing Shortage",    Icon: Snowflake,      color: "blue"    },
  { value: "runway_closure",    label: "Runway Closure",      Icon: AlertTriangle,  color: "yellow"  },
  { value: "fuel_contamination",label: "Fuel Contamination",  Icon: Droplets,       color: "orange"  },
  // Crew & Personnel
  { value: "crew_sickout",      label: "Crew Sick-out",       Icon: HeartPulse,     color: "pink"    },
  { value: "labor_action",      label: "Labor Slowdown",      Icon: Users,          color: "emerald" },
  // Security & Emergency
  { value: "security_event",    label: "Security Event",      Icon: ShieldAlert,    color: "rose"    },
  { value: "airport_emergency", label: "Airport Emergency",   Icon: Flame,          color: "red"     },
  { value: "cyber_incident",    label: "Cyber Incident",      Icon: ServerCrash,    color: "violet"  },
] as const

type EventKind = typeof EVENT_TYPES[number]["value"]

const EVENT_CATEGORIES: { label: string; events: EventKind[] }[] = [
  { label: "Uncrewed Aircraft", events: ["drone_incursion"] },
  { label: "Weather", events: ["weather_closure","thunderstorm","blizzard","sandstorm","dense_fog","wind_shear","hurricane","volcanic_ash"] },
  { label: "Air Traffic Control", events: ["ground_stop","airspace_closure","atc_staffing"] },
  { label: "Aircraft & Operations", events: ["mechanical_aog","bird_strike","deicing_shortage","runway_closure","fuel_contamination"] },
  { label: "Crew & Personnel", events: ["crew_sickout","labor_action"] },
  { label: "Security & Emergency", events: ["security_event","airport_emergency","cyber_incident"] },
]

// The 01–22 ledger index was REMOVED on 2026-08-17.
//
// It numbered the event types by their position in the hardcoded
// EVENT_CATEGORIES array. That sequence is not information: nobody refers to
// "event 07", the numbers change meaning the moment a type is added in the
// middle, and they are not an ID the API knows. What they were was decoration
// that looked like data — the most expensive kind, because it reads as
// meaningful and then rewards nobody who tries to use it.
//
// Deleting them also hands 22px per row back to a 360px column, across 22
// rows, which is the density this board is supposed to be spending on content.

const EVENT_DESCRIPTIONS: Record<EventKind, string> = {
  drone_incursion:
    "A drone over the airfield suspends runway operations — and unlike every other event here, nobody knows for how long. The field reopens when the search comes up empty and re-closes on the next sighting, so the closure length is modelled as a distribution (log-normal: median 45 min, p95 3 hr) rather than a fixed end time. A corroborated radar / C-UAS track holds the field far longer than a single unverified pilot report. Recovery plans are solved across sampled durations and carry a regret band: what the plan costs if the guess is wrong.",
  weather_closure:
    "A weather system forces closure or severe capacity reductions at the affected airport. Ground operations halt as conditions drop below VFR minimums, causing widespread delays and diversions across the entire hub bank structure.",
  thunderstorm:
    "A convective cell or squall line produces embedded cumulonimbus clouds with lightning, hail, and severe turbulence. Aircraft must deviate up to 40 nm around active cells, significantly dropping arrival rates and congesting vectoring airspace.",
  blizzard:
    "Heavy snowfall exceeding 1 in/hr combined with winds over 35 kt creates whiteout conditions and rapid runway accumulation. Deicing queues build, CAT III approaches may be suspended, and ramp operations slow significantly — snow removal cannot keep pace above 2 in/hr.",
  sandstorm:
    "A haboob or blowing-dust event reduces visibility below 1/4 mile and coats engine inlet screens with abrasive particles. Engines require borescope inspection before return to service after even a brief dust ingestion event.",
  dense_fog:
    "IFR or LIFR conditions reduce visibility and ceiling below CAT I minimums (RVR 1800 / 200 ft). Only CAT II/III-certified aircraft and crews can continue approaches, dropping a major hub's arrival rate from ~100 to ~30 operations per hour.",
  wind_shear:
    "Low-Level Wind Shear (LLWS) detected via PIREP or LLWAS forces increased spacing and frequent missed approaches on the affected runway. Particularly severe during thunderstorm outflows and cold-front passages — some crews go missed multiple times before landing.",
  hurricane:
    "Pre-emptive mass cancellations begin 48-72 hours before landfall as airlines ferry aircraft out of the storm track to safe bases. Post-storm, airport structural assessment and crew return positioning can take 24-96 hours before operations fully resume.",
  volcanic_ash:
    "An ash cloud SIGMET makes transiting the affected radius hazardous — volcanic glass particles cause engine flame-out and windshield abrasion. All routes within the plume radius must reroute or cancel; the closure can persist for days depending on wind direction.",
  ground_stop:
    "The FAA issues a Ground Stop (GS) halting all departures destined for the affected airport. Aircraft already airborne continue; all on-ground departures are held at origin. A Ground Delay Program (GDP) typically follows if the stop persists beyond 1-2 hours.",
  airspace_closure:
    "A NOTAM-based Temporary Flight Restriction (TFR) closes a block of en-route airspace, forcing all transiting traffic onto longer reroutes. Depending on the closed ARTCC sector, rerouting can add 45-120 minutes to block times and overload adjacent sectors.",
  atc_staffing:
    "Understaffing at an ARTCC (Air Route Traffic Control Center) reduces the number of active sectors, widening spacing requirements and lowering throughput. Arrival and departure rates can drop 30-50%, creating system-wide delay propagation across the NAS.",
  mechanical_aog:
    "An Aircraft-on-Ground (AOG) event grounds a tail number until maintenance certifies it airworthy. Every subsequent rotation on that aircraft is delayed or cancelled, often requiring spare aircraft swaps or short-notice wet-lease to cover the broken rotation chain.",
  bird_strike:
    "A bird ingestion event into one or both engines requires an immediate landing and engineering inspection. High-mass strikes from geese or pelicans may require engine removal, grounding the aircraft for 4-48 hours and breaking its full day's rotation.",
  deicing_shortage:
    "A surge of departures during freezing precipitation overwhelms deicing pad capacity, creating 45-90 minute queues per aircraft. Holdover times are short and aircraft may require re-treatment before departure, decoupling gate push from wheels-up by 60-120 minutes.",
  runway_closure:
    "FOD removal, pavement failure, or emergency vehicle response closes one or more runways. Losing one runway at a dual-runway airport cuts arrival/departure capacity by approximately 45%, typically triggering a Ground Delay Program within 30 minutes.",
  fuel_contamination:
    "A quality-control failure, water infiltration, or misfueling event triggers a hold on all fuel from the affected supply source. Departures halt until independent testing clears the fuel; airborne aircraft must divert to alternate airports with unaffected fuel supplies.",
  crew_sickout:
    "Coordinated or uncoordinated crew absences remove a percentage of qualified pilots or cabin crew from duty. Flights without a legal crew cannot depart regardless of aircraft readiness; crew scheduling must source reserves across all crew bases simultaneously.",
  labor_action:
    "A work slowdown — sometimes called a 'blue flu' — reduces effective staffing without a formal strike. Turnaround times increase 20-60% as crews work strictly to contract minimums; airlines cannot legally compel faster operations during an organized job action.",
  security_event:
    "A bomb threat, unattended bag incident, or unruly passenger requiring military escort triggers terminal evacuation and full re-screening. TSA re-screening of all passengers creates 2-6 hour gate hold queues; international arrivals may be held at remote stands indefinitely.",
  airport_emergency:
    "A full emergency declaration for terminal fire, structural failure, or a mass-casualty event closes the airfield for emergency vehicle access. Inbound flights are held at altitude or diverted; full recovery and re-certification typically takes 1-12 hours depending on incident severity.",
  cyber_incident:
    "A CrowdStrike/SITA-style IT failure simultaneously degrades check-in, weight & balance, dispatch, and crew scheduling systems. Manual fallback procedures add 30-90 minutes to every gate turn; a complete outage (100% degradation) effectively halts departure processing network-wide.",
}

// ─── Tile tone ───────────────────────────────────────────────────────────────
// One neutral treatment for all 21 event types; the accent color appears
// only on the SELECTED tile (teal border + teal icon). Icons are a single
// lucide set, one stroke weight, monochrome at rest — category identity
// comes from the group label, not from per-category color.

type Tone = {
  bg: string
  ink: string
  border: string
  iconBg: string
}

const NEUTRAL_TONE: Tone = {
  bg: "var(--ae-surface)",
  ink: "var(--ae-text)",
  border: "var(--ae-line)",
  iconBg: "var(--ae-surface-2)",
}

function toneFor(_kind: EventKind): Tone {
  return NEUTRAL_TONE
}

// ─── Live data types ──────────────────────────────────────────────────────────

interface FAAProgram {
  type: "ground_stop" | "ground_delay_program" | "departure_delay"
  airport_iata: string
  airport_icao: string
  reason: string
  avg_delay_minutes?: number
  avg_delay_raw?: string
  start?: string
  recheck?: string
  end?: string
  in_nimbus_network: boolean
  sim_event: { kind: string; params: Record<string, any> }
}

interface NWSAlert {
  id: string
  event: string
  headline: string
  severity: string
  area: string
  effective: string
  expires: string
  sender: string
  affected_nimbus_airports: string[]
  sim_event: { kind: string; params: Record<string, any> } | null
}

type LiveUsFaaSummary = {
  concurrent_total: number
  concurrent_ground_stops: number
  concurrent_gdps: number
  concurrent_departure_delay_programs: number
  unique_us_airports: number
  nimbus_network_overlap: number
} | null

type LiveUsNwsSummary = {
  nationwide_alerts_matched: number
  returned: number
  severe_or_extreme: number
  nimbus_touched: number
} | null

type FaaLivePayload = {
  programs: FAAProgram[]
  nimbus_affected?: number
  us_summary?: LiveUsFaaSummary
  source?: string
  error?: string
}
type NwsLivePayload = {
  alerts: NWSAlert[]
  nimbus_affected?: number
  us_summary?: LiveUsNwsSummary
  source?: string
  error?: string
}

const FAA_TYPE_ORDER: Record<string, number> = {
  ground_stop: 0,
  ground_delay_program: 1,
  departure_delay: 2,
}

// ─── Severity vocabulary — rust (critical) / amber (warning) only ────────────

const SEV = {
  critical: { dot: "var(--ae-amber)",       ink: "var(--ae-amber-ink)", bg: "var(--ae-amber-bg)" },
  high:     { dot: "var(--ae-amber-soft)",  ink: "var(--ae-amber-ink)", bg: "var(--ae-neutral-bg)" },
  moderate: { dot: "var(--ae-line-strong)", ink: "var(--ae-text-2)",    bg: "var(--ae-neutral-bg)" },
} as const

/** Teal "load into simulator" action chip. */
function SimButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 transition-all disabled:opacity-40"
      style={{ borderRadius: r.sm, background: "var(--ae-teal)", color: "#FFFFFF", border: "none", cursor: "pointer" }}
    >
      <Zap className="w-3 h-3" strokeWidth={1.75} /> Sim
    </button>
  )
}

/** Small severity chip — pigment dot + neutral text, never color-alone. */
function SevChip({ level, label }: { level: keyof typeof SEV; label: string }) {
  const s = SEV[level]
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
      style={{ background: s.bg, color: s.ink }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
      {label}
    </span>
  )
}

// ─── Alert row ───────────────────────────────────────────────────────────────

function renderAlertRow(
  alert: NWSAlert,
  isNimbus: boolean,
  isLoadingEvent: boolean,
  onLoadToSim: (kind: string, params: Record<string, any>) => Promise<void>
) {
  const level: keyof typeof SEV =
    alert.severity === "Extreme" ? "critical"
    : alert.severity === "Severe" ? "high"
    : "moderate"
  const sev = SEV[level]
  return (
    <div
      key={alert.id}
      className="rounded-lg border p-3"
      style={{
        borderColor: "var(--ae-line)",
        background: "var(--ae-surface)",
        borderLeft: isNimbus ? "2px solid var(--ae-teal)" : "1px solid var(--ae-line)",
      }}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            {alert.event.toLowerCase().includes("thunder") || alert.event.toLowerCase().includes("tornado")
              ? <CloudLightning className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} style={{ color: sev.ink }} />
              : alert.event.toLowerCase().includes("wind")
              ? <Wind className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} style={{ color: sev.ink }} />
              : <TriangleAlert className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} style={{ color: sev.ink }} />
            }
            <span className="text-xs font-semibold text-foreground">{alert.event}</span>
            <SevChip level={level} label={alert.severity} />
          </div>
          {isNimbus && (
            <div className="flex items-center gap-1 mb-1 flex-wrap">
              <span className="text-[11px] font-semibold" style={{ color: "var(--ae-teal-ink)" }}>Nimbus:</span>
              {alert.affected_nimbus_airports.map((ap) => (
                <span
                  key={ap}
                  className="text-[11px] font-mono px-1.5 py-0.5 rounded-md"
                  style={{ background: "var(--ae-teal-bg)", color: "var(--ae-teal-ink)" }}
                >
                  {ap.replace(/^K/, "")}
                </span>
              ))}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground line-clamp-2">{alert.area}</div>
        </div>
        {isNimbus && alert.sim_event && (
          <SimButton
            disabled={isLoadingEvent}
            onClick={() => onLoadToSim(alert.sim_event!.kind, alert.sim_event!.params)}
          />
        )}
      </div>
    </div>
  )
}

// ─── Live Feed ────────────────────────────────────────────────────────────────

type DisruptionItem = {
  id: string
  typeLabel: string
  typeSeverity: "critical" | "high" | "moderate"
  title: string
  detail: string
  airports: string[]
  isNimbus: boolean
  score: number
  simEvent?: { kind: string; params: Record<string, any> }
}

function SectionToggle({ label, badge, children, defaultOpen = true }: {
  label: string
  badge?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section>
      {/* One consistent header row everywhere: label left, badge + chevron
          pinned right in the same spot at the same size, 36px hit target. */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 w-full mb-2 rounded-lg px-2 transition-colors hover:bg-secondary focus-visible:outline-none"
        style={{ minHeight: 36, boxShadow: "none" }}
        onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) e.currentTarget.style.boxShadow = "0 0 0 3px var(--ae-focus)" }}
        onBlur={(e) => { e.currentTarget.style.boxShadow = "none" }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex-1 text-left">{label}</span>
        {badge}
        <span
          className="flex items-center justify-center shrink-0 rounded-md"
          style={{ width: 22, height: 22, border: "1px solid var(--ae-line)", background: "var(--ae-surface)" }}
        >
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} strokeWidth={1.75} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

export function LiveFeed({
  onLoadToSim,
  isLoadingEvent,
}: {
  onLoadToSim: (kind: string, params: Record<string, any>) => Promise<void>
  isLoadingEvent: boolean
}) {
  const [faaData, setFaaData]       = useState<FaaLivePayload | null>(null)
  const [alertsData, setAlertsData] = useState<NwsLivePayload | null>(null)
  const [fetching, setFetching]     = useState(false)
  const [lastFetch, setLastFetch]   = useState<Date | null>(null)
  const [nimbusOnly, setNimbusOnly] = useState(false)

  const fetchAll = useCallback(async () => {
    setFetching(true)
    try {
      // Primary: the Vercel-native /api/live-status route (FAA + NWS fetched
      // directly). This works even when the Railway backend is down — which is
      // why the weather/delay feed used to look empty.
      const res = await fetch("/api/live-status")
      if (res.ok) {
        const snap = (await res.json()) as { refreshed_at: string; faa: FaaLivePayload; nws: NwsLivePayload }
        setFaaData(snap.faa)
        setAlertsData(snap.nws)
        setLastFetch(new Date(snap.refreshed_at))
        return
      }
      throw new Error(`live-status ${res.status}`)
    } catch {
      // Fallback: the backend proxy, if it happens to be reachable.
      try {
        const snap = await apiClient.get<{ refreshed_at: string; faa: FaaLivePayload; nws: NwsLivePayload }>("/live/national-snapshot")
        setFaaData(snap.data.faa)
        setAlertsData(snap.data.nws)
        setLastFetch(new Date(snap.data.refreshed_at))
      } catch {
        setLastFetch(new Date())
      }
    } finally {
      setFetching(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [fetchAll])

  const programs = useMemo(() =>
    [...(faaData?.programs ?? [])].sort(
      (a, b) => (FAA_TYPE_ORDER[a.type] ?? 9) - (FAA_TYPE_ORDER[b.type] ?? 9)
    ), [faaData])

  const allAlerts    = useMemo(() => alertsData?.alerts ?? [], [alertsData])
  const nimbusAlerts = allAlerts.filter((a) => a.affected_nimbus_airports.length > 0)
  const wxFiltered   = nimbusOnly ? nimbusAlerts : allAlerts
  const highImpactWx = wxFiltered.filter((a) => a.severity === "Severe" || a.severity === "Extreme")
  const otherWx      = wxFiltered.filter((a) => a.severity !== "Severe" && a.severity !== "Extreme")

  const groundStops  = programs.filter((p) => p.type === "ground_stop")
  const gdps         = programs.filter((p) => p.type === "ground_delay_program")
  const depDelays    = programs.filter((p) => p.type === "departure_delay")

  const faaSum = faaData?.us_summary
  const nwsSum = alertsData?.us_summary
  const minutesAgo = lastFetch ? Math.floor((Date.now() - lastFetch.getTime()) / 60_000) : null

  // ── Synthesize "Top Disruptions" from both FAA + NWS ──
  const topDisruptions = useMemo<DisruptionItem[]>(() => {
    const items: DisruptionItem[] = []
    for (const prog of programs) {
      const base = prog.type === "ground_stop" ? 100 : prog.type === "ground_delay_program" ? 70 : 40
      items.push({
        id: `faa-${prog.airport_iata}-${prog.type}`,
        typeLabel: prog.type === "ground_stop" ? "Ground Stop" : prog.type === "ground_delay_program" ? "GDP" : "Dep Delay",
        typeSeverity: prog.type === "ground_stop" ? "critical" : prog.type === "ground_delay_program" ? "high" : "moderate",
        title: `${prog.airport_iata} — ${prog.type === "ground_stop" ? "Ground Stop" : prog.type === "ground_delay_program" ? "Ground Delay Program" : "Departure Delay Program"}`,
        detail: [prog.reason, prog.avg_delay_minutes ? `avg ${prog.avg_delay_minutes}m delay` : ""].filter(Boolean).join(" · "),
        airports: [prog.airport_iata],
        isNimbus: prog.in_nimbus_network,
        score: base + (prog.in_nimbus_network ? 50 : 0),
        simEvent: prog.in_nimbus_network ? prog.sim_event : undefined,
      })
    }
    for (const alert of allAlerts) {
      if (alert.severity !== "Severe" && alert.severity !== "Extreme") continue
      const base = alert.severity === "Extreme" ? 90 : 60
      const isNimbus = alert.affected_nimbus_airports.length > 0
      items.push({
        id: `nws-${alert.id}`,
        typeLabel: alert.severity,
        typeSeverity: alert.severity === "Extreme" ? "critical" : "high",
        title: alert.event,
        detail: alert.area.split(",").slice(0, 2).join(",").trim(),
        airports: alert.affected_nimbus_airports,
        isNimbus,
        score: base + (isNimbus ? 50 : 0),
        simEvent: isNimbus && alert.sim_event ? alert.sim_event : undefined,
      })
    }
    return items.sort((a, b) => b.score - a.score).slice(0, 7)
  }, [programs, allAlerts])

  const nimbusHit = topDisruptions.filter((d) => d.isNimbus).length

  return (
    <div className="space-y-4 pb-2">

      {/* ── Status strip ── */}
      <div
        className="border p-3.5"
        style={{ borderRadius: r.md, borderColor: c.hairline, background: c.surfaceSoft }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 flex items-center justify-center shrink-0"
              style={{ borderRadius: r.sm, background: c.canvas, border: `1px solid ${c.hairline}` }}
            >
              <Globe className="w-3.5 h-3.5" style={{ color: c.ink }} />
            </div>
            <div>
              <div className="text-xs font-bold text-foreground">US National Airspace</div>
              <div className="text-[11px] text-muted-foreground">
                {minutesAgo === null ? "Fetching…" : minutesAgo === 0 ? "Live" : `${minutesAgo}m ago`}
                {nimbusHit > 0 && (
                  <span className="ml-1.5 font-semibold" style={{ color: "var(--ae-amber-ink)" }}>· {nimbusHit} Nimbus impact{nimbusHit !== 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={fetchAll}
            disabled={fetching}
            className="flex items-center gap-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
            style={{ color: c.ink, background: "transparent", border: "none", cursor: "pointer" }}
          >
            <RefreshCw className={`w-3 h-3 ${fetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { dot: "var(--ae-rust)",  val: faaSum?.concurrent_ground_stops ?? "—",  label: "GS" },
            { dot: "var(--ae-amber)", val: faaSum?.concurrent_gdps ?? "—",          label: "GDP" },
            { dot: "var(--ae-amber-soft)", val: nwsSum?.severe_or_extreme ?? "—",   label: "Sev / Ext" },
            { dot: "var(--ae-teal)",  val: faaSum?.nimbus_network_overlap ?? "—",   label: "Nimbus hit" },
          ].map(({ dot, val, label }) => (
            <div
              key={label}
              className="rounded-lg px-2 py-2 text-center"
              style={{ background: "var(--ae-surface)", border: "1px solid var(--ae-line)" }}
            >
              <div className="flex items-center justify-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
                <span className="text-base font-semibold font-mono leading-none text-foreground tabular-nums">{val}</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-tight">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Loading state ── */}
      {fetching && !faaData && !alertsData && (
        <div className="py-8 text-center text-xs text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" style={{ color: c.ink }} />
          Fetching live national airspace data…
        </div>
      )}

      {/* ── Nimbus only toggle ── */}
      <div className="flex items-center justify-between -mt-1">
        <span className="text-[11px] text-muted-foreground">Showing all US events</span>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={nimbusOnly}
            onChange={(e) => setNimbusOnly(e.target.checked)}
          />
          Nimbus network only
        </label>
      </div>

      {/* ── Top Active Disruptions ── */}
      {topDisruptions.length > 0 && (
        <SectionToggle
          label="Top Active Disruptions"
          badge={
            <span
              className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: "var(--ae-rust-bg)", color: "var(--ae-rust-ink)" }}
            >
              {topDisruptions.length}
            </span>
          }
          defaultOpen
        >
          <div className="space-y-1.5 mb-1">
            {topDisruptions.map((d) => (
              <div
                key={d.id}
                className="rounded-lg p-2.5 flex items-start gap-2.5"
                style={{
                  background: "var(--ae-surface)",
                  border: "1px solid var(--ae-line)",
                  borderLeft: d.isNimbus ? "2px solid var(--ae-teal)" : "1px solid var(--ae-line)",
                }}
              >
                {/* Severity dot */}
                <div className="mt-0.5 shrink-0">
                  <span className="block w-2 h-2 rounded-full" style={{ background: SEV[d.typeSeverity].dot }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-foreground truncate">{d.title}</span>
                    <SevChip level={d.typeSeverity} label={d.typeLabel} />
                    {d.isNimbus && (
                      <span className="text-[11px] font-semibold shrink-0" style={{ color: "var(--ae-teal-ink)" }}>Nimbus</span>
                    )}
                  </div>
                  {d.detail && (
                    <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{d.detail}</div>
                  )}
                  {d.airports.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {d.airports.slice(0, 4).map((ap) => (
                        <span
                          key={ap}
                          className="text-[11px] font-mono px-1.5 py-0.5 rounded-md"
                          style={{ background: "var(--ae-surface-2)", border: "1px solid var(--ae-line)", color: "var(--ae-text-2)" }}
                        >
                          {ap.replace(/^K/, "")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {d.simEvent && (
                  <SimButton
                    disabled={isLoadingEvent}
                    onClick={() => onLoadToSim(d.simEvent!.kind, d.simEvent!.params)}
                  />
                )}
              </div>
            ))}
          </div>
        </SectionToggle>
      )}

      {/* ── FAA Ground Programs ── */}
      <SectionToggle
        label="FAA Ground Programs"
        badge={programs.length > 0 && (
          <span
            className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: "var(--ae-rust-bg)", color: "var(--ae-rust-ink)" }}
          >
            {programs.length} active
          </span>
        )}
        defaultOpen={false}
      >
        {faaData?.error && (
          <div
            className="rounded-lg px-3 py-2.5 text-xs mb-2"
            style={{ background: "var(--ae-amber-bg)", color: "var(--ae-amber-ink)", border: "1px solid var(--ae-line)" }}
          >
            FAA status temporarily unavailable. See nasstatus.faa.gov.
          </div>
        )}
        {!fetching && !faaData?.error && programs.length === 0 && faaData && (
          <div className="rounded-lg border border-border bg-secondary/40 px-3 py-3 text-center text-xs text-muted-foreground mb-2">
            No active FAA programs — NAS operating normally.
          </div>
        )}

        {/* Ground Stops — highest priority */}
        {groundStops.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: "var(--ae-rust-ink)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--ae-rust)" }} />
              Ground Stops ({groundStops.length})
            </div>
            <div className="space-y-1.5">
              {groundStops.map((prog, i) => (
                <div
                  key={`gs-${i}`}
                  className="rounded-lg p-2.5"
                  style={{
                    background: "var(--ae-surface)",
                    border: "1px solid var(--ae-line)",
                    borderLeft: prog.in_nimbus_network ? "2px solid var(--ae-rust)" : "1px solid var(--ae-line)",
                  }}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-semibold text-sm text-foreground">{prog.airport_iata}</span>
                        {prog.in_nimbus_network && <span className="text-[11px] font-semibold" style={{ color: "var(--ae-teal-ink)" }}>Nimbus</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {prog.reason}{prog.avg_delay_minutes ? ` · avg ${prog.avg_delay_minutes}m` : ""}
                      </div>
                      {prog.recheck && <div className="text-[11px] text-muted-foreground/60 mt-0.5">Recheck: {prog.recheck}</div>}
                    </div>
                    {prog.in_nimbus_network && (
                      <SimButton disabled={isLoadingEvent} onClick={() => onLoadToSim(prog.sim_event.kind, prog.sim_event.params)} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* GDPs */}
        {gdps.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: "var(--ae-amber-ink)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--ae-amber)" }} />
              Ground Delay Programs ({gdps.length})
            </div>
            <div className="space-y-1.5">
              {gdps.map((prog, i) => (
                <div
                  key={`gdp-${i}`}
                  className="rounded-lg p-2.5"
                  style={{
                    background: "var(--ae-surface)",
                    border: "1px solid var(--ae-line)",
                    borderLeft: prog.in_nimbus_network ? "2px solid var(--ae-amber)" : "1px solid var(--ae-line)",
                  }}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-semibold text-sm">{prog.airport_iata}</span>
                        {prog.avg_delay_minutes && (
                          <span
                            className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: "var(--ae-amber-bg)", color: "var(--ae-amber-ink)" }}
                          >
                            avg {prog.avg_delay_minutes}m
                          </span>
                        )}
                        {prog.in_nimbus_network && <span className="text-[11px] font-semibold" style={{ color: "var(--ae-teal-ink)" }}>Nimbus</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{prog.reason}</div>
                      {(prog.start || prog.recheck) && (
                        <div className="text-[11px] text-muted-foreground/60 mt-0.5">
                          {prog.start && `Start: ${prog.start}`}{prog.recheck && ` · Recheck: ${prog.recheck}`}
                        </div>
                      )}
                    </div>
                    {prog.in_nimbus_network && (
                      <SimButton disabled={isLoadingEvent} onClick={() => onLoadToSim(prog.sim_event.kind, prog.sim_event.params)} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Departure Delays */}
        {depDelays.length > 0 && (
          <div className="mb-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: "var(--ae-amber-ink)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--ae-amber-soft)" }} />
              Departure Delays ({depDelays.length})
            </div>
            <div className="space-y-1.5">
              {depDelays.map((prog, i) => (
                <div
                  key={`dep-${i}`}
                  className="rounded-lg p-2.5"
                  style={{ background: "var(--ae-surface)", border: "1px solid var(--ae-line)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-sm">{prog.airport_iata}</span>
                    {prog.avg_delay_minutes && <span className="text-[11px] text-muted-foreground">avg {prog.avg_delay_minutes}m</span>}
                    <span className="text-[11px] text-muted-foreground flex-1 truncate">{prog.reason}</span>
                    {prog.in_nimbus_network && (
                      <SimButton disabled={isLoadingEvent} onClick={() => onLoadToSim(prog.sim_event.kind, prog.sim_event.params)} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionToggle>

      {/* ── NWS Weather Alerts ── */}
      <SectionToggle
        label="NWS Weather Alerts"
        badge={nimbusAlerts.length > 0 && (
          <span
            className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: "var(--ae-teal-bg)", color: "var(--ae-teal-ink)" }}
          >
            {nimbusAlerts.length} Nimbus
          </span>
        )}
        defaultOpen={false}
      >
        {alertsData?.error && (
          <div
            className="rounded-lg px-3 py-2.5 text-xs mb-2"
            style={{ background: "var(--ae-amber-bg)", color: "var(--ae-amber-ink)", border: "1px solid var(--ae-line)" }}
          >
            NWS alerts temporarily unavailable.
          </div>
        )}
        {!fetching && !alertsData?.error && wxFiltered.length === 0 && alertsData && (
          <div className="rounded-lg border border-border bg-secondary/40 px-3 py-3 text-center text-xs text-muted-foreground mb-2">
            {nimbusOnly ? "No alerts overlap Nimbus airports." : "No active aviation-relevant NWS alerts."}
          </div>
        )}
        {nwsSum != null && (
          <p className="text-[11px] text-muted-foreground mb-2">
            {wxFiltered.length} of {nwsSum.nationwide_alerts_matched} aviation alerts · {nwsSum.severe_or_extreme} severe/extreme
          </p>
        )}
        {wxFiltered.length > 0 && (
          <div className="space-y-3 max-h-[min(55vh,28rem)] overflow-y-auto pr-0.5">
            {highImpactWx.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--ae-amber-ink)" }}>Severe &amp; extreme</div>
                <div className="space-y-1.5">
                  {highImpactWx.map((alert) =>
                    renderAlertRow(alert, alert.affected_nimbus_airports.length > 0, isLoadingEvent, onLoadToSim)
                  )}
                </div>
              </div>
            )}
            {otherWx.length > 0 && (
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Advisories &amp; moderate</div>
                <div className="space-y-1.5">
                  {otherWx.map((alert) =>
                    renderAlertRow(alert, alert.affected_nimbus_airports.length > 0, isLoadingEvent, onLoadToSim)
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </SectionToggle>
    </div>
  )
}

// ─── Main EventPanel ──────────────────────────────────────────────────────────

export function EventPanel() {
  const [selectedKind, setSelectedKind]       = useState<EventKind>("weather_closure")
  const [values, setValues]                   = useState<Record<string, string>>(FORM_SCHEMA.weather_closure.defaults)
  const [isLoading, setIsLoading]             = useState(false)
  const [showDescription, setShowDescription] = useState(false)
  const [formOpen, setFormOpen]               = useState(false)
  const [tab, setTab]                         = useState<"trigger" | "live" | "active">("trigger")
  const { activeEvents, setUpdate }           = useSimulationStore()

  // Clicking a tile opens the config sheet pinned to the bottom of the
  // panel — right where the cursor already is, without burying the grid.
  const selectKind = (kind: EventKind) => {
    setSelectedKind(kind)
    setValues(FORM_SCHEMA[kind].defaults)
    setShowDescription(false)
    setFormOpen(true)
  }

  const setField = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }))

  const cancelEvent = async (id: string) => {
    if (isLoading) return
    setIsLoading(true)
    try {
      await apiClient.del(`/events/${encodeURIComponent(id)}`)
      const response = await apiClient.get<Record<string, unknown>>("/simulator/state")
      setUpdate(response.data)
      toast.success("Event cancelled", { description: "Simulation impacts and recovery plans updated." })
    } catch (error) { toast.error("Could not cancel event", { description: error instanceof Error ? error.message : "Retry after reconnecting." }) }
    finally { setIsLoading(false) }
  }

  const triggerEvent = async (kind: string, params: Record<string, any>) => {
    setIsLoading(true)
    try {
      const r = await apiClient.post<{
        cascade_summary?: {
          total_affected: number
          directly_affected: number
          cascade_1?: number
          cascade_2?: number
        }
        [key: string]: unknown
      }>("/simulator/trigger", { kind, params: eventParams(kind,params) })
      const info = EVENT_TYPES.find((e) => e.value === kind)
      const cs = r.data?.cascade_summary
      toast.success(`${info?.label ?? kind} triggered`, {
        description: cs
          ? `${cs.total_affected} flights affected · ${cs.directly_affected} direct, ${(cs.cascade_1 ?? 0) + (cs.cascade_2 ?? 0)} cascade`
          : "Recovery plans ready.",
      })
      setUpdate(r.data)
    } catch (err: any) {
      toast.error("Failed to trigger event", { description: err?.message || "Check API connection" })
    } finally {
      setIsLoading(false)
    }
  }

  const handleTrigger = async () => {
    const params: Record<string, any> = {}
    for (const f of FORM_SCHEMA[selectedKind].fields) {
      const raw = values[f.key]
      params[f.key] = f.type === "number" ? Number(raw) : raw
    }
    await triggerEvent(selectedKind, params)
    setFormOpen(false)
  }

  const selectedInfo = EVENT_TYPES.find((e) => e.value === selectedKind)!
  const tone         = toneFor(selectedKind)
  const schema       = FORM_SCHEMA[selectedKind]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* No "Event Control" panel header any more.
          The context column already names this panel in its tab, so the header
          was a second title for the same thing — 56px of vertical space, above
          a tab bar, above a list, inside a column that is itself inside a
          tabbed shell. Its one piece of real content (the type count and feed
          source) survives as a caption under the tab bar. */}
      <div className="flex-1 flex flex-col min-h-0">

        {/* Sub-tabs, in the mosaic's tab grammar rather than a filled pill.
            The pill was a plum-filled capsule with a coloured drop shadow —
            the loudest object in the column, spending a saturated fill and a
            glow on "which of three lists am I looking at". Here the active
            tab is the white module face rising out of the well, marked by the
            spectral band, exactly like the column's own tabs one level up. */}
        <div
          role="tablist"
          aria-label="Event sections"
          className="shrink-0"
          style={{ display: "flex", borderBottom: `1px solid ${c.hairline}`, background: "var(--ae-surface-2)" }}
        >
          {([
            { key: "trigger", label: "Trigger" },
            { key: "live", label: "Live feed" },
            { key: "active", label: "Active" },
          ] as const).map((t) => {
            const on = tab === t.key
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className="ae-ctx-tab"
                style={{
                  position: "relative",
                  flex: 1, minWidth: 0,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
                  height: 28, padding: "0 6px",
                  border: "none", borderRight: `1px solid ${c.hairline}`,
                  background: on ? c.canvas : "transparent",
                  boxShadow: "none",
                  borderBottom: on ? `2px solid ${c.ink}` : "2px solid transparent",
                  color: on ? c.ink : c.muted,
                  cursor: "pointer",
                  fontFamily: ff.body, fontSize: 14,
                  fontWeight: on ? 600 : 400,
                  letterSpacing: "normal",
                  transition: "background 140ms ease, color 140ms ease",
                }}
              >
                {t.label}
                {t.key === "active" && activeEvents.length > 0 && (
                  <span
                    style={{
                      fontFamily: ff.mono, fontSize: 9.5, fontWeight: 700, lineHeight: 1,
                      padding: "2px 4px", borderRadius: 2,
                      border: `1px solid ${on ? c.amber : c.hairline}`,
                      color: c.amberInk,
                    }}
                  >
                    {activeEvents.length}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ── Trigger tab ── */}
        {tab === "trigger" && (
        <div className="flex-1 relative min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto ae-scroll-smooth px-3 py-3 space-y-4 mt-0">

          {/* Categorised event LEDGER — full-width runbook rows with a mono
              index instead of icon-chip tiles: bigger touch targets, one
              quiet voice, no 21-icon rainbow. Selected row inverts to ink
              (Airtable editorial pattern). Styles: .ae-event-row in
              globals.css, all 8 states. */}
          {/* ── THE PICKER ────────────────────────────────────────────────
              An inline cmdk palette, not a modal one. The list is already on
              screen in an open panel, so putting it behind a dialog would add
              a keystroke and a layer to reach something the operator can
              currently see. Inline `Command` gives the same thing the dialog
              would — type-to-filter, arrow keys, Enter to pick — without the
              interruption.

              It replaces 22 always-expanded rows across six category
              headings, which is ~900px of scroll in a 360px column to reach
              "Volcanic ash". Typing `vol` is one gesture. The categories
              survive as groups, so someone who does not know what the types
              are called can still browse. */}
          <Command
            className="ae-cmd"
            /* Filter on the label AND the API kind, so both "ground stop" and
               `ground_stop` land — the operator's word and the engine's. */
            filter={(value, search) => {
              const q = search.trim().toLowerCase()
              if (!q) return 1
              return value.toLowerCase().includes(q) ? 1 : 0
            }}
          >
            <CommandInput placeholder="Search disruptions — drone, ground stop, KORD…" />
            <CommandList className="ae-cmd-list">
              <CommandEmpty>
                No disruption type matches that. The engine ships 22; try{" "}
                <strong style={{ color: c.body }}>weather</strong>,{" "}
                <strong style={{ color: c.body }}>crew</strong> or{" "}
                <strong style={{ color: c.body }}>runway</strong>.
              </CommandEmpty>
              {EVENT_CATEGORIES.map((cat) => {
                const catEvents = cat.events.map((v) => EVENT_TYPES.find((e) => e.value === v)!).filter(Boolean)
                return (
                  <CommandGroup key={cat.label} heading={cat.label}>
                    {catEvents.map((et) => (
                      <CommandItem
                        key={et.value}
                        value={`${et.label} ${et.value}`}
                        onSelect={() => selectKind(et.value)}
                        className="ae-cmd-item"
                        data-selected-kind={selectedKind === et.value ? "true" : undefined}
                      >
                        <span className="ae-event-name">{et.label}</span>
                        {/* The one event type whose duration is unknown at
                            trigger time is the only marked row in the list. */}
                        {et.value === "drone_incursion" && (
                          <span className="ae-event-new">New · uncertain</span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
              })}
            </CommandList>
          </Command>

        </div>

        {/* Config sheet — slides up from the panel's bottom edge when a tile
            is clicked. Covers only the lower part of the panel (not the
            screen); scrim click or ✕ dismisses it. */}
        <AnimatePresence>
          {formOpen && (
            <motion.div
              key="ev-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              onClick={() => setFormOpen(false)}
              className="absolute inset-0"
              style={{ background: "rgba(20, 16, 25, 0.16)", zIndex: 5 }}
            />
          )}
          {formOpen && (
            <motion.div
              key="ev-sheet"
              role="dialog"
              aria-label={`Configure ${selectedInfo.label}`}
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 28 }}
              transition={{ duration: 0.18, ease: [0.22, 0.9, 0.28, 1] }}
              className="absolute left-2 right-2 bottom-2 flex flex-col"
              style={{
                zIndex: 6,
                maxHeight: "68%",
                borderRadius: 14,
                border: `1px solid ${tone.border}`,
                background: tone.bg,
                boxShadow: "var(--ae-shadow-overlay)",
                overflow: "hidden",
                fontFamily: ff.body,
              }}
            >
              {/* Event header */}
              <div
                className="flex items-center justify-between gap-2 px-4 py-3 shrink-0"
                style={{ borderBottom: `1px solid ${tone.border}` }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <selectedInfo.Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} style={{ color: tone.ink }} />
                  <div className="text-sm font-semibold leading-tight truncate" style={{ color: tone.ink }}>
                    {selectedInfo.label}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setShowDescription((d) => !d)}
                    className="flex items-center gap-1 text-[11px] font-semibold opacity-60 hover:opacity-100 transition-opacity"
                    style={{ color: tone.ink, background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px" }}
                  >
                    {showDescription ? "Less" : "Info"}
                    <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showDescription ? "rotate-180" : ""}`} />
                  </button>
                  <button
                    onClick={() => setFormOpen(false)}
                    aria-label="Close event configuration"
                    className="w-7 h-7 rounded-full flex items-center justify-center text-base transition-colors hover:bg-secondary"
                    style={{ color: tone.ink, background: "transparent", border: "none", cursor: "pointer" }}
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="px-4 py-3.5 space-y-3 overflow-y-auto ae-scroll-smooth" style={{ minHeight: 0 }}>
                {/* Expandable description */}
                <AnimatePresence>
                  {showDescription && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p
                        className="text-[11px] leading-relaxed pb-3 mb-0.5 opacity-80"
                        style={{ color: tone.ink, borderBottom: `1px solid ${tone.border}` }}
                      >
                        {EVENT_DESCRIPTIONS[selectedKind]}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Form fields */}
                <div className="grid grid-cols-1 gap-3">
                  {/* htmlFor/id pairing: these three fields configure a
                      network-wide disruption and used to announce as bare
                      "combo box" / "spin button" with no name at all. Focus is
                      :focus-visible via .ae-field, not inline onFocus/onBlur —
                      the inline version also fired on mouse click, which is
                      exactly what :focus-visible exists to avoid. */}
                  {schema.fields.map((f) => {
                    const fid = `evt-field-${f.key}`
                    return (
                    <div key={f.key}>
                      <label
                        htmlFor={fid}
                        className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block"
                      >
                        {f.label}
                      </label>
                      {f.type === "select" ? (
                        <select
                          id={fid}
                          value={values[f.key] ?? ""}
                          onChange={(e) => setField(f.key, e.target.value)}
                          className="ae-field w-full text-xs px-3"
                          style={{ background: c.canvas, border: `1px solid ${c.hairline}`, borderRadius: r.sm, color: c.ink, fontFamily: ff.body }}
                        >
                          {f.options?.map((opt) => (
                            <option key={opt} value={opt}>{selectOptionLabel(f.key, opt)}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={fid}
                          type="number"
                          value={values[f.key] ?? ""}
                          onChange={(e) => setField(f.key, e.target.value)}
                          min={f.min} max={f.max} step={f.step}
                          className="ae-field w-full text-xs px-3"
                          style={{ background: c.canvas, border: `1px solid ${c.hairline}`, borderRadius: r.sm, color: c.ink, fontFamily: ff.mono }}
                        />
                      )}
                    </div>
                    )
                  })}
                </div>

                {/* Trigger button — design-system primary CTA */}
                <ButtonPrimary
                  onClick={handleTrigger}
                  disabled={isLoading}
                  className="w-full mt-1"
                  leadingIcon={isLoading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Zap className="w-4 h-4" />}
                >
                  {isLoading ? "Solving…" : `Trigger ${selectedInfo.label}`}
                </ButtonPrimary>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
        )}

        {/* ── Live Feed tab ── */}
        {tab === "live" && (
        <div className="flex-1 overflow-y-auto ae-scroll-smooth px-3 py-3 mt-0">
          <LiveFeed onLoadToSim={triggerEvent} isLoadingEvent={isLoading} />
        </div>
        )}

        {/* ── Active tab ── */}
        {tab === "active" && (
        <div className="flex-1 overflow-y-auto ae-scroll-smooth px-3 py-3 mt-0">
          {activeEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-36 text-center">
              <div
                className="w-12 h-12 flex items-center justify-center mb-3"
                style={{ borderRadius: r.lg, background: c.surfaceSoft, border: `1px solid ${c.hairline}` }}
              >
                <Activity className="w-6 h-6" style={{ color: c.muted }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: c.ink }}>No active events</p>
              <p className="text-xs mt-1" style={{ color: c.muted }}>Trigger an event to see cascade effects.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {activeEvents.map((ev) => {
                const info = EVENT_TYPES.find((e) => e.value === ev.kind)
                const t    = toneFor(ev.kind as EventKind)
                return (
                  <motion.div
                    key={ev.id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3.5"
                    style={{ borderRadius: r.md, border: `1px solid ${t.border}`, background: t.bg, fontFamily: ff.body }}
                  >
                    <div className="flex items-center gap-2.5 mb-1.5">
                      {/* monochrome icon, no colored chip tile */}
                      {info && <info.Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} style={{ color: c.ink }} />}
                      <span className="text-xs font-bold" style={{ color: t.ink }}>{info?.label ?? ev.kind}</span>
                      <button type="button" aria-label={`Cancel ${info?.label ?? ev.kind} event`} aria-busy={isLoading} disabled={isLoading} onClick={()=>void cancelEvent(ev.id)} style={{ marginLeft: "auto", border: `1px solid ${c.hairline}`, color: c.ink, background: "transparent", padding: "8px" }}>Cancel event</button>
                    </div>
                    <div className="text-[11px] text-muted-foreground space-y-0.5">
                      {ev.params?.airport && (
                        <div>
                          Airport: <AirportCode code={ev.params.airport} />
                          {airportLabel(ev.params.airport).city && (
                            <span className="ml-1 text-muted-foreground/80">
                              · {airportLabel(ev.params.airport).city}
                            </span>
                          )}
                        </div>
                      )}
                      {ev.params?.destination_airport && (
                        <div>
                          Dest: <AirportCode code={ev.params.destination_airport} />
                          {airportLabel(ev.params.destination_airport).city && (
                            <span className="ml-1 text-muted-foreground/80">
                              · {airportLabel(ev.params.destination_airport).city}
                            </span>
                          )}
                        </div>
                      )}
                      {ev.params?.aircraft_tail && <div>Tail: <span className="font-mono">{ev.params.aircraft_tail}</span></div>}
                      {ev.params?.base && (
                        <div>
                          Base: <AirportCode code={ev.params.base} />
                          {airportLabel(ev.params.base).city && (
                            <span className="ml-1 text-muted-foreground/80">
                              · {airportLabel(ev.params.base).city}
                            </span>
                          )}
                        </div>
                      )}
                      {ev.params?.facility_id && (
                        <div>
                          ARTCC: <span className="font-mono">{ev.params.facility_id}</span>
                          {ARTCC_NAMES[ev.params.facility_id] && (
                            <span className="ml-1 text-muted-foreground/80">· {ARTCC_NAMES[ev.params.facility_id]}</span>
                          )}
                        </div>
                      )}
                      {ev.params?.duration_hours && <div>Duration: <span className="font-mono">{ev.params.duration_hours}h</span></div>}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
