"use client"
import "leaflet/dist/leaflet.css"
import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react"
import {
  MapContainer, TileLayer, Marker, Polyline, Circle, Pane,
  Tooltip, ZoomControl, useMap, useMapEvents,
} from "react-leaflet"
import L from "leaflet"
import { AircraftDetail } from "./aircraft-detail"
import {
  useSimulationStore,
  type ScheduledFlight,
  type LiveFlight,
  type ActiveEvent,
  type CascadeSummary,
  type RecoveryPlan,
  type FlightState,
} from "@/stores/simulation"
import { NIMBUS_AIRPORTS, airportTier, hydrateAirportTiers, type AirportTier } from "./airports"
import { apiClient } from "@/lib/api"
import {
  CloudLightning as CloudLightningIcon, OctagonAlert as OctagonAlertIcon,
  Ban as BanIcon, ShieldAlert as ShieldAlertIcon, Wrench as WrenchIcon,
  HeartPulse as HeartPulseIcon, AlertTriangle as AlertTriangleIcon,
  Radio as RadioIcon, Mountain as MountainIcon, ServerCrash as ServerCrashIcon,
} from "lucide-react"
import { cascade, cascadeLight } from "@/lib/design-tokens"
import {
  deadReckon, bearing, distanceNm, cardinal, machFor,
  deriveLive, interp, isoToHour, arcPoints,
} from "@/lib/flight-derive"
import { observeFlight, trackPosition, observedTrail, type FlightTrack } from "@/lib/flight-track"
import { useConsoleTheme } from "@/lib/use-theme"
import { GlobeView, type GlobeFlight } from "./globe-view"

// ── Map colors — the five-pigment vocabulary as LITERAL hex.
//    The map runs Leaflet's canvas renderer (preferCanvas), which resolves
//    colors in JS — CSS variables can't reach it, so these are the same
//    pigments as globals.css, inlined.
//
//    "Keep them in sync by hand" is what this comment used to say, and the
//    cascade steps promptly drifted a full severity order away from the
//    timeline. Anything carrying SHARED MEANING is now imported from
//    design-tokens instead; only map-only pigments are declared here.
//
//    teal  = recovery / reroute / brand    amber = the ONE status color
//    gray  = cancelled / nominal / live    (severity = amber opacity steps)
const MAP_DARK = {
  // Plan-applied actions. GREY = "no longer operating" (always paired with
  // the ✕ badge + dashed stroke — never color-alone), TEAL = "re-routed /
  // re-assigned", AMBER = "operating late".
  // LIGHT REGISTER: the map runs on Carto voyager tiles; darker = stronger.
  // #6B7670, not #98A29B: the disc carries a white ✕ at 10px, which measured
  // 2.63:1 against the old value. Still a neutral gray — cancelled is never a
  // hue — just dark enough that the glyph on it is legible (4.72:1).
  // A cancelled flight is a PALE GHOST, not a solid mid-grey disc. Two reasons.
  // Semantically, "no longer operating" should recede, not hold the same weight
  // as a flight in the air. Practically, the old #6B7670 sat at almost exactly
  // the operating blue's luminance (1.14:1) — separable by hue but identical in
  // lightness, so on a poor monitor or to a monochromatic viewer the map's most
  // consequential distinction collapsed. Pale disc + DARK glyph reads as struck
  // out and separates from operating by 3.33:1.
  // DARK REGISTER, 2026-08-16. Every value below was re-inked for the
  // `dark_all` basemap. The old set was tuned against near-white Positron:
  // #0B4F47 hubs measured 1.31:1 on a #16181D tile, i.e. the operator's own
  // network would have been the least visible thing on the map.
  //
  // Cancelled stays a GHOST and stays hueless — the semantics are unchanged,
  // only the direction of "pale" is. On paper a ghost was lighter than the
  // surface; on the console floor it is a dim slate disc with a bright dashed
  // edge and a bright ✕, so it still recedes while its glyph stays legible.
  planCancelled: "#39404E",
  planCancelledGlyph: "#D5DAE6",
  planCancelledInk: "#9AA2B4",
  planSwap:      "#2FE3A0",
  planSwapFlow:  "#2FE3A0",
  planDelayed:   "#D9A441",

  // Cascade severity — imported, never redeclared. These three used to be
  // local literals that disagreed with the timeline legend by one whole
  // cascade order. See `cascade` in lib/design-tokens.ts.
  cascadeDirect: cascade.direct.fill,
  cascadeOrder1: cascade.order1.fill,
  cascadeOrder2: cascade.order2.fill,

  // ── OPERATING = BLUE. GREY IS RESERVED FOR CANCELLED. ─────────────────
  // A flight in the air on its trajectory is blue; a flight that is no longer
  // operating is grey. Previously BOTH were grey-green (#6E7B74 owned,
  // #A9B3AC ambient) and grey therefore meant three different things —
  // nominal, ambient and cancelled — so "not flying" carried no colour of its
  // own. Hue 204: 52 degrees off plum (recovery/swap), 31 off the airport
  // teals, 168 off the amber cascade ramp, so it cannot be mistaken for any
  // of them. Re-inked UP for the dark basemap: 6.62:1 on tile, and it stays
  // LIGHTER than cascade-direct so a nominal flight still cannot out-weigh a
  // disrupted one (the ordering design.md requires, asserted in the gate).
  unaffected:    "#4FA3E3",

  // Ambient ADS-B — other carriers. Same blue family so grey stays free, and
  // still the quietest mark on the map: ~650 of these must not out-mass the
  // operator's own 15 airports.
  //
  // The complaint that these were invisible was about SIZE, not this value.
  // Measured, the old #3D6B8C sits at 2.96:1 on the filtered tile — quiet but
  // present; what made it unreadable was rendering a swept-wing silhouette at
  // 13px, where the wing is ~2px. The fix was the size bump in `liveIcon`.
  //
  // A first pass overshot to #5C90BC anyway and the gate caught it: at that
  // value ambient traffic came within 1.06:1 of the SPOKE AIRPORT tier, i.e.
  // other carriers' aircraft were about to out-mass the operator's own network
  // — the precise bug (hidden spokes) the spoke-vs-ambient assertion exists to
  // prevent, reintroduced while trying to fix visibility. #3F6E93 clears 3:1
  // on the tile and stays 1.69:1 clear of spoke.
  live:          "#3F6E93",
  liveSelected:  "#2FE3A0",

  // Airport tiers — mirrors the API's hub / focus_city / spoke classification
  // rather than a hand-maintained binary. All three clear 3:1 on the basemap
  // AND 3:1 against ambient traffic, so every owned airport reads as owned.
  airportHub:    "#5EE0C6",
  airportFocus:  "#33B49B",
  airportSpoke:  "#34A08C",
  groundStop:    "#E08A3C",
  gdp:           "#D9A441",
  depDelay:      "#D9A441",
  eventEpicenter: "#FF7A1A",
  weather:       "#D9A441",
} as const

/**
 * The same vocabulary for the LIGHT console register (`light_all` basemap).
 *
 * Every value is the dark set's counterpart re-inked DOWN, and the semantics
 * are unchanged: operating is blue, grey belongs to cancelled alone, hue 204
 * stays 52° off plum, cancelled is a ghost with a dark edge and a dark glyph.
 * Only the direction of "louder" flips, because the surface flipped.
 *
 * These are the values the map shipped with before the 2026-08-16 register
 * split, so they carry that pass's contrast work forward rather than being
 * invented — and `check-contrast.mjs` gates BOTH sets against their own
 * basemap so neither can drift.
 */
const MAP_LIGHT = {
  planCancelled: "#C9CCC9",
  planCancelledGlyph: "#333935",
  planCancelledInk: "#5A625D",
  planSwap:      "#17A874",
  planSwapFlow:  "#17A874",
  planDelayed:   "#C2560F",

  cascadeDirect: cascadeLight.direct.fill,
  cascadeOrder1: cascadeLight.order1.fill,
  cascadeOrder2: cascadeLight.order2.fill,

  unaffected:    "#1C6FA8",
  // Darker than the pre-split #8FB0C9 for the same reason the dark set was
  // brightened: at 2.15:1 the ambient tier was quiet past the point of being
  // legible. 3.11:1 keeps it the quietest mark that is still a mark.
  live:          "#4C82F7",
  liveSelected:  "#17A874",

  airportHub:    "#0B4F47",
  airportFocus:  "#2F6D63",
  airportSpoke:  "#3D6B60",
  groundStop:    "#9A6420",
  gdp:           "#C2560F",
  depDelay:      "#C2560F",
  eventEpicenter: "#FF7A1A",
  weather:       "#C2560F",
} as const

/**
 * THE ACTIVE PALETTE — module-level, swapped by the component before render.
 *
 * Leaflet's canvas renderer resolves colours in JS, and the icon factories are
 * module-level pure functions behind a cache, so a CSS variable cannot reach
 * them and threading a `theme` parameter would mean changing eight factories
 * and every one of their ~40 call sites.
 *
 * Module-level mutable state is normally a smell; here it is the right shape.
 * There is exactly one map mounted at a time, the value is a rendering constant
 * for the whole frame, and `setMapTheme` is called during render before any
 * icon is built. The one real hazard is the ICON CACHE — it is keyed by string,
 * so without the theme in the key a light-theme marker would be served from a
 * dark-theme cache entry. `THEME_KEY` is prefixed into every key for exactly
 * that reason; see `icon()`.
 */
let MAP_COLORS: typeof MAP_DARK = MAP_DARK
let THEME_KEY = "d"
/**
 * The hairline that separates a mark from the basemap behind it.
 *
 * It is DARK on the dark chart and LIGHT on the light one — the outline's job
 * is separation, and an outline that matches the surface it is separating from
 * does nothing. Getting this backwards is what made the first dark pass look
 * like a scatter of white o's: a white ring was the brightest thing in the
 * frame, so the eye landed on the outline rather than on the pigment carrying
 * the meaning.
 */
let MARK_EDGE = "rgba(8,9,12,0.78)"
let MARK_EDGE_SOFT = "rgba(11,12,16,0.55)"
/**
 * Whether marks GLOW.
 *
 * Only on the dark chart. A coloured bloom is how a small mark becomes
 * findable against near-black — light emitted by the pigment that carries the
 * meaning. On a near-white chart the same bloom has nothing to be brighter
 * than, so it stops reading as light and starts reading as BLUR: every
 * aircraft gains a soft fringe and the silhouette's edge, which is what
 * carries heading, goes soft. Paper marks separate by being darker than the
 * page, which they already are.
 */
let MARK_GLOW = true

/**
 * The contact shadow under a LIVE ADS-B airframe — register-aware.
 *
 * This was hardcoded `drop-shadow(0 1px 3px rgba(0,0,0,0.65))`, tuned for the
 * dark chart and applied on both. The ambient feed mounts on the order of 500
 * other-carrier contacts, so on the white board that shipped ~500 soft black
 * smudges over a near-white basemap — read, correctly, as a generated-looking
 * haze. It is also the wrong physics: on a light chart a mark is legible
 * because it is DARKER than the ground, so a black bloom around it adds mass
 * without adding information.
 *
 * Light gets a tight, nearly-opaque 1px contact shadow that seats the mark on
 * the chart. Dark keeps the softer one, where the ground genuinely is black.
 */
let CONTACT_SHADOW = "drop-shadow(0 1px 3px rgba(0,0,0,0.65))"

/**
 * Mark size multiplier, per register.
 *
 * Every airframe size on this map was tuned against the near-black chart,
 * where a mark needs MASS to be findable — a 28px direct hit is 28px because
 * at 18px it disappeared into the floor. On the white board the same mark is
 * near-black on near-white, so it already owns the maximum contrast available
 * and the extra mass buys nothing; what it produces instead is a swarm of
 * chunky dark silhouettes covering the routes they are drawn on.
 *
 * The severity ORDERING is untouched — direct still reads largest, ambient
 * still smallest — the whole ramp is just scaled to what a light chart needs.
 */
let MARK_SCALE = 1

/** Sizes are a ramp, so they scale together and round consistently. */
const scaled = (px: number) => Math.round(px * MARK_SCALE)

function setMapTheme(light: boolean) {
  const next = light ? (MAP_LIGHT as unknown as typeof MAP_DARK) : MAP_DARK
  if (next === MAP_COLORS) return
  MAP_COLORS = next
  THEME_KEY = light ? "l" : "d"
  MARK_EDGE = light ? "rgba(255,255,255,0.92)" : "rgba(8,9,12,0.78)"
  MARK_EDGE_SOFT = light ? "rgba(255,255,255,0.75)" : "rgba(11,12,16,0.55)"
  MARK_GLOW = !light
  MARK_SCALE = light ? 0.78 : 1
  CONTACT_SHADOW = light
    ? "drop-shadow(0 1px 1px rgba(20,22,26,0.28))"
    : "drop-shadow(0 1px 3px rgba(0,0,0,0.65))"
  // Cool white, not the landing's cream — the console's light register is a
  // cool board and a warm overlay on it reads as a different material.
  GLASS        = light ? "rgba(255,255,255,0.86)" : "rgba(16,18,24,0.84)"
  GLASS_STRONG = light ? "rgba(255,255,255,0.95)" : "rgba(20,23,30,0.95)"
}

/**
 * Overlay glass — the surface every floating map card sits on.
 *
 * Themed with everything else. These were dark literals, so in light mode the
 * disruption card, the applied-plan HUD and the projection switch rendered as
 * near-black slabs on a near-white chart — the last register leak, and the
 * most visible one because those three overlays sit on top of the map.
 */
let GLASS        = "rgba(20,22,28,0.90)"
let GLASS_STRONG = "rgba(24,27,34,0.96)"

// ── Pure helpers ───────────────────────────────────────────────────────────────
//
// MOVED to lib/flight-derive.ts 2026-08-16. These are pure geometry with no
// Leaflet or DOM dependency, and the flight DETAIL panel needs the same
// arithmetic — but this module is a next/dynamic chunk carrying the whole
// mapping stack, so importing from here would have pulled Leaflet into a
// sidebar panel. Imported rather than re-implemented: two surfaces computing
// one flight's speed independently is precisely the drift design.md records
// for the cascade ramp.

// ── Icon cache ────────────────────────────────────────────────────────────────
const _cache = new Map<string, L.DivIcon>()
function icon(key: string, factory: () => L.DivIcon): L.DivIcon {
  // THEME_KEY is part of the cache key, not decoration. The factories close
  // over the module-level `MAP_COLORS`, so a cache hit from before a theme
  // switch would serve a dark-register marker onto a light basemap — and the
  // cache never expires, so it would do so for the rest of the session.
  const k = THEME_KEY + "|" + key
  if (!_cache.has(k)) _cache.set(k, factory())
  return _cache.get(k)!
}

/** Selected observed contact; a steady blue ring keeps it distinct from recovery jade. */
function liveSelIcon(heading: number | null): L.DivIcon {
  const hdg = Math.round(heading ?? 0)
  return icon(`lvsel|${hdg}`, () => L.divIcon({
    className: "olus-selected-contact", iconSize: [34,34], iconAnchor: [17,17],
    html: `<div style="width:34px;height:34px;border:2px solid var(--neutral-arc);border-radius:50%;background:var(--bone-050);display:grid;place-items:center"><svg viewBox="0 0 64 64" width="26" height="26" style="transform:rotate(${hdg}deg)"><path d="${AIRFRAME_PATH}" fill="var(--neutral-arc)"/></svg></div>`,
  }))
}

/**
 * Top-down airliner silhouette, nose at 12 o'clock, in a 64×64 box.
 *
 * The previous glyph was Material's `flight` icon: a paper-dart wedge with a
 * single straight wing pair and no tailplane. At the 13px these render at, the
 * distinction is not decorative — heading is read off the SHAPE, and a wedge is
 * nearly symmetric front-to-back, so a contact tracking north-east and one
 * tracking south-west looked alike at a glance.
 *
 * This outline has the four features that make an airliner readable at 13px and
 * that resolve that ambiguity: a pointed nose, SWEPT wings whose trailing edge
 * rakes aft, a distinctly smaller swept tailplane, and a notched tail cone. The
 * asymmetry between the wing pair and the tailplane is what tells you which end
 * is the front.
 */
const AIRFRAME_PATH =
  "M32 2c1.6 0 2.8 2.2 3.3 5.6l1.1 16.9 21.6 15v4.7l-21.4-6.6.3 14.9 7.1 4.9v3.2L32 57.8 20 60.6v-3.2l7.1-4.9.3-14.9L6 44.2v-4.7l21.6-15 1.1-16.9C29.2 4.2 30.4 2 32 2z"
/** Engine nacelles — two short strokes on the wing roots, drawn only when big enough to read. */
const NACELLES =
  '<path d="M22.5 33.5h5.5M36 33.5h5.5" stroke-linecap="round" stroke-width="3.2" />'

function airframeSvg(size: number, fill: string, stroke: string, strokeWidth: number): string {
  return (
    `<svg viewBox="0 0 64 64" width="${size}" height="${size}">` +
    `<path d="${AIRFRAME_PATH}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>` +
    // Below ~18px the nacelle strokes collapse into the wing and just muddy the
    // silhouette, so they are dropped rather than drawn as noise.
    (size >= 18 ? `<g stroke="${fill}" opacity="0.9">${NACELLES}</g>` : "") +
    `</svg>`
  )
}

function liveIcon(heading: number | null, sel: boolean, velKt: number | null): L.DivIcon {
  const hdg = Math.round((heading ?? 0) / 10) * 10
  const slow = (velKt ?? 0) < 50
  const key = `lv|${hdg}|${sel}|${slow}`
  return icon(key, () => {
    // 16px, not 13. The 13 was chosen so ambient traffic would not out-mass the
    // operator's own spoke airports — correct goal, wrong lever. Size was doing
    // a job that COLOUR should do: at 13px a swept-wing silhouette is ~2px of
    // wing, which is not a readable shape, so the map showed hundreds of marks
    // whose direction could not be read at all. Ambient traffic now recedes by
    // being dimmer and thinner-stroked (see `live` above) while staying large
    // enough to read AS an aircraft, which is the whole point of drawing an
    // airframe rather than a dot.
    const sz = scaled(sel ? 32 : 16)
    const fill = sel ? MAP_COLORS.liveSelected : MAP_COLORS.live
    const op = slow ? 0.4 : 0.9
    // Hairline is dark on the dark basemap — a white outline at this size
    // doubles the mark's apparent mass and turns 650 contacts into a haze.
    const stroke = sel ? MARK_EDGE : MARK_EDGE_SOFT
    // The pulse rides in a SEPARATE, un-rotated layer. Nesting it inside the
    // rotated wrapper made the ring inherit the heading transform, so a scale
    // animation on a contact tracking 045° sheared it into an ellipse.
    const pulse = sel
      ? `<span class="ae-plane-pulse" style="--ae-pulse:${fill}"></span>`
      : ""
    return L.divIcon({
      className: "ae-live-contact",
      iconSize: [sz, sz],
      iconAnchor: [sz / 2, sz / 2],
      html:
        `<div class="ae-plane-mark" style="width:${sz}px;height:${sz}px">` +
        pulse +
        `<div style="width:${sz}px;height:${sz}px;transform:rotate(${hdg}deg);transform-origin:center;opacity:${op};filter:${CONTACT_SHADOW}">` +
        airframeSvg(sz, fill, stroke, sel ? 1.6 : 2.2) +
        `</div></div>`,
    })
  })
}

/**
 * Aircraft marker icon. Visual treatment varies by applied-plan action:
 *
 *   isCancelled = true → grey 18px disc + small white ✕ badge, low opacity.
 *                        Stays clickable so the operator can inspect why a
 *                        leg was cut, but recedes visually so live re-routes
 *                        dominate the canvas.
 *   isSwap      = true → green disc with a subtle ring, communicating "this
 *                        aircraft has been re-assigned by the plan".
 *   else                → standard cascade-coloured disc, sized by severity.
 */
function simIcon(
  color: string,
  rot: number,
  sel: boolean,
  cascOrder: number,
  isCancelled: boolean = false,
  isSwap:      boolean = false,
): L.DivIcon {
  const r = Math.round(rot / 10) * 10

  // Cancelled markers are intentionally small + faded so the live-operating
  // network dominates. We still draw them — clickable, tooltipped — but they
  // should never out-shout an active reroute.
  const sz = scaled(isCancelled
    ? (sel ? 24 : 18)
    : (sel ? 34 : cascOrder === 0 ? 28 : cascOrder >= 1 ? 22 : 18))

  // THEME_KEY is part of the cache key by contract — the icon factories close
  // over a module-level palette and the cache never expires, so a key without
  // it serves stale marks for the rest of the session after a register switch.
  // MARK_SCALE varies with the register too, and rides in on the same prefix.
  const key = `sim5|${r}|${color}|${sel}|${cascOrder}|${isCancelled ? "x" : isSwap ? "s" : "_"}`
  return icon(key, () => {
    /**
     * ── RE-DRAWN 2026-08-16 ────────────────────────────────────────────────
     *
     * The previous marker was a coloured DISC with a white plane glyph inside
     * it and a stack of concentric box-shadows around it, e.g.
     *   0 0 0 2px #fff, 0 0 0 4px ${color}CC, 0 4px 10px ${color}55
     * Three rings, one of them pure white, on a near-black chart. That is the
     * "punched-out box that looks like it has layers" in the brief, and the
     * reason is structural rather than a matter of taste: the rings are drawn
     * in a fixed order at fixed widths, so every marker carried the same
     * concentric banding regardless of what it meant, and the white ring
     * out-shone the pigment that carried the meaning.
     *
     * Now the AIRFRAME IS THE MARK. No disc, no rings. The silhouette is the
     * same `AIRFRAME_PATH` the live ADS-B contacts use — one aircraft
     * vocabulary across the map, where before the operator's own fleet were
     * discs and everyone else's were planes — and state is carried by:
     *
     *   colour     what happened to this leg (cascade ramp / plan action)
     *   size       severity (direct hit reads largest)
     *   glow       the mark's own pigment, so brightness and meaning agree
     *   glyph      ✕ struck through a cancelled leg, never colour-alone
     *
     * The glow replaces the ring stack entirely. On a dark chart a small mark
     * needs light to be findable, and light emitted by the mark's own colour
     * is legible at a glance in a way a white outline never was — a white ring
     * says "here is a thing", a plum glow says "here is a re-routed aircraft".
     * No animation: this is a fleet of up to 300, and a pulsing swarm is
     * unreadable as well as expensive.
     */
    const glowAlpha = sel ? "CC" : cascOrder === 0 || isSwap ? "AA" : "66"
    const glowSize = sel ? 16 : cascOrder === 0 || isSwap ? 11 : 6
    const glow = isCancelled || !MARK_GLOW
      // Paper still wants a contact shadow so the mark sits ABOVE the chart
      // rather than being printed into it — just not a coloured bloom.
      ? (isCancelled ? "none" : "drop-shadow(0 1px 2px rgba(28,20,38,0.35))")
      : `drop-shadow(0 0 ${glowSize}px ${color}${glowAlpha}) drop-shadow(0 1px 2px rgba(0,0,0,0.8))`

    // A cancelled leg is a GHOST: dim, desaturated, struck out. It stays
    // clickable so the operator can ask why a leg was cut, but it must never
    // compete with a live re-route for attention.
    const opacity = isCancelled ? 0.72 : 1

    const strike = isCancelled
      ? `<span style="position:absolute;left:50%;top:50%;width:${Math.round(sz * 0.95)}px;height:2px;background:${MAP_COLORS.planCancelledGlyph};transform:translate(-50%,-50%) rotate(-45deg);border-radius:2px;pointer-events:none"></span>`
      : ""

    // Selection is a single hairline ring in the mark's own colour — one ring,
    // not three, and it reads as a target reticle rather than as a sticker.
    const selRing = sel
      ? `<span style="position:absolute;inset:-6px;border-radius:9999px;border:1.5px solid ${color};opacity:0.9;pointer-events:none"></span>`
      : ""

    const box = sz + 12
    return L.divIcon({
      className: "",
      iconSize:  [box, box],
      iconAnchor:[box / 2, box / 2],
      html:
        `<div style="position:relative;width:${box}px;height:${box}px;display:flex;align-items:center;justify-content:center;opacity:${opacity}">` +
        selRing +
        `<div style="transform:rotate(${r}deg);line-height:0;filter:${glow}">` +
        airframeSvg(sz, color, MARK_EDGE, isCancelled ? 2.4 : 1.8) +
        `</div>` +
        strike +
        `</div>`,
    })
  })
}

function apBadge(bg: string, text: string, bottom = false): string {
  const pos = bottom ? "bottom:-9px" : "top:-9px"
  return `<span style="position:absolute;${pos};left:50%;transform:translateX(-50%);background:${bg};color:#fff;font-size:7px;font-weight:800;padding:1px 4px;border-radius:3px;white-space:nowrap;font-family:ui-monospace,monospace">${text}</span>`
}

/**
 * Give a marker an accessible name.
 *
 * Leaflet's `alt` option is only forwarded to image-based icons — for a
 * divIcon it is dropped silently, so passing `alt` looks correct and does
 * nothing. Leaflet also stamps role="button" and tabindex="0" on interactive
 * markers, which means without this every marker announced as an unnamed
 * button. The name has to be written onto the element once Leaflet creates it.
 */
const named = (
  label: string,
  handlers: L.LeafletEventHandlerFnMap = {},
): L.LeafletEventHandlerFnMap => ({
  ...handlers,
  add: (e) => {
    const el = (e.target as L.Marker).getElement()
    if (el) el.setAttribute("aria-label", label)
    handlers.add?.(e)
  },
})

type FAAStatus = { type: "ground_stop" | "ground_delay_program" | "departure_delay"; delay_minutes: number; reason: string }

/** Radius and pigment per network tier. A spoke is still an airport the
 *  operator owns, so it stays dark enough to read against ambient traffic;
 *  only its size steps down. */
// A FUNCTION, not a const table. The previous object read `MAP_COLORS` at
// module-evaluation time, which froze the dark palette into it — so switching
// theme re-inked every mark on the map except the airports.
const TIER_STYLE = (tier: AirportTier): { r: number; fill: string } => ({
  hub:        { r: 9,   fill: MAP_COLORS.airportHub },
  focus_city: { r: 7,   fill: MAP_COLORS.airportFocus },
  spoke:      { r: 5.5, fill: MAP_COLORS.airportSpoke },
}[tier])

function airportIcon(tier: AirportTier, faa: FAAStatus | undefined, hasWx: boolean, isEvt: boolean, isSel: boolean): L.DivIcon {
  const fk = faa ? `${faa.type}:${faa.delay_minutes}` : "none"
  const key = `ap|${tier}|${fk}|${hasWx}|${isEvt}|${isSel}`
  return icon(key, () => {
    const style = TIER_STYLE(tier)
    const r = style.r
    let fill: string = style.fill
    let ring = "", top = "", bot = ""
    if (faa?.type === "ground_stop") {
      fill = MAP_COLORS.groundStop
      ring = `<span style="position:absolute;inset:-3px;border-radius:9999px;border:2px solid ${MAP_COLORS.groundStop};opacity:0.55"></span>`
      top = apBadge(MAP_COLORS.groundStop, "GS")
    } else if (faa?.type === "ground_delay_program") {
      fill = MAP_COLORS.gdp
      ring = `<span style="position:absolute;inset:-3px;border-radius:9999px;border:2px solid ${MAP_COLORS.gdp};opacity:0.5"></span>`
      top = apBadge(MAP_COLORS.gdp, faa.delay_minutes > 0 ? `+${faa.delay_minutes}m` : "GDP")
    } else if (faa?.type === "departure_delay") {
      fill = MAP_COLORS.depDelay
      if (faa.delay_minutes > 0) top = apBadge(MAP_COLORS.depDelay, `+${faa.delay_minutes}m`)
    } else if (isEvt) {
      fill = MAP_COLORS.eventEpicenter
      ring = `<span style="position:absolute;inset:-4px;border-radius:9999px;border:2px solid ${MAP_COLORS.eventEpicenter};opacity:0.6"></span>`
    }
    if (hasWx) bot = apBadge(MAP_COLORS.weather, "⚡WX", true)
    const sel = isSel ? `<span style="position:absolute;inset:-6px;border-radius:9999px;border:2.5px solid ${MAP_COLORS.liveSelected}"></span>` : ""
    const s = r * 2 + 28
    // ── The disc, re-lit for the dark basemap ──────────────────────────────
    //
    // Two things here were straight carry-overs from the paper register and
    // both are why the map's marks read as flat, low-contrast stickers:
    //
    //   border: 2.5px solid #fff  — a white ring on a near-black chart. It is
    //     the brightest thing in the frame, so on every airport the eye landed
    //     on the RING rather than on the pigment that carries the meaning, and
    //     15 of them read as a scatter of white o's. The ring's actual job is
    //     separating the disc from whatever is behind it; a DARK ring does
    //     that on a dark basemap, and adds no apparent mass.
    //
    //   box-shadow: 0 2px 10px rgba(0,0,0,.25) — a black drop shadow on a
    //     #16181F tile is a no-op. It cost a composite layer per marker and
    //     drew nothing.
    //
    // The shadow is replaced by a GLOW in the mark's own pigment, which is what
    // makes a small mark findable on a dark surface — the light comes off the
    // thing that carries the meaning, so brightness and semantics agree.
    return L.divIcon({
      className: "",
      iconSize: [s, s],
      iconAnchor: [s / 2, s / 2],
      html: `<div style="position:relative;width:${s}px;height:${s}px;display:flex;align-items:center;justify-content:center">${sel}${ring}${top}${bot}<span style="position:relative;width:${r * 2}px;height:${r * 2}px;background:${fill};border:2px solid ${MARK_EDGE};border-radius:9999px;box-shadow:${
        MARK_GLOW
          ? `0 0 ${r + 4}px ${fill}88, 0 0 2px ${fill}`
          : `0 1px 3px rgba(28,20,38,0.32)`
      };display:block"></span></div>`,
    })
  })
}

// ── Map sub-components ─────────────────────────────────────────────────────────

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  useMapEvents({ zoomend: (e) => onZoom(e.target.getZoom()) })
  return null
}

// One canvas for all live contacts; selection keeps the existing detailed marker/inspector.
function LiveTrafficLayer({planes, selected, onSelect}: {planes:LiveFlight[];selected:string|undefined;onSelect:(flight:LiveFlight)=>void}) {
  const map=useMap(), latest=useRef({planes,selected,onSelect}), redraw=useRef<()=>void>(()=>{})
  const tracks=useRef(new Map<string,FlightTrack>())
  latest.current={planes,selected,onSelect}
  useEffect(()=>{
    const ids=new Set(planes.map(f=>f.icao24))
    for(const f of planes) {
      if(Number.isFinite(f.lat)&&Number.isFinite(f.lon)&&Number.isFinite(f.last_contact)&&Math.abs(f.lat)<=90&&Math.abs(f.lon)<=180)
        tracks.current.set(f.icao24,observeFlight(tracks.current.get(f.icao24),f))
    }
    for(const id of tracks.current.keys())if(!ids.has(id))tracks.current.delete(id)
    redraw.current()
  },[planes,selected])
  useEffect(()=>{
    const canvas=document.createElement("canvas"), ctx=canvas.getContext("2d")!
    canvas.className="olus-traffic-canvas";canvas.setAttribute("aria-hidden","true")
    Object.assign(canvas.style,{position:"absolute",inset:"0",pointerEvents:"none",zIndex:"450"})
    map.getContainer().appendChild(canvas)
    const shape=new Path2D(AIRFRAME_PATH), reduced=matchMedia("(prefers-reduced-motion: reduce)")
    const blue=getComputedStyle(map.getContainer()).getPropertyValue("--neutral-arc").trim()||MAP_COLORS.live
    const observed=L.polyline([],{pane:"ae-focus-line",color:blue,weight:3,opacity:1,interactive:false}).addTo(map)
    const forecast=L.polyline([],{pane:"ae-focus-line",color:blue,weight:3,opacity:.85,dashArray:"10 7",interactive:false}).addTo(map)
    let marker:L.Marker|null=null, selectedId:string|undefined, markerHeading:number|null=null, markerLabel="", frame=0, lastFrame=0
    let hits:{x:number;y:number;lf:LiveFlight}[]=[]
    const draw=(time:number)=>{
      frame=0;if(document.hidden)return
      if(time-lastFrame<50){schedule();return}lastFrame=time
      const size=map.getSize(),dpr=Math.min(devicePixelRatio,2), now=Date.now()/1000
      if(canvas.width!==size.x*dpr||canvas.height!==size.y*dpr){canvas.width=size.x*dpr;canvas.height=size.y*dpr;canvas.style.width=size.x+"px";canvas.style.height=size.y+"px"}
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,size.x,size.y);hits=[]
      let selectedFound=false, moving=false
      for(const lf of latest.current.planes){
        const track=tracks.current.get(lf.icao24);if(!track)continue
        const pos=trackPosition(track,now,reduced.matches), point=map.latLngToContainerPoint(pos)
        if(lf.icao24===latest.current.selected){
          selectedFound=true
          if(selectedId!==lf.icao24){marker?.remove();marker=L.marker(pos,{pane:"ae-focus-marker",icon:liveSelIcon(track.heading),title:lf.flight_iata||lf.flight_icao||lf.icao24}).addTo(map);selectedId=lf.icao24;markerLabel=""}
          marker!.setLatLng(pos)
          if(markerHeading!==track.heading){marker!.setIcon(liveSelIcon(track.heading));markerHeading=track.heading}
          observed.setLatLngs(observedTrail(track,now,reduced.matches))
          const fresh=now-track.last_contact<=60
          forecast.setLatLngs(fresh&&track.heading!=null&&(track.velocity_kt??0)>0?[pos,deadReckon(pos[0],pos[1],track.heading,track.velocity_kt!,600,600)]:[])
          const label=`${lf.flight_iata||lf.flight_icao||lf.icao24} ? ${fresh?"Observed track; dashed heading estimate":"Stale position; direction estimate paused"}`
          if(markerLabel!==label){const text=document.createElement("span");text.textContent=label;marker!.bindTooltip(text);markerLabel=label}
          marker!.getElement()?.setAttribute("data-position",pos.join(","))
        }
        if(point.x < -20||point.y < -20||point.x > size.x+20||point.y > size.y+20)continue
        if(now-30<track.last_contact&&track.fixes.length>1)moving=true
        hits.push({x:point.x,y:point.y,lf})
        if(lf.icao24===latest.current.selected)continue
        ctx.save();ctx.translate(point.x,point.y);ctx.rotate((track.heading??0)*Math.PI/180);ctx.scale(16/64,16/64);ctx.translate(-32,-32)
        ctx.globalAlpha=now-track.last_contact>60?.4:(lf.velocity_kt??0)<50?.55:.95;ctx.fillStyle=blue;ctx.fill(shape);ctx.restore()
      }
      if(!selectedFound){marker?.remove();marker=null;selectedId=undefined;observed.setLatLngs([]);forecast.setLatLngs([])}
      canvas.dataset.contacts=String(hits.length)
      // Animation stays outside React; no whole-dashboard render per frame.
      if(moving&&!reduced.matches)schedule()
    }
    const schedule=()=>{if(!frame&&!document.hidden)frame=requestAnimationFrame(draw)}
    const click=(e:L.LeafletMouseEvent)=>{
      if((e.originalEvent.target as Element)?.closest(".leaflet-marker-icon,.leaflet-interactive"))return
      let nearest:LiveFlight|undefined, distance=14*14
      for(const hit of hits){const d=(hit.x-e.containerPoint.x)**2+(hit.y-e.containerPoint.y)**2;if(d<distance){distance=d;nearest=hit.lf}}
      if(nearest)latest.current.onSelect(nearest)
    }
    const staleTimer=window.setInterval(schedule,5000)
    redraw.current=schedule;map.on("move zoom resize",schedule);map.on("click",click);document.addEventListener("visibilitychange",schedule);reduced.addEventListener("change",schedule);schedule()
    return()=>{clearInterval(staleTimer);cancelAnimationFrame(frame);map.off("move zoom resize",schedule);map.off("click",click);document.removeEventListener("visibilitychange",schedule);reduced.removeEventListener("change",schedule);observed.remove();forecast.remove();marker?.remove();canvas.remove();redraw.current=()=>{}}
  },[map])
  return null
}

function BoundsTracker({ onBounds }: { onBounds: (b: L.LatLngBounds) => void }) {
  const map = useMap()
  useMapEvents({
    moveend: () => onBounds(map.getBounds()),
    zoomend: () => onBounds(map.getBounds()),
  })
  useEffect(() => { onBounds(map.getBounds()) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/**
 * Recompute tile layout when the map column is resized.
 *
 * rAF-COALESCED, 2026-08-16. `invalidateSize` is not cheap — it re-reads the
 * container box, recomputes the pixel origin and re-lays every tile and marker
 * layer. Calling it straight from the ResizeObserver was fine while the console
 * only resized on window drags, but the rail now PUSHES the layout on hover
 * (see rail.tsx), so a 240ms width transition delivered ~15 resize entries and
 * therefore ~15 full Leaflet re-layouts — with ~650 ADS-B markers mounted, that
 * is exactly the hover-lag this fixes. Coalescing to one call per frame keeps
 * the map in step with the transition at a fifteenth of the work.
 *
 * The trailing call after the transition settles matters too: rAF-coalescing
 * alone can drop the FINAL observation if it lands in the same frame as the
 * previous one, leaving the map a few pixels short of its container.
 */
function MapResizeFix() {
  const map = useMap()
  useEffect(() => {
    let frame = 0
    let settle: ReturnType<typeof setTimeout> | undefined
    const fix = () => {
      map.invalidateSize({ animate: false })
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        fix()
      })
      clearTimeout(settle)
      settle = setTimeout(fix, 280)
    }
    fix()
    const ro = new ResizeObserver(schedule)
    const el = map.getContainer().parentElement
    if (el) ro.observe(el)
    window.addEventListener("orientationchange", schedule)
    return () => {
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
      clearTimeout(settle)
      window.removeEventListener("orientationchange", schedule)
    }
  }, [map])
  return null
}

function FitBounds({ flights }: { flights: ScheduledFlight[] }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || !flights.length) return
    const pts = flights.flatMap((f) => {
      const o = NIMBUS_AIRPORTS[f.origin], d = NIMBUS_AIRPORTS[f.destination]
      return [o, d].filter(Boolean) as { lat: number; lon: number }[]
    })
    if (!pts.length) return
    map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.15), { animate: false })
    done.current = true
  }, [flights, map])
  return null
}

function FocusFlight({ target }: { target: ScheduledFlight | LiveFlight | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    if ("icao24" in target) { map.flyTo([target.lat, target.lon], 9, { duration: 0.8 }); return }
    const o = NIMBUS_AIRPORTS[(target as ScheduledFlight).origin]
    const d = NIMBUS_AIRPORTS[(target as ScheduledFlight).destination]
    if (o && d) map.flyToBounds(L.latLngBounds([[o.lat, o.lon], [d.lat, d.lon]]).pad(0.45), { duration: 0.8 })
  }, [target, map])
  return null
}

// ── Event helpers ──────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  weather_closure: "Weather Closure", ground_stop: "Ground Stop",
  airspace_closure: "Airspace Closure", security_event: "Security Event",
  mechanical_aog: "Mechanical AOG", crew_sickout: "Crew Sick-out",
  runway_closure: "Runway Closure", atc_staffing: "ATC Shortage",
  volcanic_ash: "Volcanic Ash", cyber_incident: "Cyber Incident",
}
// One icon family (lucide), one stroke weight — no emoji in UI chrome.
const EVENT_ICONS: Record<string, typeof CloudLightningIcon> = {
  weather_closure: CloudLightningIcon, ground_stop: OctagonAlertIcon,
  airspace_closure: BanIcon, security_event: ShieldAlertIcon,
  mechanical_aog: WrenchIcon, crew_sickout: HeartPulseIcon,
  runway_closure: AlertTriangleIcon, atc_staffing: RadioIcon,
  volcanic_ash: MountainIcon, cyber_incident: ServerCrashIcon,
}

function EventIcon({ kind, className, style }: { kind: string; className?: string; style?: CSSProperties }) {
  const Icon = EVENT_ICONS[kind] ?? AlertTriangleIcon
  return <Icon className={className} style={style} strokeWidth={1.75} />
}

// ── Overlay components ─────────────────────────────────────────────────────────

function DisruptionBanner({
  events, impactCount, summary,
}: {
  events: ActiveEvent[]
  impactCount: number
  summary: CascadeSummary | null
}) {
  if (events.length === 0) return null
  return (
    <div className="absolute top-3 left-3 z-[450] flex flex-col gap-2" style={{ maxWidth: 268 }}>
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: GLASS,
          backdropFilter: "blur(14px)",
          border: "1px solid var(--ae-line)",
          borderLeft: "2px solid var(--ae-rust)",
          boxShadow: "var(--ae-shadow-card-elev)",
        }}
      >
        {/* Header strip */}
        <div
          className="px-3.5 py-2.5 flex items-center gap-2"
          style={{ borderBottom: "1px solid var(--ae-line)" }}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--ae-rust)" }} />
          <span className="text-[11px] font-semibold flex-1" style={{ color: "var(--ae-text)" }}>
            Disruption active
          </span>
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0"
            style={{ background: "var(--ae-rust-bg)", color: "var(--ae-rust-ink)" }}
          >
            {events.length}
          </span>
        </div>

        {/* Events list */}
        <div className="px-3.5 py-2.5 space-y-2.5">
          {events.slice(0, 3).map((ev) => (
            <div key={ev.id} className="flex items-start gap-2.5">
              <EventIcon kind={ev.kind} className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--ae-rust-ink)" }} />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold leading-tight" style={{ color: "var(--ae-text)" }}>
                  {EVENT_LABELS[ev.kind] ?? ev.kind.replace(/_/g, " ")}
                </div>
                {(ev.params?.airport || ev.params?.aircraft_tail || ev.params?.base || ev.params?.destination_airport) && (
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[11px] font-mono font-semibold" style={{ color: "var(--ae-text-2)" }}>
                      {ev.params.airport || ev.params.aircraft_tail || ev.params.base || ev.params.destination_airport}
                    </span>
                    {ev.params.severity && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: "var(--ae-amber-bg)", color: "var(--ae-amber-ink)" }}>
                        {ev.params.severity}
                      </span>
                    )}
                    {ev.params.duration_hours && (
                      <span className="text-[11px]" style={{ color: "var(--ae-text-3)" }}>{ev.params.duration_hours}h</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {events.length > 3 && (
            <div className="text-[11px] pl-6" style={{ color: "var(--ae-text-3)" }}>+{events.length - 3} more</div>
          )}
        </div>

        {/* Impact row */}
        {(summary || impactCount > 0) && (
          <div
            className="px-3.5 py-2 flex items-center gap-2 flex-wrap"
            style={{ background: "rgba(15,20,18,0.04)", borderTop: "1px solid var(--ae-line)" }}
          >
            {summary ? (
              <span className="text-[11px] font-medium" style={{ color: "var(--ae-text-2)" }}>
                <span className="font-semibold font-mono" style={{ color: "var(--ae-text)" }}>{summary.total_affected}</span> affected ·{" "}
                {summary.directly_affected} direct ·{" "}
                {(summary.cascade_1 || 0) + (summary.cascade_2 || 0)} cascade
              </span>
            ) : (
              <span className="text-[11px] font-medium" style={{ color: "var(--ae-text-2)" }}>{impactCount} routes impacted</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const PLAN_META_MAP = {
  A: { label: "Minimize Cost" },
  B: { label: "Min. Pax Impact" },
  C: { label: "Protect Tomorrow" },
  D: { label: "Green Recovery" },
}

function RecoveryBanner({ plan, onUnapply }: { plan: RecoveryPlan; onUnapply: () => void }) {
  const meta = PLAN_META_MAP[plan.plan_id as keyof typeof PLAN_META_MAP] ?? PLAN_META_MAP.A
  const cost = plan.cost_breakdown?.grand_total_usd
    ? `$${(plan.cost_breakdown.grand_total_usd / 1_000_000).toFixed(2)}M`
    : `$${(plan.total_cost_usd / 1000).toFixed(0)}K`

  return (
    /* Clearing the instrument column, measured rather than assumed.
     *
     * `right: 64` was written when that column was a single 40px button, and
     * design.md's "overlays must clear it by ≥64px" was written about the same
     * thing. The column is now a two-option projection switch: 2 × 56px min-
     * width + 6px padding + 3px gap = 121px, spanning right 12..133 — so a
     * banner ending at right:64 was painted straight through it, and at z-450
     * against the switch's z-620 it lost, leaving `Unapply` UNREACHABLE.
     * Measured overlap 54×20px at 1440.
     *
     * `Unapply` is the only control that reverses a committed network-wide
     * dispatch, so this is a P1, not a cosmetic overlap. 152 = 12 (column
     * inset) + 121 (switch) + 19 (gap), and the arithmetic is written down so
     * the next person to change the switch's width knows what depends on it.
     */
    <div className="absolute top-3 z-[450]" style={{ maxWidth: 560, right: 152, left: "min(460px, calc(50% - 40px))" }}>
      <div
        className="rounded-xl px-3 py-2.5 flex items-center gap-2.5 flex-wrap"
        style={{
          background: GLASS,
          backdropFilter: "blur(16px)",
          border: "1px solid var(--ae-line)",
          borderLeft: "2px solid var(--ae-teal)",
          boxShadow: "var(--ae-shadow-card-elev)",
        }}
      >
        {/* Plan badge — teal marks the applied plan; the letter carries identity */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
            style={{ background: "var(--ae-teal-bg)", border: "1px solid var(--ae-teal)", color: "var(--ae-teal-ink)" }}
          >
            {plan.plan_id}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest leading-none" style={{ color: "var(--ae-teal-ink)" }}>
              Plan applied
            </div>
            <div className="text-[11px] font-semibold leading-tight mt-0.5" style={{ color: "var(--ae-text)" }}>{meta.label}</div>
          </div>
        </div>

        {/* Separator */}
        <div className="hidden sm:block w-px h-7 shrink-0" style={{ background: "var(--ae-line)" }} />

        {/* Metrics row */}
        <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
          <MetricChip label="Cost" value={cost} />
          {(plan.cancelled_flights?.length ?? 0) > 0 && (
            <MetricChip label="Canc." value={String(plan.cancelled_flights.length)} dot="var(--ae-rust)" />
          )}
          {(plan.delayed_flights?.length ?? 0) > 0 && (
            <MetricChip label="Delay" value={String(plan.delayed_flights.length)} dot="var(--ae-amber)" />
          )}
          {(plan.aircraft_swaps?.length ?? 0) > 0 && (
            <MetricChip label="Swap" value={String(plan.aircraft_swaps.length)} dot="var(--ae-teal)" />
          )}
          <MetricChip
            label="FAR 117"
            value={plan.crew_violations > 0 ? `${plan.crew_violations} flags` : "OK"}
            dot={plan.crew_violations > 0 ? "var(--ae-amber)" : "var(--ae-teal)"}
          />
        </div>

        {/* Unapply */}
        <button
          onClick={onUnapply}
          className="shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-md transition-all whitespace-nowrap"
          style={{
            background: "transparent",
            border: "1px solid var(--ae-line-strong)",
            color: "var(--ae-text)",
            cursor: "pointer",
          }}
        >
          Unapply
        </button>
      </div>
    </div>
  )
}

/**
 * Label + value pair. The pigment rides as an UNDERLINE on the value, not as a
 * leading dot.
 *
 * design.md: "Status is TEXT, never dots… Status dots are banned everywhere
 * (landing + app)." This component shipped three of them, on the HUD that
 * reports a committed dispatch. Beyond the house rule, a 6px disc is below the
 * size at which hue is reliably discriminable, so the dot was carrying its
 * state by colour alone at a size where colour is hardest to read — while the
 * top bar two rows above solved the identical problem with an underline.
 */
function MetricChip({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] font-medium" style={{ color: "var(--ae-text-3)" }}>{label}</span>
      <span
        className="text-[11px] font-semibold font-mono tabular-nums"
        style={{
          color: "var(--ae-text)",
          borderBottom: dot ? `2px solid ${dot}` : undefined,
          paddingBottom: dot ? 1 : undefined,
        }}
      >
        {value}
      </span>
    </div>
  )
}

function fmtZ(iso: string): string {
  try { return new Date(iso).toISOString().slice(11, 16) + "Z" } catch { return "—" }
}

function FlightDetailCard({
  flight, state, appliedPlan, applied, onClose, onOpenAircraft,
}: {
  flight: ScheduledFlight
  state: FlightState | undefined
  appliedPlan: RecoveryPlan | null
  applied: { cancelled: Set<string>; swap: Set<string>; delayed: Map<string, number> }
  onClose: () => void
  onOpenAircraft: () => void
}) {
  const isPlanCancelled    = applied.cancelled.has(flight.id)
  const isCascadeCancelled = !isPlanCancelled && state?.status === "cancelled"
  const isCancelled        = isPlanCancelled || isCascadeCancelled
  const isSwapped   = applied.swap.has(flight.id)
  const planDelay   = applied.delayed.get(flight.id)
  const delayMin    = isCancelled ? 0 : (planDelay ?? state?.delay_minutes ?? 0)
  const cascOrder   = state?.cascade_order ?? -1
  const pDelay      = state?.p_delayed ?? 0

  const oAp = NIMBUS_AIRPORTS[flight.origin]
  const dAp = NIMBUS_AIRPORTS[flight.destination]

  let actionLabel = "", actionColor = "#17A874", actionIcon = ""
  // Colours mirror the map's MAP_COLORS palette so the inspector card and the
  // line/marker on the map read as the same semantic state at a glance.
  if (isPlanCancelled)     { actionLabel = "Cancelled by recovery plan"; actionColor = MAP_COLORS.planCancelledInk; actionIcon = "✕" }
  else if (isCascadeCancelled){ actionLabel = "Grounded by disruption"; actionColor = MAP_COLORS.cascadeDirect; actionIcon = "✕" }
  else if (isSwapped)      { actionLabel = "Re-routed · new aircraft assigned"; actionColor = MAP_COLORS.planSwap; actionIcon = "↕" }
  else if (planDelay)      { actionLabel = `Delayed +${planDelay} min by plan`; actionColor = MAP_COLORS.planDelayed; actionIcon = "⏱" }
  else if (cascOrder === 0){ actionLabel = "Direct impact — epicenter"; actionColor = MAP_COLORS.cascadeDirect; actionIcon = "⚡" }
  else if (cascOrder > 0)  { actionLabel = `Cascade order ${cascOrder}`; actionColor = MAP_COLORS.cascadeOrder1; actionIcon = "↗" }

  return (
    /* Lane: BELOW the top-right instrument column, not beside it.
       At `top: 12, right: 56` this card's own close button sat underneath the
       projection switch — the switch spans right 12..135 at top 12..54 and
       wins on z-index (620 vs 450), so the ✕ was covered and a selected flight
       could not be dismissed by the control that exists to dismiss it.
       `right: 56` also left only 2px beside the zoom control where DESIGN.md
       asks overlays to clear that column by 64px.
       Top 66 clears the switch (bottom 54) by 12; right 64 satisfies the rule.
       maxHeight now measures from the card's own top rather than assuming a
       fixed 202px of chrome, so the card shrinks with the map instead of
       overflowing it. */
    <div
      className="absolute z-[450] w-[19.5rem]"
      style={{
        top: appliedPlan ? 118 : 66,
        right: 64,
        maxHeight: `calc(100% - ${(appliedPlan ? 118 : 66) + 24}px)`,
        display: "flex", flexDirection: "column",
      }}
    >
      <div className="ae-ticket ae-scroll-smooth" style={{ overflowY: "auto" }}>
        {/* header — flight number, aircraft, SIM chip */}
        <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono font-bold text-[18px] leading-none mb-1" style={{ color: "#141019" }}>{flight.id}</div>
            <div className="text-[11px] font-medium" style={{ color: "#55503F" }}>
              {flight.aircraft_id} · {flight.passengers ?? "—"} pax
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-mono font-bold px-2 py-1 rounded-full tracking-widest" style={{ background: "rgba(20,16,25,0.08)", color: "#141019" }}>SIM</span>
            <button
              onClick={onClose}
              aria-label="Close (Esc)"
              title="Close — Esc"
              className="ae-card-close rounded-full flex items-center justify-center transition-all"
              /* 36px, was 28. This is the dismiss control for an overlay that
                 covers the map; under WCAG 2.5.8 it was under the 24px floor
                 once its optical padding is discounted, and it had no hover
                 or focus state at all. */
              style={{ width: 36, height: 36, fontSize: 19, lineHeight: 1, color: "#55503F", flexShrink: 0 }}
            >×</button>
          </div>
        </div>

        {/* FROM ── ✈ ── TO */}
        <div className="px-5 pb-4">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.16em] font-semibold mb-1" style={{ color: "#55503F" }}>From</div>
              <div className="font-mono font-bold leading-none" style={{ color: "#141019", fontSize: 34 }}>{flight.origin.replace("K", "")}</div>
              <div className="text-[11px] mt-1 truncate font-medium" style={{ color: "#55503F" }}>{oAp?.city ?? ""}</div>
            </div>
            <div className="flex-1 flex flex-col items-center pb-4 px-1">
              <div className="text-[11px] font-mono font-semibold mb-1" style={{ color: isCancelled ? "#9D174D" : "#141019" }}>
                {isCancelled ? "CANCELLED" : delayMin > 0 ? `+${delayMin} min` : "on time"}
              </div>
              <div className="w-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ border: "1.5px solid #141019" }} />
                <span className="flex-1" style={{ borderTop: "2px dashed rgba(20,16,25,0.3)" }} />
                {isCancelled ? (
                  <span className="text-[13px] font-bold leading-none" style={{ color: "#141019" }}>✕</span>
                ) : (
                  <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden style={{ color: "#141019", transform: "rotate(90deg)" }}>
                    <path fill="currentColor" d="M21.5 15.5v-2l-8-5V3a1.5 1.5 0 0 0-3 0v5.5l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13.5 19v-6z" />
                  </svg>
                )}
                <span className="flex-1" style={{ borderTop: "2px dashed rgba(20,16,25,0.3)" }} />
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#141019" }} />
              </div>
              <div className="text-[11px] font-mono font-medium mt-1" style={{ color: "#55503F" }}>
                {fmtZ(flight.scheduled_departure)} → {fmtZ(flight.scheduled_arrival)}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[11px] uppercase tracking-[0.16em] font-semibold mb-1" style={{ color: "#55503F" }}>To</div>
              <div className="font-mono font-bold leading-none" style={{ color: "#141019", fontSize: 34 }}>{flight.destination.replace("K", "")}</div>
              <div className="text-[11px] mt-1 truncate font-medium" style={{ color: "#55503F" }}>{dAp?.city ?? ""}</div>
            </div>
          </div>
        </div>

        <div className="ae-ticket-perf" />

        {/* operational stats */}
        <div className="px-5 py-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <TicketStat
            label="Status"
            value={isCancelled ? "Cancelled" : delayMin > 0 ? `+${delayMin} min` : state?.status ?? "On time"}
          />
          <TicketStat
            label="Cascade"
            value={cascOrder < 0 ? "None" : cascOrder === 0 ? "Direct hit" : `Order ${cascOrder}`}
          />
          {!isCancelled && (
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: "#55503F" }}>Impact probability</div>
                <div className="text-[12px] font-semibold font-mono" style={{ color: "#141019" }}>{(pDelay * 100).toFixed(0)}%</div>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: "rgba(20,16,25,0.08)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pDelay * 100}%`, background: pDelay > 0.6 ? "var(--ae-amber)" : "var(--ae-teal)" }}
                />
              </div>
            </div>
          )}
          {actionLabel && (
            <div
              className="col-span-2 rounded-xl px-3 py-2 flex items-center gap-2 text-[11px] font-bold"
              style={{ background: `${actionColor}14`, border: `1px solid ${actionColor}55`, color: "#141019" }}
            >
              <span className="text-sm shrink-0">{actionIcon}</span>
              {actionLabel}
            </div>
          )}
          {state?.reason && (
            <div className="col-span-2 text-[11px] italic leading-relaxed" style={{ color: "#55503F" }}>
              {state.reason}
            </div>
          )}
        </div>

        <div className="ae-ticket-perf" />

        {/* stub — flight id barcode + seat-map action */}
        <div className="px-5 py-4">
          <div className="ae-ticket-barcode mb-1" aria-hidden />
          <div className="font-mono text-[11px] mb-3 tracking-[0.3em]" style={{ color: "#55503F" }}>{flight.id} · {flight.aircraft_id}</div>
          <button
            onClick={onOpenAircraft}
            className="w-full text-[12px] font-semibold px-3 py-2.5 rounded-full transition-colors"
            style={{ background: "#141019", color: "#FFFFFF", border: "none", cursor: "pointer" }}
          >
            Aircraft &amp; seating →
          </button>
        </div>
      </div>
    </div>
  )
}

function StatCell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--ae-surface)", border: "1px solid var(--ae-line)" }}>
      <div className="text-[11px] uppercase tracking-wider mb-0.5" style={{ color: "var(--ae-text-3)", fontWeight: 600 }}>{label}</div>
      <div className="font-mono font-semibold text-[15px] leading-none" style={{ color: tone ?? "var(--ae-text)" }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: "var(--ae-text-3)" }}>{sub}</div>}
    </div>
  )
}

/** Boarding-pass ticket: label row + big mono value. All ink-on-white. */
function TicketStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] font-semibold mb-0.5" style={{ color: "#55503F" }}>{label}</div>
      <div className="font-mono font-semibold text-[15px] leading-none" style={{ color: "#141019" }}>{value}</div>
      {sub && <div className="text-[9.5px] mt-0.5 font-medium" style={{ color: "#55503F" }}>{sub}</div>}
    </div>
  )
}

function LivePanel({ flight, onClose }: { flight: LiveFlight; onClose: () => void }) {
  const d = deriveLive(flight)
  const emergency = flight.squawk === "7500" || flight.squawk === "7600" || flight.squawk === "7700"
  const nearAp = d.nearest ? NIMBUS_AIRPORTS[d.nearest.icao] : null
  const aheadAp = d.ahead ? NIMBUS_AIRPORTS[d.ahead.icao] : null
  const fl = flight.altitude_ft != null ? `FL${String(Math.round(flight.altitude_ft / 100)).padStart(3, "0")}` : "—"
  const eta = d.ahead
    ? d.ahead.etaMin < 60 ? `${Math.round(d.ahead.etaMin)} min` : `${(d.ahead.etaMin / 60).toFixed(1)} h`
    : "—"

  return (
    <div
      className="ae-ticket absolute top-12 right-14 left-3 sm:left-auto z-[450] w-[19.5rem] flex flex-col"
      style={{ maxHeight: "calc(100% - 202px)" }}
    >
      {/* header — callsign, airline, LIVE chip */}
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono font-bold text-[18px] leading-none" style={{ color: "#141019" }}>{flight.flight_icao}</span>
            {flight.flight_iata && flight.flight_iata !== flight.flight_icao && (
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(20,16,25,0.06)", color: "#55503F" }}>{flight.flight_iata}</span>
            )}
          </div>
          <div className="text-[11px] font-medium truncate" style={{ color: "#55503F" }}>{flight.airline_name}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] font-mono font-bold px-2 py-1 rounded-full tracking-widest" style={{ background: "#141019", color: "#FFFFFF" }}>LIVE</span>
          <button
              onClick={onClose}
              aria-label="Close (Esc)"
              title="Close — Esc"
              className="ae-card-close rounded-full flex items-center justify-center transition-all"
              /* 36px, was 28. This is the dismiss control for an overlay that
                 covers the map; under WCAG 2.5.8 it was under the 24px floor
                 once its optical padding is discounted, and it had no hover
                 or focus state at all. */
              style={{ width: 36, height: 36, fontSize: 19, lineHeight: 1, color: "#55503F", flexShrink: 0 }}
            >×</button>
        </div>
      </div>
      {emergency && (
        <div className="mx-5 mb-2 text-[11px] font-bold px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(190,24,93,0.10)", color: "#9D174D", border: "1px solid rgba(190,24,93,0.4)" }}>
          EMERGENCY · SQUAWK {flight.squawk}
        </div>
      )}

      <div className="ae-scroll-smooth flex-1 min-h-0" style={{ overflowY: "auto" }}>
        {/* FROM ── ✈ ── TO, boarding-pass style */}
        <div className="px-5 pb-4 pt-1">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.16em] font-semibold mb-1" style={{ color: "#55503F" }}>Nearest</div>
              <div className="font-mono font-bold leading-none" style={{ color: "#141019", fontSize: 34 }}>{nearAp?.iata ?? "———"}</div>
              <div className="text-[11px] mt-1 truncate font-medium" style={{ color: "#55503F" }}>{nearAp?.city ?? "en route"}</div>
            </div>
            <div className="flex-1 flex flex-col items-center pb-4 px-1">
              <div className="text-[11px] font-mono font-semibold mb-1" style={{ color: "#141019" }}>{eta}</div>
              <div className="w-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ border: "1.5px solid #141019" }} />
                <span className="flex-1" style={{ borderTop: "2px dashed rgba(20,16,25,0.3)" }} />
                <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden style={{ color: "#141019", transform: "rotate(90deg)" }}>
                  <path fill="currentColor" d="M21.5 15.5v-2l-8-5V3a1.5 1.5 0 0 0-3 0v5.5l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13.5 19v-6z" />
                </svg>
                <span className="flex-1" style={{ borderTop: "2px dashed rgba(20,16,25,0.3)" }} />
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#141019" }} />
              </div>
              <div className="text-[11px] font-medium mt-1" style={{ color: "#55503F" }}>{d.ahead ? `${Math.round(d.ahead.nm)} nm` : d.phase.label}</div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[11px] uppercase tracking-[0.16em] font-semibold mb-1" style={{ color: "#55503F" }}>Heading to</div>
              <div className="font-mono font-bold leading-none" style={{ color: "#141019", fontSize: 34 }}>{aheadAp?.iata ?? "———"}</div>
              <div className="text-[11px] mt-1 truncate font-medium" style={{ color: "#55503F" }}>{aheadAp?.city ?? "no hub in track"}</div>
            </div>
          </div>
        </div>

        <div className="ae-ticket-perf" />

        {/* telemetry — the numbers an operator actually reads */}
        <div className="px-5 py-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <TicketStat label="Altitude" value={flight.altitude_ft != null ? `${flight.altitude_ft.toLocaleString()} ft` : "—"} sub={fl} />
          <TicketStat label="Ground speed" value={d.gs ? `${d.gs} kt` : "—"} sub={d.gs ? `${Math.round(d.gs * 1.15078)} mph` : undefined} />
          <TicketStat label="Vertical rate" value={d.vs ? `${d.vs > 0 ? "▲" : "▼"} ${Math.abs(d.vs).toLocaleString()}` : "level"} sub="fpm" />
          <TicketStat label="Heading" value={`${Math.round(d.hdg)}°`} sub={cardinal(d.hdg)} />
          <TicketStat label="Mach" value={d.mach ? `M ${d.mach.toFixed(2)}` : "—"} />
          <TicketStat label="Dist. to hub" value={d.nearest ? `${Math.round(d.nearest.nm)} nm` : "—"} sub={nearAp ? `${cardinal(bearing(flight.lat, flight.lon, nearAp.lat, nearAp.lon))} of ${nearAp.iata}` : undefined} />
        </div>

        <div className="ae-ticket-perf" />

        {/* stub — transponder hex as the "ticket number" + barcode */}
        <div className="px-5 py-4">
          <div className="flex items-end justify-between gap-3 mb-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] font-semibold mb-1" style={{ color: "#55503F" }}>Transponder · ADS-B</div>
              <div className="font-mono text-[13px] font-semibold tracking-wider" style={{ color: "#141019" }}>{flight.icao24.toUpperCase()}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.14em] font-semibold mb-1" style={{ color: "#55503F" }}>Signal</div>
              <div className="font-mono text-[12px] font-semibold" style={{ color: d.ageSec > 60 ? "#8A6410" : "#141019" }}>{d.ageSec}s ago</div>
            </div>
          </div>
          <div className="ae-ticket-barcode mb-1" aria-hidden />
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px]" style={{ color: "#55503F" }}>{flight.lat.toFixed(3)}, {flight.lon.toFixed(3)}</span>
            <span className="flex gap-2">
              {flight.tracking.flightaware && (
                <a href={flight.tracking.flightaware} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold underline" style={{ color: "#46307F" }}>FlightAware</a>
              )}
              <a href={flight.tracking.flightradar24} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold underline" style={{ color: "#46307F" }}>FR24</a>
              <a href={flight.tracking.adsbexchange} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold underline" style={{ color: "#46307F" }}>ADS-B</a>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function AirportPanel({ icao, faa, hasWx, wxText, simAffected, onClose }: {
  icao: string; faa: FAAStatus | undefined; hasWx: boolean; wxText: string; simAffected: boolean; onClose: () => void
}) {
  const ap = NIMBUS_AIRPORTS[icao]
  if (!ap) return null
  return (
    <div
      className="absolute top-12 right-14 z-[450] w-64 rounded-xl overflow-hidden"
      style={{
        background: GLASS_STRONG,
        backdropFilter: "blur(16px)",
        border: "1px solid var(--ae-line)",
        boxShadow: "var(--ae-shadow-overlay)",
      }}
    >
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--ae-surface-2)", borderBottom: "1px solid var(--ae-line)" }}
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-base" style={{ color: "var(--ae-text)" }}>{ap.iata}</span>
            <span className="text-[11px] font-mono text-muted-foreground">{icao}</span>
            {/* Names the real tier. Was HUB-or-nothing, which left eleven
                airports with no stated role at all. */}
            <span
              className="text-[8px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: "var(--ae-teal-bg)", color: "var(--ae-teal-ink)" }}
            >
              {airportTier(icao) === "hub" ? "HUB" : airportTier(icao) === "focus_city" ? "FOCUS CITY" : "SPOKE"}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{ap.name}, {ap.city}</div>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-lg text-muted-foreground hover:bg-secondary transition-all">×</button>
      </div>
      <div className="px-4 py-3 space-y-2">
        {!faa && !hasWx && !simAffected && (
          <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--ae-text-2)" }}>
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--ae-teal)" }} />Normal operations
          </div>
        )}
        {faa?.type === "ground_stop" && (
          <div className="rounded-lg p-2.5" style={{ background: "var(--ae-rust-bg)", border: "1px solid var(--ae-line)" }}>
            <div className="font-semibold text-xs" style={{ color: "var(--ae-rust-ink)" }}>Ground stop</div>
            {faa.reason && <div className="text-[11px] mt-0.5" style={{ color: "var(--ae-text-2)" }}>{faa.reason}</div>}
          </div>
        )}
        {faa?.type === "ground_delay_program" && (
          <div className="rounded-lg p-2.5" style={{ background: "var(--ae-amber-bg)", border: "1px solid var(--ae-line)" }}>
            <div className="font-semibold text-xs" style={{ color: "var(--ae-amber-ink)" }}>GDP{faa.delay_minutes > 0 && ` — avg +${faa.delay_minutes} min`}</div>
            {faa.reason && <div className="text-[11px] mt-0.5" style={{ color: "var(--ae-text-2)" }}>{faa.reason}</div>}
          </div>
        )}
        {faa?.type === "departure_delay" && (
          <div className="rounded-lg p-2.5" style={{ background: "var(--ae-amber-bg)", border: "1px solid var(--ae-line)" }}>
            <div className="font-semibold text-xs" style={{ color: "var(--ae-amber-ink)" }}>Departure delay{faa.delay_minutes > 0 && ` +${faa.delay_minutes} min`}</div>
            {faa.reason && <div className="text-[11px] mt-0.5" style={{ color: "var(--ae-text-2)" }}>{faa.reason}</div>}
          </div>
        )}
        {hasWx && (
          <div className="rounded-lg p-2.5" style={{ background: "var(--ae-amber-bg)", border: "1px solid var(--ae-line)" }}>
            <div className="font-semibold text-xs" style={{ color: "var(--ae-amber-ink)" }}>NWS weather alert</div>
            {wxText && <div className="text-[11px] mt-0.5 line-clamp-2" style={{ color: "var(--ae-text-2)" }}>{wxText}</div>}
          </div>
        )}
        {simAffected && (
          <div className="rounded-lg p-2.5" style={{ background: "var(--ae-rust-bg)", border: "1px solid var(--ae-line)" }}>
            <div className="text-[11px] font-semibold" style={{ color: "var(--ae-rust-ink)" }}>Simulation disruption active at this airport</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props { selectedFlight: string | null; onFlightSelect: (id: string | null) => void; externalFeed?: boolean; readOnlyRun?: boolean; previewPlanId?: string | null }

export default function FlightMap({ selectedFlight, onFlightSelect, externalFeed=false, readOnlyRun=false, previewPlanId=null }: Props) {
  const {
    schedule, flightStates, activeEvents, recoveryPlans, appliedPlanId, applyPlan,
    cascadeSummary, liveFlights, showLiveFlights, showSimulation,
    selectedLiveFlight, setSelectedLiveFlight,
    setLiveFlights, setShowLiveFlights, setShowSimulation, setSchedule,
  } = useSimulationStore()

  const [nowMs, setNowMs]         = useState(() => Date.now())
  const [loading, setLoading]     = useState(false)
  const [lastFetch, setLastFetch] = useState<number | null>(null)
  const [liveSeeded, setLiveSeeded] = useState(false)
  const [seeding, setSeeding]       = useState(false)
  const [selAirport, setSelAirport]   = useState<string | null>(null)
  const [airportFAA, setAirportFAA]   = useState<Record<string, FAAStatus>>({})
  const [wxAirports, setWxAirports]   = useState<Record<string, string>>({})
  const [mapZoom, setMapZoom]         = useState(4)
  const [mapBounds, setMapBounds]     = useState<L.LatLngBounds | null>(null)

  // ── Projection register ───────────────────────────────────────────────────
  // Two views of the same network, never two sources of truth: both read the
  // same schedule, the same flightStates and the same `cascColor`, so the
  // colour vocabulary is identical and switching is a change of geometry only.
  //
  // The flat map answers "where is this airport" and is the accessible surface
  // — every mark is a real focusable DOM node with a full-sentence name. The
  // globe answers "what shape does this disruption have", where great-circle
  // legs are the honest geometry; on a Mercator tile a transcon leg is drawn
  // as a straight line that lies about the path the aircraft flies.
  // Which basemap the console theme wants. Read from the resolved attribute
  // rather than from the hook's stored CHOICE, so "system" resolves correctly
  // and the map agrees with whatever the pre-paint script already stamped.
  const { resolved: consoleTheme } = useConsoleTheme()
  const lightBasemap = externalFeed || consoleTheme === "light"
  // Swap the module-level palette BEFORE any icon factory runs this render.
  // Called during render rather than in an effect on purpose: an effect fires
  // after paint, so the first frame after a theme switch would draw every
  // marker in the outgoing palette.
  setMapTheme(lightBasemap)

  const [view, setView] = useState<"map" | "globe">("map")
  useEffect(() => {
    try {
      const saved = localStorage.getItem("olus-map-view")
      if (saved === "globe" || saved === "map") setView(saved)
    } catch {}
  }, [])
  useEffect(() => { try { localStorage.setItem("olus-map-view", view) } catch {} }, [view])

  // 5s tick — smooth enough for dead reckoning, far fewer re-renders
  useEffect(() => {
    const t = setInterval(() => { if(!document.hidden)setNowMs(Date.now()) }, 5_000)
    return () => clearInterval(t)
  }, [])

  // One in-flight live fetch at a time: a hung request is aborted before the
  // next 15s poll fires, so slow-feed responses can never stack up.
  const liveAbort = useRef<AbortController | null>(null)
  const fetchLive = useCallback(async () => {
    liveAbort.current?.abort()
    const controller = new AbortController()
    liveAbort.current = controller
    const timer = window.setTimeout(() => controller.abort(), 13_000)
    setLoading(true)
    try {
      // Use the Vercel-native endpoint — Railway's IPs are blocked by OpenSky,
      // so /api/v1/flights/live (proxied to Railway) always times out in prod.
      // /api/flights-live now fetches keyless ADS-B data from api.adsb.lol on
      // Vercel's edge network (no OpenSky creds needed).
      const res = await fetch("/api/flights-live", { signal: controller.signal })
        .then((r) => r.json()) as { flights?: LiveFlight[] }
      const all: LiveFlight[] = res.flights || []
      // Prefer recognised airline traffic, but never at the cost of an empty
      // map: when the airline filter guts the feed (regional/int'l prefixes
      // missing from the lookup), fall back to everything with a callsign.
      const airlines = all.filter((f) => f.airline_iata && f.airline_name !== "Unknown")
      const flights = airlines.length >= 30 ? airlines : all
      // An empty poll (feed timeout / rate limit) must NOT wipe the fleet off
      // the map — keep showing the last snapshot; dead reckoning carries it.
      if (flights.length > 0) {
        setLiveFlights(flights, Date.now())
        setLastFetch(Date.now())
      }
    } catch { /* degrade — keep the previous snapshot on screen */ } finally {
      window.clearTimeout(timer)
      setLoading(false)
    }
  }, [setLiveFlights])

  useEffect(() => {
    if(externalFeed)return
    // Paint cached planes immediately (if fresh) so the map isn't empty while
    // the first live fetch runs, then refresh + poll.
    useSimulationStore.getState().hydrateLiveFromCache()
    fetchLive()
    const t = setInterval(() => { if(!document.hidden)void fetchLive() }, 15_000)
    return () => { clearInterval(t); liveAbort.current?.abort() }
  }, [fetchLive,externalFeed])

  // ── Live traffic as the simulation stem — post the current ADS-B
  //    snapshot to the API, which rebuilds the working schedule from it so
  //    events/cascade/recovery solve over REAL current traffic. Posting an
  //    empty list restores the Nimbus YAML network. ──
  const seedFromLive = useCallback(async () => {
    if(readOnlyRun)return
    setSeeding(true)
    try {
      const body = liveSeeded
        ? { flights: [] }
        : {
            flights: liveFlights.slice(0, 150).map((f) => ({
              callsign: f.callsign,
              airline_iata: f.airline_iata,
              lat: f.lat,
              lon: f.lon,
              heading: f.heading,
              velocity_kt: f.velocity_kt,
              altitude_ft: f.altitude_ft,
            })),
          }
      const res = await apiClient.post<{ status: string; flights: number; schedule: ScheduledFlight[] }>(
        "/simulator/reseed-live",
        body,
      )
      setSchedule(res.data.schedule ?? [])
      setLiveSeeded(res.data.status === "reseeded")
    } catch {
      /* API unreachable — leave the current schedule alone */
    } finally {
      setSeeding(false)
    }
  }, [liveSeeded, liveFlights, setSchedule, readOnlyRun])

  const fetchFAA = useCallback(async () => {
    try {
      const res = await apiClient.get<{
        programs?: Array<{ airport_icao?: string; type: "ground_stop" | "ground_delay_program" | "departure_delay"; avg_delay_minutes?: number; reason?: string }>
      }>("/live/faa-status")
      const map: Record<string, FAAStatus> = {}
      for (const p of res.data.programs || []) {
        const icao = p.airport_icao; if (!icao) continue
        const rank = (t: string) => t === "ground_stop" ? 3 : t === "ground_delay_program" ? 2 : 1
        const cur = map[icao]
        if (!cur || rank(p.type) > rank(cur.type))
          map[icao] = { type: p.type, delay_minutes: p.avg_delay_minutes ?? 0, reason: p.reason ?? "" }
      }
      setAirportFAA(map)
    } catch { /* noop */ }
  }, [])

  const fetchWx = useCallback(async () => {
    try {
      const res = await apiClient.get<{
        alerts?: Array<{ event: string; headline?: string; affected_nimbus_airports?: string[] }>
      }>("/live/weather-alerts")
      const map: Record<string, string> = {}
      for (const a of res.data.alerts || []) {
        for (const icao of (a.affected_nimbus_airports || [])) {
          if (!map[icao]) map[icao] = `${a.event}${a.headline ? " — " + a.headline : ""}`
        }
      }
      setWxAirports(map)
    } catch { /* noop */ }
  }, [])

  useEffect(() => {
    fetchFAA(); fetchWx()
    const t1 = setInterval(fetchFAA, 90_000)
    const t2 = setInterval(fetchWx, 120_000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [fetchFAA, fetchWx])


  // Deduplicated active events (fixes duplicate key warning)
  const dedupEvents = useMemo(
    () => [...new Map(activeEvents.map((e) => [e.id, e])).values()],
    [activeEvents]
  )

  const visualPlanId=previewPlanId??appliedPlanId
  // Applied recovery plan sets — strictly derived from the plan dict so the
  // inspector card can keep its distinction between "cancelled by plan" and
  // "grounded by cascade".
  const applied = useMemo(() => {
    const plan = visualPlanId ? recoveryPlans.find((p) => p.plan_id === visualPlanId) : null
    const delayed = new Map<string, number>()
    for (const d of plan?.delayed_flights || []) delayed.set(d.flight_id, d.delay_minutes)
    return {
      cancelled: new Set<string>(plan?.cancelled_flights || []),
      swap:      new Set<string>((plan?.aircraft_swaps || []).map((s: any) => s.flight_id)),
      delayed,
    }
  }, [visualPlanId, recoveryPlans])

  // Visual cancellation set — union of:
  //
  //   (a) `applied.cancelled` — the currently-selected plan's own list (fast
  //        optimistic update when the operator switches plans);
  //
  //   (b) every flight backend-marked status="cancelled" THAT IS NOT STAMPED
  //        WITH A DIFFERENT PLAN'S applied_plan_id.
  //
  // Clause (b) is the critical filter. After applying Plan A, flight_states
  // entries for A's cancelled flights carry `status="cancelled"` AND
  // `applied_plan_id="A"`. When the operator clicks Plan B, the FRONTEND
  // optimistically flips visualPlanId to "B" before the WS broadcast
  // arrives. Without the filter, those Plan-A-stamped flights stay in the
  // visuallyCancelled set during the gap — the map shows Plan A's grey
  // lines PLUS Plan B's grey lines, so the switch reads as "nothing
  // changed". With the filter, anything stamped by Plan A is excluded the
  // instant visualPlanId moves to "B" (it'll be restored by the snapshot
  // revert on the backend anyway, so we're just front-running that revert).
  //
  // Cascade-cancelled flights (no `applied_plan_id` at all) are always
  // included — they're genuinely not operating regardless of plan choice.
  const visuallyCancelled = useMemo(() => {
    const set = new Set<string>(applied.cancelled)
    for (const fid in flightStates) {
      const s = flightStates[fid]
      if (s?.status !== "cancelled") continue
      const stampedBy = s.applied_plan_id ?? null
      // Include if: cascade-cancelled (no stamp) OR stamped by the plan we
      // currently have selected. Exclude if stamped by a stale plan.
      if (stampedBy == null || stampedBy === visualPlanId) {
        set.add(fid)
      }
    }
    return set
  }, [applied.cancelled, flightStates, visualPlanId])

  const activePlan = visualPlanId ? recoveryPlans.find((p: RecoveryPlan) => p.plan_id === visualPlanId) ?? null : null

  // Sim event epicenter airports
  const simEvtAirports = useMemo(() => {
    const s = new Set<string>()
    for (const e of dedupEvents) {
      const p = e.params || {}
      if (p.airport)             s.add(p.airport)
      if (p.base)                s.add(p.base)
      if (p.destination_airport) s.add(p.destination_airport)
    }
    return s
  }, [dedupEvents])

  const hasActiveEvents = dedupEvents.length > 0

  // Auto-enable Nimbus sim overlay the first time an event fires
  useEffect(() => {
    if (hasActiveEvents) setShowSimulation(true)
  }, [hasActiveEvents, setShowSimulation])

  // Color by cascade/plan state.
  //
  // Cancellation is checked FIRST against the visual union set — any flight
  // marked status="cancelled" by the backend (whether from the cascade
  // predictor or from an applied plan) reads grey. Swap and delayed only
  // fire after the operator explicitly applies a plan.
  function cascColor(fid: string, state: any): string {
    if (visuallyCancelled.has(fid))        return MAP_COLORS.planCancelled
    if (applied.swap.has(fid))             return MAP_COLORS.planSwap
    if (applied.delayed.has(fid))          return MAP_COLORS.planDelayed
    if (!state || state.cascade_order < 0) return MAP_COLORS.unaffected
    if (state.cascade_order === 0)         return MAP_COLORS.cascadeDirect
    if (state.cascade_order === 1)         return MAP_COLORS.cascadeOrder1
    if (state.cascade_order >= 2)          return MAP_COLORS.cascadeOrder2
    return MAP_COLORS.unaffected
  }

  // Impact routes
  //
  // `kind` drives both the visual treatment AND the click affordance:
  //   "cancelled" → grey + dashed + low opacity, still clickable so users can
  //                 inspect why the flight was cut.
  //   "swap"      → green + animated flowing-dash CSS class (.ae-route-flow)
  //                 to signal "active reroute / new assignment".
  //   "delayed"   → peach, solid.
  //   "cascade"   → coral/mustard/yellow per cascade order — no plan applied yet.
  type RouteKind = "cancelled" | "swap" | "delayed" | "cascade"
  type ImpactRoute = {
    id: string
    from: [number, number]
    to:   [number, number]
    color: string
    weight: number
    opacity: number
    dashed: boolean
    kind:  RouteKind
  }
  const { impactRoutes, impactIds } = useMemo(() => {
    const routes: ImpactRoute[] = []
    const ids = new Set<string>()
    for (const f of schedule) {
      const state = flightStates[f.id]
      // Use the visual union set (plan-cancellations + status="cancelled"
      // from the backend) so cascade-cancelled flights also render grey.
      const isCancelled = visuallyCancelled.has(f.id)
      const isSwap      = applied.swap.has(f.id)
      const isDelayed   = applied.delayed.has(f.id)
      const isAffected  = state && (state.cascade_order >= 0 || isCancelled || isDelayed || isSwap)
      if (!isAffected) continue
      const o = NIMBUS_AIRPORTS[f.origin], d = NIMBUS_AIRPORTS[f.destination]
      if (!o || !d) continue

      const sel = selectedFlight === f.id

      // Pick the kind in priority order: cancelled > swap > delayed > cascade.
      const kind: RouteKind =
        isCancelled ? "cancelled" :
        isSwap      ? "swap"      :
        isDelayed   ? "delayed"   :
                      "cascade"

      const color =
        kind === "cancelled" ? MAP_COLORS.planCancelled :
        kind === "swap"      ? MAP_COLORS.planSwap :
        kind === "delayed"   ? MAP_COLORS.planDelayed :
                                cascColor(f.id, state)

      // Cancelled flights deliberately read as MUTED — same line geometry so
      // they remain clickable, but lower weight + opacity so live re-routes
      // visually dominate.
      const weight =
        kind === "cancelled" ? (sel ? 3 : 1.6) :
        kind === "swap"      ? (sel ? 4 : 3.2) :   // a touch heavier so the new route reads as primary
        sel                  ? 4 :
        state?.cascade_order === 0 ? 2.5 : 2

      const opacity =
        kind === "cancelled" ? (sel ? 0.65 : 0.35) :
        kind === "swap"      ? (sel ? 1.0  : 0.92) :
        sel                  ? 1 :
        state?.cascade_order === 0 ? 0.85 : 0.60

      routes.push({
        id: f.id,
        from: [o.lat, o.lon],
        to:   [d.lat, d.lon],
        color,
        weight,
        opacity,
        // Swap routes get a dash too, but a SHORT one — combined with the
        // CSS animation that walks `stroke-dashoffset` it reads as a
        // flowing beam, not a static dashed line.
        dashed: kind === "cancelled" || kind === "swap",
        kind,
      })
      ids.add(f.id)
    }
    return { impactRoutes: routes, impactIds: ids }
  }, [flightStates, schedule, selectedFlight, applied]) // eslint-disable-line react-hooks/exhaustive-deps

  // `applyEpoch` increments every time the applied-action sets change OR
  // the visual cancellation set grows (cascade-cancelled flights arriving
  // from the backend). Used as a React key on the Polyline layer below so
  // changes force a remount, triggering the fade-in / draw-on animation.
  const applyEpoch = useMemo(
    () => `${visualPlanId ?? "none"}:${visuallyCancelled.size}:${applied.delayed.size}:${applied.swap.size}`,
    [visualPlanId, applied, visuallyCancelled],
  )

  // Simulated Nimbus aircraft.
  //
  // Every scheduled flight is ALWAYS visible, looping continuously along
  // its leg (progress wraps modulo 1). The previous time-window gating hid
  // most of the fleet for most of the 6-minute day cycle, which read as
  // "the planes disappeared" until you zoomed into the few survivors.
  const simPlanes = useMemo(() => {
    if (!showSimulation) return []
    // During an active disruption, the map declutters to the AFFECTED fleet
    // only — showing all 300+ nominal legs while the operator is working one
    // event is noise. No event → the full schedule flies as usual.
    const affectedOnly = hasActiveEvents && impactIds.size > 0
    const source = affectedOnly ? schedule.filter((f) => impactIds.has(f.id)) : schedule
    const cycle = 60 * 6, phase = ((nowMs / 1000) % cycle) / cycle, hr = 6 + phase * 18
    return source.flatMap((f) => {
      const o = NIMBUS_AIRPORTS[f.origin], d = NIMBUS_AIRPORTS[f.destination]
      if (!o || !d) return []
      const dep = isoToHour(f.scheduled_departure), arr = isoToHour(f.scheduled_arrival)
      const dur = arr > dep ? arr - dep : 1.5
      let t = ((hr - dep) / dur) % 1
      if (t < 0) t += 1
      const [lat, lon] = interp(o.lat, o.lon, d.lat, d.lon, Math.max(0.02, Math.min(0.98, t)))
      return [{ id: f.id, f, lat, lon, brg: bearing(o.lat, o.lon, d.lat, d.lon), t: Math.max(0.02, Math.min(0.98, t)) }]
    })
  }, [schedule, nowMs, showSimulation, hasActiveEvents, impactIds])

  // The globe takes the SAME fleet, at the same instant, with the same colours.
  // It needs `t` along the leg rather than a lat/lon, because it interpolates on
  // the great circle rather than on a flat line between two points — that is the
  // whole reason the second view exists.
  const globeFlights = useMemo<GlobeFlight[]>(
    () => simPlanes.map(({ id, f, t }) => ({
      id, f, t,
      color: cascColor(id, flightStates[id]),
      cancelled: visuallyCancelled.has(id),
      state: flightStates[id],
      // What an applied plan did to this leg. Resolved from the SAME `applied`
      // sets `cascColor` reads, so the globe's track and the aircraft's colour
      // can never disagree about whether a leg was re-routed.
      action: visuallyCancelled.has(id) ? "cancelled"
        : applied.swap.has(id) ? "swapped"
        : applied.delayed.has(id) ? "delayed"
        : null,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simPlanes, flightStates, visuallyCancelled, applied],
  )

  // Selected flight arc
  const selectedSched = selectedFlight ? schedule.find((f) => f.id === selectedFlight) ?? null : null
  const selectedArc = useMemo(() => {
    if (!selectedSched) return null
    const o = NIMBUS_AIRPORTS[selectedSched.origin], d = NIMBUS_AIRPORTS[selectedSched.destination]
    if (!o || !d) return null
    return arcPoints(o.lat, o.lon, d.lat, d.lon)
  }, [selectedSched])

  const selState = selectedSched ? flightStates[selectedSched.id] : undefined
  const selArcColor = selectedSched
    ? visuallyCancelled.has(selectedSched.id) ? MAP_COLORS.planCancelled
    : applied.swap.has(selectedSched.id)      ? MAP_COLORS.planSwap
    : applied.delayed.has(selectedSched.id)   ? MAP_COLORS.planDelayed
    : selState?.cascade_order === 0 ? MAP_COLORS.cascadeDirect
    : selState?.cascade_order != null && selState.cascade_order >= 1 ? MAP_COLORS.cascadeOrder1
    : MAP_COLORS.liveSelected
    : MAP_COLORS.liveSelected

  const focusTarget: ScheduledFlight | LiveFlight | null = selectedSched || selectedLiveFlight
  const ageSec = lastFetch ? Math.round((nowMs - lastFetch) / 1000) : null

  // Focus mode — selecting a scheduled OR live flight blurs the basemap and
  // dims every other layer; the selected route + endpoints re-render into the
  // ae-focus panes so they stay crisp. Reverts on deselect.
  const focusMode = !!selectedSched || !!selectedLiveFlight
  const selPlane = selectedSched ? simPlanes.find((p) => p.id === selectedSched.id) ?? null : null
  const [showAircraft, setShowAircraft] = useState(false)
  useEffect(() => { setShowAircraft(false) }, [selectedFlight])

  /**
   * ESCAPE DISMISSES, from anywhere on the console.
   *
   * There was no Escape handling on the map at all: a selected flight could
   * only be cleared by finding its ✕ — which the projection switch was
   * covering — or by clicking the exact same marker again. Escape is the
   * universal "get me out of this" and its absence is what made a stuck flight
   * path feel unclosable.
   *
   * It unwinds ONE layer at a time, innermost first, so Escape never throws
   * away more context than the operator asked to leave. Bound to the window
   * rather than to the map, because focus is usually in a panel or on the body
   * by the time someone reaches for it — a handler on the canvas would only
   * work if you had already clicked the canvas.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // NOTE: this deliberately does NOT bail out when focus is in a text
      // field. The first version did, and it broke the common path: selecting
      // a flight from the search box leaves focus in that box, so Escape —
      // pressed to dismiss the flight you just opened — did nothing at all.
      // A selected flight dims the basemap and puts a card over the map; it is
      // the most modal thing on screen, so it outranks a search field's own
      // Escape. Once nothing is selected, Escape falls through untouched and
      // the search clears normally.
      if (showAircraft) { setShowAircraft(false); e.preventDefault(); return }
      if (selAirport) { setSelAirport(null); e.preventDefault(); return }
      if (selectedLiveFlight) { setSelectedLiveFlight(null); e.preventDefault(); return }
      if (selectedFlight) {
        onFlightSelect(null)
        // Take focus out of the search field too, otherwise the operator is
        // left typing into a box whose result they just dismissed.
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) t.blur()
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [showAircraft, selAirport, selectedLiveFlight, selectedFlight, onFlightSelect, setSelectedLiveFlight])

  // Live selection gets the LIGHT focus (no basemap blur, others just recede);
  // a scheduled-flight selection keeps the fuller blur-focus treatment.
  const focusClass = selectedLiveFlight ? " map-focus-live" : selectedSched ? " map-focus" : ""

  return (
    <div data-preview-plan={previewPlanId||""} className={`simulator-map-shell w-full h-full min-h-0 relative overflow-hidden isolate${focusClass}`}>
      {/* ── View switch ──────────────────────────────────────────────────
          Joins the top-right instrument column rather than claiming a new
          lane; DESIGN.md gives that corner one owner and the zoom buttons sit
          directly beneath it (see the `.leaflet-top.leaflet-right` offset in
          globals.css). A two-option segmented control, not an icon that
          toggles: an icon-only switch between two projections gives no way to
          tell which one you are looking at without reading the map itself. */}
      <div
        role="group"
        aria-label="Map projection"
        style={{
          position: "absolute", top: 12, right: 12, zIndex: 620,
          display: "flex", padding: 3, gap: 3, borderRadius: 10,
          background: GLASS_STRONG, border: "1px solid var(--ae-line)",
          boxShadow: "var(--ae-shadow-card)",
        }}
      >
        {([["map", "Map"], ["globe", "Globe"]] as const).map(([id, label]) => {
          const on = view === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-pressed={on}
              style={{
                // 34px tall, 56 wide — comfortably over the 24px floor, and the
                // pair reads as one instrument rather than two loose chips.
                minHeight: 34, minWidth: 56, padding: "0 10px", borderRadius: 7,
                border: "none", cursor: "pointer",
                // Weight follows state: the ACTIVE view owns the filled slab.
                background: on ? "var(--ae-text)" : "transparent",
                color: on ? "var(--ae-surface)" : "var(--ae-text-2)",
                fontFamily: "var(--ae-font-mono)", fontSize: 11, fontWeight: 600,
                letterSpacing: "0.06em", textTransform: "uppercase",
                transition: "background 140ms ease, color 140ms ease",
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* The inactive view is UNMOUNTED, not hidden. Leaflet keeps a tile
          queue, a resize observer and a marker layer alive as long as it is in
          the tree, and the globe runs its own rAF; leaving both up would spend
          two frame budgets to show one of them. */}
      {view === "globe" && (
        <GlobeView
          flights={globeFlights}
          selectedFlight={selectedFlight}
          onFlightSelect={onFlightSelect}
          eventAirports={simEvtAirports}
        />
      )}

      {view === "map" && (
      /* The named region wraps Leaflet rather than being Leaflet: with no
         explicit name, the container's accessible name is computed from its
         CONTENTS, and a screen reader announced this as
         "✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕✕" — one multiplication sign per
         cancelled flight marker. `MapContainerProps` has no `role`, so the
         landmark lives on a wrapper. */
      <div role="region" aria-label="Network map — airports and flights" style={{ position: "absolute", inset: 0 }}>
      <MapContainer
        center={[39.5, -98.0]} zoom={4} minZoom={2} maxZoom={14}
        zoomControl={false} scrollWheelZoom worldCopyJump={false} maxBounds={[[-85,-180],[85,180]]} maxBoundsViscosity={1}
        preferCanvas
        className="w-full h-full z-0"
      >
        <MapResizeFix />
        <ZoomControl position="topright" />
        {/* `dark_all`, not Positron — the console register's basemap.
            The reasoning that chose Positron over Voyager is unchanged and is
            why this is dark_all rather than a dark Voyager equivalent: the
            basemap must spend NO saturation on road classes or landuse, so the
            only chromatic things on the surface are the marks that carry
            operational meaning. dark_all is that same cartographic restraint
            inverted for the console floor.

            `ae-basemap` (globals.css) trims the tiles' native brightness and
            pushes them a few degrees toward the console's plum hue, so the map
            reads as part of the panel it sits in rather than a black rectangle
            pasted onto it. */}
        {/* The tile SET follows the console theme, not just the CSS filter — a
            filtered dark tile cannot become a light chart, and vice versa.
            `key` forces Leaflet to tear the layer down and rebuild it on a
            theme change; without it react-leaflet keeps the original layer and
            only the url prop changes, which leaves every already-cached tile
            from the previous theme on screen until it is panned out of view. */}
        <TileLayer
          key={lightBasemap ? "light" : "dark"}
          className="ae-basemap"
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          noWrap maxZoom={19}
          keepBuffer={4}
          updateWhenIdle={false}
          updateWhenZooming={false}
        />
        <ZoomTracker onZoom={setMapZoom} />
        <BoundsTracker onBounds={setMapBounds} />
        <FitBounds flights={schedule} />
        <FocusFlight target={focusTarget} />

        {/* Event epicenter — 3 concentric rings for visual depth */}
        {hasActiveEvents && Array.from(simEvtAirports).flatMap((icao) => {
          const ap = NIMBUS_AIRPORTS[icao]
          if (!ap) return []
          const c: [number, number] = [ap.lat, ap.lon]
          return [
            <Circle key={`ep0-${icao}`} center={c} radius={70_000}
              pathOptions={{ color: MAP_COLORS.eventEpicenter, weight: 2.5, opacity: 0.70, fillColor: MAP_COLORS.eventEpicenter, fillOpacity: 0.10 }} />,
            <Circle key={`ep1-${icao}`} center={c} radius={160_000}
              pathOptions={{ color: MAP_COLORS.eventEpicenter, weight: 1.5, opacity: 0.40, fillColor: MAP_COLORS.eventEpicenter, fillOpacity: 0.05, dashArray: "6 5" }} />,
            <Circle key={`ep2-${icao}`} center={c} radius={300_000}
              pathOptions={{ color: MAP_COLORS.eventEpicenter, weight: 1, opacity: 0.18, fillColor: MAP_COLORS.eventEpicenter, fillOpacity: 0.02, dashArray: "3 9" }} />,
          ]
        })}

        {/* Background Nimbus routes (unaffected). Hidden during an active
            disruption — only the affected legs + their routes stay on the
            map so the operator sees the event, not the whole network. */}
        {showSimulation && !hasActiveEvents && schedule.map((f) => {
          if (impactIds.has(f.id)) return null
          const o = NIMBUS_AIRPORTS[f.origin], d = NIMBUS_AIRPORTS[f.destination]
          if (!o || !d) return null
          const sel = selectedFlight === f.id
          return (
            <Polyline key={`bg-${f.id}`}
              positions={[[o.lat, o.lon], [d.lat, d.lon]]}
              /* The trajectory of an operating flight is blue for the same
                 reason its marker is — grey now means "not operating". */
              pathOptions={{ color: MAP_COLORS.unaffected, weight: sel ? 2 : 1, opacity: sel ? 0.75 : 0.34, dashArray: sel ? undefined : "2 6" }}
              eventHandlers={{ click: () => onFlightSelect(sel ? null : f.id) }}
            />
          )
        })}

        {/*
          Impact routes — one Polyline per affected flight.

          The `applyEpoch` is folded into the key so applying or unapplying a
          plan remounts the entire layer, triggering a CSS fade-in (declared
          in globals.css). Without this every Leaflet redraw is in-place and
          users perceive the apply as "nothing happened".

          Swap routes are tagged with the `ae-route-flow` class so the SVG
          path animates its stroke-dashoffset — reads as a flowing beam,
          communicating "active reroute" rather than a static dashed line.

          Cancelled routes stay on the layer (low opacity + dashed) and
          remain CLICKABLE so the user can still drill into a cancelled
          flight. The cursor stays pointer per Leaflet defaults.
        */}
        {impactRoutes.map((r) => {
          const className =
            r.kind === "swap"      ? "ae-route ae-route-flow" :
            r.kind === "cancelled" ? "ae-route ae-route-cancelled" :
                                     "ae-route"
          // Swap routes get a tighter dash so the animation reads like a
          // moving beam, not a long-segment crawl.
          const dashArray =
            r.kind === "swap"      ? "8 6" :
            r.kind === "cancelled" ? "10 6" :
                                     undefined
          return (
            <Polyline
              key={`imp-${applyEpoch}-${r.id}`}
              positions={[r.from, r.to]}
              pathOptions={{
                color:     r.color,
                weight:    r.weight,
                opacity:   r.opacity,
                dashArray,
                className,
              }}
              eventHandlers={{ click: () => onFlightSelect(selectedFlight === r.id ? null : r.id) }}
            />
          )
        })}

        {/* Focus panes — siblings of the dimmed overlay/marker panes, so
            everything rendered here stays crisp while the rest recedes. */}
        <Pane name="ae-focus-line" style={{ zIndex: 460 }} />
        <Pane name="ae-focus-marker" style={{ zIndex: 640 }} />

        {/* Selected flight — highlighted bezier arc in the focus pane */}
        {selectedArc && (
          <>
            {/* Soft underlayer */}
            <Polyline
              pane="ae-focus-line"
              positions={selectedArc}
              pathOptions={{ color: selArcColor, weight: 10, opacity: 0.14 }}
            />
            {/* Main arc — dashed if the selected flight is cancelled (by
                plan or by cascade), preserving the "non-operating" semantic. */}
            <Polyline
              pane="ae-focus-line"
              positions={selectedArc}
              pathOptions={{
                color: selArcColor, weight: 3.5, opacity: 0.95,
                dashArray: visuallyCancelled.has(selectedSched!.id) ? "12 7" : undefined,
              }}
            />
          </>
        )}

        {/* Selected flight — endpoints + aircraft re-rendered crisp above
            the dimmed layers while focus mode is active */}
        {focusMode && selectedSched && [selectedSched.origin, selectedSched.destination].map((icao) => {
          const ap = NIMBUS_AIRPORTS[icao]
          if (!ap) return null
          return (
            <Marker
              key={`focus-ap-${icao}`}
              pane="ae-focus-marker"
              position={[ap.lat, ap.lon]}
              icon={airportIcon(airportTier(icao), airportFAA[icao], icao in wxAirports, simEvtAirports.has(icao), false)}
              interactive={false}
            >
              <Tooltip direction="top" offset={[0, -14]} opacity={1} permanent>
                <span className="font-mono font-bold text-[11px]">
                  {icao === selectedSched.origin ? `${ap.iata} · departs` : `${ap.iata} · arrives`}
                </span>
              </Tooltip>
            </Marker>
          )
        })}
        {focusMode && selPlane && (
          <Marker
            pane="ae-focus-marker"
            position={[selPlane.lat, selPlane.lon]}
            icon={simIcon(
              cascColor(selPlane.id, flightStates[selPlane.id]),
              selPlane.brg, true,
              flightStates[selPlane.id]?.cascade_order ?? -1,
              visuallyCancelled.has(selPlane.id),
              applied.swap.has(selPlane.id),
            )}
            eventHandlers={{ click: () => onFlightSelect(null) }}
          />
        )}

        {/* Airport nodes */}
        {Object.entries(NIMBUS_AIRPORTS).map(([id, ap]) => (
          <Marker key={id} position={[ap.lat, ap.lon]}
            icon={airportIcon(airportTier(id), airportFAA[id], id in wxAirports, simEvtAirports.has(id), selAirport === id)}
            // Airports stay keyboard-reachable — 15 stops is navigable and
            // they are the operator's own network — but they need a real name.
            zIndexOffset={airportFAA[id] ? 1200 : airportTier(id) === "hub" ? 600 : airportTier(id) === "focus_city" ? 400 : 100}
            eventHandlers={named(
              `${ap.iata} — ${ap.name}, ${ap.city}. ${airportTier(id) === "hub" ? "Hub" : airportTier(id) === "focus_city" ? "Focus city" : "Spoke"}${airportFAA[id] ? `. FAA ${airportFAA[id].type.replace(/_/g, " ")}` : ""}`,
              { click: () => { setSelAirport(selAirport === id ? null : id); onFlightSelect(null); setSelectedLiveFlight(null) } },
            )}
          >
            <Tooltip direction="top" offset={[0, -14]} opacity={1}>
              <div>
                <div className="font-mono font-bold text-xs">{ap.iata} · {id}</div>
                <div className="text-[11px] text-muted-foreground">{ap.name}, {ap.city}</div>
                {airportFAA[id] && (
                  <div className="text-[11px] font-semibold mt-0.5" style={{ color: airportFAA[id].type === "ground_stop" ? "var(--ae-rust-ink)" : "var(--ae-amber-ink)" }}>
                    {airportFAA[id].type === "ground_stop" ? "Ground stop"
                      : airportFAA[id].type === "ground_delay_program" ? `GDP +${airportFAA[id].delay_minutes}m`
                      : `+${airportFAA[id].delay_minutes}m dep delay`}
                  </div>
                )}
                {id in wxAirports && <div className="text-[11px]" style={{ color: "var(--ae-amber-ink)" }}>WX alert</div>}
                {simEvtAirports.has(id) && <div className="text-[11px] font-semibold" style={{ color: "var(--ae-rust-ink)" }}>Disruption epicenter</div>}
              </div>
            </Tooltip>
          </Marker>
        ))}

        {/* Simulated Nimbus aircraft — the markers along the route lines.
            Cancelled aircraft are drawn muted (grey, ✕ badge, low z-index)
            but stay clickable so users can inspect why a leg was cut.
            Swapped aircraft are drawn in the green reroute palette so the
            "new assignment" reads at a glance. */}
        {simPlanes.map(({ id, f, lat, lon, brg }) => {
          const state = flightStates[id]
          const sel = selectedFlight === id
          // Use the visual union: any flight with status="cancelled" reads
          // grey + ✕ on the marker too, not just plan-cancelled ones.
          const isCancelled = visuallyCancelled.has(id)
          const isSwap      = applied.swap.has(id)
          const cascOrder = state?.cascade_order ?? -1
          return (
            <Marker
              key={`sim-${applyEpoch}-${id}`}
              position={[lat, lon]}
              icon={simIcon(cascColor(id, state), brg, sel, cascOrder, isCancelled, isSwap)}

              // Cancelled markers sink to the bottom of the z-stack so live
              // operating planes always render on top.
              zIndexOffset={
                isCancelled ? 50 :
                sel         ? 2000 :
                isSwap      ? 900 :
                cascOrder === 0 ? 800 :
                cascOrder >= 1  ? 500 :
                                  200
              }
              // Owned fleet, so keyboard-reachable — but severity was carried
              // by marker colour alone, which a screen reader cannot see. The
              // cascade state is now in the accessible name too.
              eventHandlers={named(
                `${id}, ${f.origin} to ${f.destination}. ${
                  isCancelled ? "Cancelled"
                  : cascOrder === 0 ? "Direct hit"
                  : cascOrder === 1 ? "First-order cascade"
                  : cascOrder >= 2 ? "Second-order cascade"
                  : "On time"
                }${isSwap ? ", aircraft swapped" : ""}${state?.delay_minutes ? `, delayed ${state.delay_minutes} minutes` : ""}`,
                { click: () => onFlightSelect(sel ? null : id) },
              )}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                <div>
                  <div className="font-mono font-bold text-xs">{id} <span className="text-[11px] font-semibold" style={{ color: "var(--ae-text-3)" }}>[SIM]</span></div>
                  <div className="text-[11px] text-muted-foreground">{f.aircraft_id} · {f.origin} → {f.destination}</div>
                  {state?.delay_minutes > 0 && <div className="text-[11px] font-semibold" style={{ color: "var(--ae-amber-ink)" }}>+{state.delay_minutes} min delay</div>}
                  {state?.cascade_order === 0 && !isCancelled && <div className="text-[11px] font-semibold" style={{ color: "var(--ae-rust-ink)" }}>Direct impact</div>}
                  {isCancelled && (
                    <div className="text-[11px] font-bold" style={{ color: MAP_COLORS.planCancelledInk }}>
                      ✕ Cancelled by plan — click to inspect
                    </div>
                  )}
                  {isSwap && (
                    <div className="text-[11px] font-bold" style={{ color: MAP_COLORS.planSwap }}>
                      ↕ Re-routed · new aircraft assigned
                    </div>
                  )}
                </div>
              </Tooltip>
            </Marker>
          )
        })}

        {/* Live airline aircraft — viewport culled. Auto-hidden while a
            disruption is active so the ADS-B sea doesn't bury the affected
            Nimbus fleet; re-appears once the event clears. */}
        {showLiveFlights && (externalFeed || !hasActiveEvents) && <LiveTrafficLayer planes={liveFlights} selected={selectedLiveFlight?.icao24} onSelect={lf=>{onFlightSelect(null);setSelectedLiveFlight(lf);setSelAirport(null)}} />}
      </MapContainer>
      </div>
      )}

      {/* ── Overlay panels ── */}

      {/* Recovery plan banner — top of map when plan applied */}
      {!externalFeed && activePlan && !previewPlanId && <RecoveryBanner plan={activePlan} onUnapply={() => applyPlan(null)} />}

      {/* Disruption banner — top-left */}
      {!externalFeed && !activePlan && (
        <DisruptionBanner events={dedupEvents} impactCount={impactRoutes.length} summary={cascadeSummary} />
      )}

      {/* When plan is active, show compact event list at top-left */}
      {!externalFeed && activePlan && hasActiveEvents && (
        <div className="absolute top-3 left-3 z-[450]" style={{ maxWidth: 240 }}>
          <div
            className="rounded-lg px-3 py-2"
            style={{
              background: GLASS, backdropFilter: "blur(12px)",
              border: "1px solid var(--ae-line)",
              borderLeft: "2px solid var(--ae-rust)",
            }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "var(--ae-rust-ink)" }}>
              {dedupEvents.length} disruption{dedupEvents.length !== 1 ? "s" : ""} active
            </div>
            {dedupEvents.slice(0, 2).map((ev) => (
              <div key={ev.id} className="flex items-center gap-1.5 text-[11px] mb-0.5" style={{ color: "var(--ae-text-2)" }}>
                <EventIcon kind={ev.kind} className="w-3 h-3 shrink-0" style={{ color: "var(--ae-text-3)" }} />
                <span className="truncate">{EVENT_LABELS[ev.kind] ?? ev.kind.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FLIGHT DETAIL MOVED OUT, 2026-08-16.
          Both inspectors — LivePanel for an ADS-B contact and FlightDetailCard
          for a scheduled leg — used to render here as overlays on the map's
          top-left lane. They now render in the console's context column
          (components/simulator/flight-detail.tsx), for the reason recorded
          there: the most detailed surface on the console should not sit on top
          of the surface it is describing. Selecting a flight anywhere still
          opens the detail, it just opens BESIDE the map instead of over it,
          which also frees the top-left lane for the disruption banner and
          retires two of the overlay collisions the audit measured.

          `LivePanel` and `FlightDetailCard` are intentionally left defined
          below for now — the secondary /simulator/cascade/[flightId] route
          still renders the scheduled card. */}

      {/* Aircraft seat-map modal */}
      {showAircraft && selectedSched && (
        <AircraftDetail flight={selectedSched} onClose={() => setShowAircraft(false)} />
      )}

      {/* Airport panel */}
      {selAirport && !selectedLiveFlight && !selectedSched && (
        <AirportPanel
          icao={selAirport} faa={airportFAA[selAirport]}
          hasWx={selAirport in wxAirports} wxText={wxAirports[selAirport] || ""}
          simAffected={simEvtAirports.has(selAirport)} onClose={() => setSelAirport(null)}
        />
      )}

      {/* Layer toggles — bottom-LEFT (the bottom-right is owned by the fixed
          Ask-Olus bubble; keeping them apart avoids the overlap). */}
      {/* Legend — bottom-CENTRE, and centred for a specific reason: the two
          floating panels are inset from the left and right map edges at z-640,
          either can be open, and the legend sits at z-400. Bottom-left put it
          under Events (which opens by default, so the key to the map's whole
          encoding was invisible on load); bottom-right put it under Recovery
          (which auto-opens the moment plans arrive). The centre lane is the
          only horizontal band both panels leave clear.
          Opaque, not glass: a blurred panel over tiles ranging from pale land
          to mid-blue water gave its own labels a contrast ratio that changed
          with whatever happened to be underneath. */}
      <details
        className="ae-map-legend absolute z-[400] hidden sm:block"
        style={{ bottom: 12, left: "50%", transform: "translateX(-50%)" }}
      >
        {/* A <details> rather than an always-open card, for two reasons: a
            16-item key permanently occupying the map is clutter on a surface
            where every element has to earn its pixel, and collapsed it cannot
            collide with either floating panel no matter which is open. Native
            element, so the disclosure is keyboard-operable and announced
            without any JS or ARIA of ours. Opens upward via bottom-anchoring. */}
        <summary
          className="px-3 rounded-lg text-[11px] font-semibold uppercase"
          style={{
            background: "var(--ae-surface)", border: "1px solid var(--ae-line)",
            boxShadow: "var(--ae-shadow-card)", color: "var(--ae-text-2)",
            letterSpacing: "0.14em", fontFamily: "var(--ae-font-mono)",
            minHeight: 28, display: "inline-flex", alignItems: "center", gap: 6,
            cursor: "pointer", listStyle: "none", width: "fit-content", margin: "0 auto",
          }}
        >
          Layers &amp; key
        </summary>
        <div
          className="px-3 py-2 rounded-lg text-[11px]"
          style={{
            position: "absolute", bottom: 34, left: "50%", transform: "translateX(-50%)",
            // 360px caps the opened panel inside the ~432px lane the two
            // floating panels leave clear at 1280; wider and its right edge
            // slid under Recovery, which outranks it in z-order. It wraps.
            width: "max-content", maxWidth: 360,
            // Holds layers AND key now, and the map is a 300px locator, so the
            // opened panel has to be bounded or it runs past the map's top edge
            // and under the search bar.
            // 186, not 236. The map is capped at 300px and the search bar owns
            // y72-116 across the centre; a panel expanding upward from
            // bottom:12 with maxHeight 236 reached y=78 and put its first key
            // row under the search at EVERY viewport (measured 233x38, or
            // 316x38 during a disruption). 186 lands its top at ~162, clear of
            // the band. Both are centred on the same narrow map, so height is
            // the only lever that works at all widths.
            maxHeight: 186, overflowY: "auto",
            background: "var(--ae-surface)", border: "1px solid var(--ae-line)", boxShadow: "var(--ae-shadow-card-elev)",
          }}
        >
          {/* Map LAYERS live here too, not in their own floating stack. As a
              separate cluster they needed a lane of their own, and on a 300px
              locator there is no free lane left: bottom-left collided with the
              disruption card by 48px and bottom-right with Leaflet's zoom
              controls by 58px. Layers and key are the same concern anyway —
              what is drawn, and what it means — so one disclosure holds both. */}
          <div className="flex flex-col gap-1.5 text-[11px] mb-1.5 pb-1.5 border-b border-border/40 items-start">
        <div
          className="rounded-lg px-3 py-2 flex flex-col gap-1.5 text-[11px]"
          style={{ background: "var(--ae-surface-2)",  border: "1px solid var(--ae-line)" }}
        >
          {/* Layer toggles — swatch = the layer's actual mark color (data
              link); on/off is carried by text, not a status dot. */}
          <button
            onClick={() => setShowLiveFlights(!showLiveFlights)}
            className="flex items-center gap-2 font-medium transition-colors"
            style={{
              // minHeight 26: these read as text rows but they are toggles, and
              // at their intrinsic 17px they failed the WCAG 2.5.8 target size.
              minHeight: 32,
              // Auto-hidden while a disruption is active (affected-only view),
              // so it reads as muted/struck even though the toggle stays on.
              color: showLiveFlights && (externalFeed || !hasActiveEvents) ? "var(--ae-text)" : "var(--ae-text-3)",
              textDecoration: showLiveFlights && (externalFeed || !hasActiveEvents) ? "none" : "line-through",
            }}
          >
            <span
              className="w-3 h-1 rounded-full shrink-0"
              style={{ background: showLiveFlights && (externalFeed || !hasActiveEvents) ? MAP_COLORS.live : "var(--ae-line-strong)" }}
            />
            <span>Real flights (ADS-B)</span>
            {hasActiveEvents && !externalFeed ? (
              <span className="text-[11px] font-semibold" style={{ color: "var(--ae-text-3)" }}>
                hidden during event
              </span>
            ) : showLiveFlights && liveFlights.length > 0 && (
              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full font-mono tabular-nums" style={{ background: "var(--ae-neutral-bg)", color: "var(--ae-text-2)" }}>
                {liveFlights.length.toLocaleString()}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowSimulation(!showSimulation)}
            className="flex items-center gap-2 font-medium transition-colors"
            style={{
              minHeight: 32, // WCAG 2.5.8 target size — was 18px
              color: showSimulation ? "var(--ae-text)" : "var(--ae-text-3)",
              textDecoration: showSimulation ? "none" : "line-through",
            }}
          >
            <span
              className="w-3 h-1 rounded-full shrink-0"
              style={{ background: showSimulation ? "var(--ae-teal)" : "var(--ae-line-strong)" }}
            />
            <span>Nimbus Air sim</span>
            {showSimulation && simPlanes.length > 0 && (
              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full font-mono tabular-nums" style={{ background: "var(--ae-teal-bg)", color: "var(--ae-teal-ink)" }}>
                {simPlanes.length}
              </span>
            )}
          </button>

          {/* Live traffic as the sim stem — rebuild the working schedule
              from the current ADS-B snapshot (or restore the YAML network). */}
          <button
            onClick={seedFromLive}
            disabled={readOnlyRun || seeding || (!liveSeeded && liveFlights.length === 0)}
            className="flex items-center gap-2 font-semibold transition-colors disabled:opacity-40"
            title={liveSeeded
              ? "Restore the Nimbus YAML network"
              : "Rebuild the simulator schedule from the live planes on this map — events and recovery plans will run over real traffic"}
            style={{
              marginTop: 2,
              paddingTop: 6,
              minHeight: 32, // WCAG 2.5.8 target size — was 24px
              borderTop: "1px solid var(--ae-line)",
              color: liveSeeded ? "var(--ae-amber-ink)" : "var(--ae-teal-ink)",
            }}
          >
            <span
              className="font-mono text-[11px] font-bold tracking-widest uppercase"
              style={{
                borderBottom: `2px solid ${liveSeeded ? "var(--ae-amber)" : "var(--ae-teal)"}`,
                paddingBottom: 1,
              }}
            >
              {seeding ? "Seeding…" : liveSeeded ? "Live-seeded · restore Nimbus" : "Seed sim from live traffic"}
            </span>
          </button>
        </div>

        {/* ADS-B age — mono text, no status dot; the words carry the state */}
        {ageSec != null && (
          <div
            className="px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold tracking-wide"
            style={{
              background: "var(--ae-surface-2)",

              border: "1px solid var(--ae-line)",
              color: loading
                ? "var(--ae-text-3)"
                : liveFlights.length === 0
                ? "var(--ae-rust-ink)"
                : ageSec > 30
                ? "var(--ae-amber-ink)"
                : "var(--ae-text-3)",
            }}
          >
            {loading ? "ADS-B · FETCHING…" : liveFlights.length === 0 ? "ADS-B · NO FEED" : `ADS-B · ${ageSec}S AGO`}
          </div>
        )}
          </div>

          {/* Airport tiers — the operator's own network, and the reason all
              fifteen airports are now distinguishable from each other and
              from ambient traffic. */}
          <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="rounded-full shrink-0" style={{ width: 11, height: 11, background: MAP_COLORS.airportHub, border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.18)" }} />
              <span className="text-muted-foreground">Hub</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full shrink-0" style={{ width: 9, height: 9, background: MAP_COLORS.airportFocus, border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.18)" }} />
              <span className="text-muted-foreground">Focus city</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: MAP_COLORS.airportSpoke, border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.18)" }} />
              <span className="text-muted-foreground">Spoke</span>
            </div>
          </div>
          {/* Always-visible: live layer */}
          <div className="flex items-center gap-2.5 flex-wrap mb-1.5 border-t border-border/40 pt-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1 rounded-full" style={{ background: MAP_COLORS.live }} />
              <span className="text-muted-foreground">Other carriers</span>
            </div>
            <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: MAP_COLORS.groundStop }} /><span className="text-muted-foreground">GS</span></div>
            <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: MAP_COLORS.gdp }} /><span className="text-muted-foreground">GDP</span></div>
            <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: MAP_COLORS.weather, opacity: 0.6 }} /><span className="text-muted-foreground">WX</span></div>
          </div>
          {/* Disruption/plan legend — keyed off the canonical MAP_COLORS so
              the legend swatches always match the actual lines/markers on
              the canvas. Previously the swatches were inlined hex values
              (orange-400, #6366F1) that had drifted from the live palette. */}
          {(hasActiveEvents || appliedPlanId) && (
            <>
              <div className="border-t border-border/40 pt-1.5 mt-0.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Nimbus fleet status</div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: MAP_COLORS.unaffected }} />
                    <span className="text-muted-foreground">Operating</span>
                  </div>
                  {/* All three orders named. Listing only "Direct hit" and a
                      generic "Cascade" was the other half of the encoding bug:
                      order-2 marks were on the canvas with nothing explaining
                      them, and "Cascade" implied order-1's colour covered all
                      propagation. Labels match the timeline legend verbatim. */}
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: MAP_COLORS.cascadeDirect }} />
                    <span className="text-muted-foreground">Direct hit</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: MAP_COLORS.cascadeOrder1 }} />
                    <span className="text-muted-foreground">1st order</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: MAP_COLORS.cascadeOrder2, border: `1px solid ${cascade.order2.border}` }} />
                    <span className="text-muted-foreground">2nd order</span>
                  </div>
                  {appliedPlanId && (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center text-[8px] text-white font-bold"
                          style={{ background: MAP_COLORS.planCancelled, border: "1px dashed rgba(255,255,255,0.9)" }}
                        >✕</span>
                        <span className="text-muted-foreground">Cancelled</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: MAP_COLORS.planSwap, boxShadow: `0 0 0 2px ${MAP_COLORS.planSwap}40` }} />
                        <span className="text-muted-foreground">Re-routed</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: MAP_COLORS.planDelayed }} />
                        <span className="text-muted-foreground">Delayed</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </details>
    </div>
  )
}
