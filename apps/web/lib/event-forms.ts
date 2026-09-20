import { NIMBUS_AIRPORTS } from "@/components/simulator/airports"
const AIRPORTS = ["KORD","KATL","KDFW","KLAX","KDEN","KJFK","KSEA","KMIA","KPHX","KLAS","KBOS","KSFO","KIAH","KDTW","KMSP"]
const AIRCRAFT  = Array.from({ length: 40 }, (_, i) => `N${String(i + 1).padStart(3, "0")}NB`)

export type EventKind = "drone_incursion" | "weather_closure" | "thunderstorm" | "blizzard" | "sandstorm" | "dense_fog" | "wind_shear" | "hurricane" | "volcanic_ash" | "ground_stop" | "airspace_closure" | "atc_staffing" | "mechanical_aog" | "bird_strike" | "deicing_shortage" | "runway_closure" | "fuel_contamination" | "crew_sickout" | "labor_action" | "security_event" | "airport_emergency" | "cyber_incident"

export const EVENT_CATEGORIES: { label: string; events: EventKind[] }[] = [
  { label: "Uncrewed Aircraft", events: ["drone_incursion"] },
  { label: "Weather", events: ["weather_closure","thunderstorm","blizzard","sandstorm","dense_fog","wind_shear","hurricane","volcanic_ash"] },
  { label: "Air Traffic Control", events: ["ground_stop","airspace_closure","atc_staffing"] },
  { label: "Aircraft & Operations", events: ["mechanical_aog","bird_strike","deicing_shortage","runway_closure","fuel_contamination"] },
  { label: "Crew & Personnel", events: ["crew_sickout","labor_action"] },
  { label: "Security & Emergency", events: ["security_event","airport_emergency","cyber_incident"] },
]

export const FORM_SCHEMA: Record<EventKind, {
  fields: { key: string; label: string; type: "select" | "number"; options?: string[]; min?: number; max?: number; step?: number }[]
  defaults: Record<string, string>
}> = {
  // No duration field: that is the point of this event type. The operator sets
  // the SHAPE of the closure-length distribution instead.
  drone_incursion: {
    fields: [
      { key: "airport",        label: "Airport",            type: "select", options: AIRPORTS },
      { key: "detection",      label: "Detection",          type: "select", options: ["radar","pilot_report"] },
      { key: "median_minutes", label: "Median closure (min)", type: "number", min: 5,  max: 240,  step: 5 },
      { key: "p95_minutes",    label: "p95 closure (min)",  type: "number", min: 15, max: 1440, step: 15 },
    ],
    defaults: { airport: "KDEN", detection: "radar", median_minutes: "45", p95_minutes: "180" },
  },
  weather_closure: {
    fields: [
      { key: "airport",        label: "Airport",        type: "select", options: AIRPORTS },
      { key: "severity",       label: "Severity",       type: "select", options: ["mild","moderate","severe","extreme"] },
      { key: "duration_hours", label: "Duration (hrs)", type: "number", min: 0.5, max: 24, step: 0.5 },
    ],
    defaults: { airport: "KORD", severity: "severe", duration_hours: "4" },
  },
  thunderstorm: {
    fields: [
      { key: "airport",        label: "Airport",        type: "select", options: AIRPORTS },
      { key: "severity",       label: "Severity",       type: "select", options: ["moderate","severe","extreme"] },
      { key: "duration_hours", label: "Duration (hrs)", type: "number", min: 0.5, max: 12, step: 0.5 },
    ],
    defaults: { airport: "KORD", severity: "severe", duration_hours: "3" },
  },
  blizzard: {
    fields: [
      { key: "airport",        label: "Airport",           type: "select", options: AIRPORTS },
      { key: "severity", label: "Modeled severity", type: "select", options: ["mild","moderate","severe","extreme"] },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 1,   max: 24, step: 1 },
    ],
    defaults: { airport: "KORD", severity: "severe", duration_hours: "6" },
  },
  sandstorm: {
    fields: [
      { key: "airport",        label: "Airport",           type: "select", options: AIRPORTS },
      { key: "severity", label: "Modeled severity", type: "select", options: ["mild","moderate","severe","extreme"] },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 1,   max: 12, step: 1 },
    ],
    defaults: { airport: "KPHX", severity: "severe", duration_hours: "4" },
  },
  dense_fog: {
    fields: [
      { key: "airport",        label: "Airport",           type: "select", options: AIRPORTS },
      { key: "severity", label: "Modeled severity", type: "select", options: ["mild","moderate","severe","extreme"] },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 1,   max: 12, step: 1 },
    ],
    defaults: { airport: "KSFO", severity: "severe", duration_hours: "4" },
  },
  wind_shear: {
    fields: [
      { key: "airport",        label: "Airport",           type: "select", options: AIRPORTS },
      { key: "severity", label: "Modeled severity", type: "select", options: ["mild","moderate","severe","extreme"] },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 0.5, max: 6,  step: 0.5 },
    ],
    defaults: { airport: "KDFW", severity: "severe", duration_hours: "2" },
  },
  hurricane: {
    fields: [
      { key: "airport",        label: "Affected airport",  type: "select", options: AIRPORTS },
      { key: "category",       label: "Category",          type: "select", options: ["1","2","3","4","5"] },
      { key: "duration_hours", label: "Disruption (hrs)",  type: "number", min: 12, max: 96, step: 6 },
    ],
    defaults: { airport: "KMIA", category: "3", duration_hours: "48" },
  },
  volcanic_ash: {
    fields: [
      { key: "duration_hours",      label: "Duration (hrs)",    type: "number", min: 6,   max: 72,  step: 1  },
    ],
    defaults: { duration_hours: "18" },
  },
  ground_stop: {
    fields: [
      { key: "destination_airport", label: "Destination airport", type: "select", options: AIRPORTS },
      { key: "duration_hours",      label: "Duration (hrs)",      type: "number", min: 0.5, max: 12, step: 0.5 },
    ],
    defaults: { destination_airport: "KATL", duration_hours: "2" },
  },
  airspace_closure: {
    fields: [
      { key: "airport",        label: "Anchor airport",    type: "select", options: AIRPORTS },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 1, max: 48, step: 1 },
    ],
    defaults: { airport: "KDEN", duration_hours: "6" },
  },
  atc_staffing: {
    fields: [
      { key: "facility_id",    label: "ARTCC facility",    type: "select", options: ["ZAU","ZTL","ZFW","ZLA","ZDV","ZNY","ZSE","ZMA","ZAB","ZMP"] },
      { key: "staffing_pct",   label: "Staffing %",        type: "number", min: 30, max: 95, step: 5 },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 1,  max: 12, step: 1 },
    ],
    defaults: { facility_id: "ZAU", staffing_pct: "60", duration_hours: "6" },
  },
  mechanical_aog: {
    fields: [
      { key: "aircraft_tail",  label: "Aircraft tail",     type: "select", options: AIRCRAFT },
      { key: "airport",        label: "Current airport",   type: "select", options: AIRPORTS },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 1, max: 48, step: 1 },
    ],
    defaults: { aircraft_tail: "N001NB", airport: "KATL", duration_hours: "8" },
  },
  bird_strike: {
    fields: [
      { key: "aircraft_tail",  label: "Aircraft tail",     type: "select", options: AIRCRAFT },
      { key: "airport",        label: "Incident airport",  type: "select", options: AIRPORTS },
      { key: "duration_hours", label: "Inspection (hrs)",  type: "number", min: 2, max: 48, step: 1 },
    ],
    defaults: { aircraft_tail: "N005NB", airport: "KJFK", duration_hours: "8" },
  },
  deicing_shortage: {
    fields: [
      { key: "airport",        label: "Airport",           type: "select", options: AIRPORTS },
      { key: "severity", label: "Modeled severity", type: "select", options: ["mild","moderate","severe","extreme"] },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 1,  max: 8,  step: 0.5 },
    ],
    defaults: { airport: "KORD", severity: "moderate", duration_hours: "3" },
  },
  runway_closure: {
    fields: [
      { key: "airport",          label: "Airport",           type: "select", options: AIRPORTS },
      { key: "capacity_cut_pct", label: "Capacity cut (%)",  type: "number", min: 10, max: 100, step: 5 },
      { key: "duration_hours",   label: "Duration (hrs)",    type: "number", min: 0.5, max: 24, step: 0.5 },
    ],
    defaults: { airport: "KDFW", capacity_cut_pct: "45", duration_hours: "6" },
  },
  fuel_contamination: {
    fields: [
      { key: "airport",        label: "Airport",           type: "select", options: AIRPORTS },
      { key: "severity",       label: "Severity",          type: "select", options: ["partial","critical"] },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 1, max: 24, step: 1 },
    ],
    defaults: { airport: "KATL", severity: "critical", duration_hours: "6" },
  },
  crew_sickout: {
    fields: [
      { key: "base",             label: "Crew base",         type: "select", options: AIRPORTS },
      { key: "percent_affected", label: "% affected",        type: "number", min: 5,  max: 100, step: 5 },
      { key: "duration_hours",   label: "Duration (hrs)",    type: "number", min: 1,  max: 48,  step: 1 },
    ],
    defaults: { base: "KORD", percent_affected: "30", duration_hours: "8" },
  },
  labor_action: {
    fields: [
      { key: "base",           label: "Crew base",           type: "select", options: AIRPORTS },
      { key: "percent_affected",   label: "Crew affected (%)",          type: "number", min: 10, max: 80, step: 5 },
      { key: "duration_hours", label: "Duration (hrs)",      type: "number", min: 2,  max: 48, step: 1 },
    ],
    defaults: { base: "KORD", percent_affected: "40", duration_hours: "12" },
  },
  security_event: {
    fields: [
      { key: "airport",        label: "Airport",           type: "select", options: AIRPORTS },
      { key: "severity",       label: "Severity",          type: "select", options: ["moderate","severe","extreme"] },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 0.5, max: 12, step: 0.5 },
    ],
    defaults: { airport: "KJFK", severity: "severe", duration_hours: "3" },
  },
  airport_emergency: {
    fields: [
      { key: "airport",        label: "Airport",           type: "select", options: AIRPORTS },
      { key: "severity",       label: "Severity",          type: "select", options: ["moderate","severe","extreme"] },
      { key: "duration_hours", label: "Duration (hrs)",    type: "number", min: 0.5, max: 12, step: 0.5 },
    ],
    defaults: { airport: "KLAX", severity: "severe", duration_hours: "2" },
  },
  cyber_incident: {
    fields: [
      { key: "degradation_pct", label: "Degradation %",   type: "number", min: 20, max: 100, step: 5 },
      { key: "duration_hours",  label: "Duration (hrs)",  type: "number", min: 1,  max: 24,  step: 1 },
    ],
    defaults: { degradation_pct: "60", duration_hours: "12" },
  },
}


/** Send the same duration and location to both cascade and constraint models. */
export function eventParams(kind:string, values:Record<string,unknown>):Record<string,unknown> {
  const params={...values}
  const hours=Number(params.duration_hours)
  if(Number.isFinite(hours) && hours>0) {
    params.start="T+0h"
    params.end=`T+${hours}h`
    if(kind==="cyber_incident") params.system_restored_at=params.end
  }
  if(kind==="airspace_closure" && typeof params.airport==="string") {
    const airport=NIMBUS_AIRPORTS[params.airport]
    if(airport) { params.center_lat=airport.lat;params.center_lon=airport.lon;params.airports=[params.airport] }
  }
  return params
}
