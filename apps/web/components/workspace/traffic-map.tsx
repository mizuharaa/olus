"use client"
import { useEffect, useRef, useState } from "react"
import * as maplibregl from "maplibre-gl"
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { toast } from "sonner"
import { useSimulationStore, type LiveFlight } from "@/stores/simulation"
import { NIMBUS_AIRPORTS } from "@/components/simulator/airports"
import { observeFlight, trackPosition, type FlightTrack } from "@/lib/flight-track"
import { deadReckon, deriveLive, arcPoints } from "@/lib/flight-derive"
import styles from "./workspace.module.css"

export default function TrafficMap({ compact = false, selected, onSelect, simulatedFlight, onAirport, airport, showLive=true, showNetwork=true }: { onAirport?:(id:string)=>void; airport?:string; showLive?:boolean; showNetwork?:boolean; simulatedFlight?:string; compact?: boolean; selected?: string; onSelect?: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map | null>(null)
  const flights = useSimulationStore(s => s.liveFlights), latest = useRef(flights), select = useRef(onSelect)
  const simulation=useSimulationStore(s=>({schedule:s.schedule,states:s.flightStates,events:s.activeEvents}))
  const sim=useRef(simulation); sim.current=simulation
  const simSelection=useRef(simulatedFlight);simSelection.current=simulatedFlight
  const airportClick=useRef(onAirport);airportClick.current=onAirport
  const selection = useRef(selected); selection.current = selected
  const [failure, setFailure] = useState("")
  const [ready, setReady] = useState(false)
  latest.current = flights; select.current = onSelect
  useEffect(() => {
    const node = host.current!; const tokens = getComputedStyle(node)
    const color = (name: string) => tokens.getPropertyValue(name).trim()
    const style: StyleSpecification = { version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf", sources: { world: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &middot; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } }, layers: [
      { id: "background", type: "background", paint: { "background-color": color("--map-land") } },
      { id: "water", type: "fill", source: "world", "source-layer": "water", paint: { "fill-color": color("--map-water") } },
      { id: "boundaries", type: "line", source: "world", "source-layer": "boundary", paint: { "line-color": color("--map-boundary"), "line-width": .7 } },
      { id: "roads", type: "line", source: "world", "source-layer": "transportation", minzoom: 5, paint: { "line-color": color("--map-road"), "line-width": ["interpolate",["linear"],["zoom"],5,.4,14,2] } },
      { id: "cities", type: "symbol", source: "world", "source-layer": "place", layout: { "text-field": ["coalesce",["get","name:en"],["get","name"]], "text-font": ["Noto Sans Regular"], "text-size": 12 }, paint: { "text-color": color("--ink-500"), "text-halo-color": color("--map-land"), "text-halo-width": 2 } },
    ] }
    let instance: maplibregl.Map
    try { instance = new maplibregl.Map({ container: node, style, center: [-97,38], zoom: compact ? 2.6 : 3.5, maxZoom: 16, minZoom: 2, renderWorldCopies:false, pixelRatio: Math.min(devicePixelRatio,2), attributionControl: { compact: true }, fadeDuration:0, interactive: !compact }) }
    catch { setFailure("Map unavailable. Use flight search to inspect traffic."); toast.info("Simplified view", { description: "WebGL is unavailable. Flight details remain accessible through search." }); return }
    map.current = instance
    if (!compact) instance.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right")
    instance.on("error", () => setFailure("Some map tiles could not load. Flight observations remain available through search."))
    let timer: ReturnType<typeof setInterval> | undefined
    const positions = new Map<string,[number,number]>()
    const observations = new Map<string, FlightTrack>()
    const contacts = new Map<string, LiveFlight>()
    const reduced = matchMedia("(prefers-reduced-motion: reduce)")
    instance.on("load", () => {
      setReady(true)
      const canvas = document.createElement("canvas"); canvas.width=64; canvas.height=64
      const ctx=canvas.getContext("2d")!;ctx.fillStyle=color("--map-route")
      // Geometric map symbol, drawn once into a shared sprite atlas.
      ctx.fill(new Path2D("M32 3Q36 5 36 12L36 26L58 40L58 45L36 37L35 52L43 57L43 61L32 58L21 61L21 57L29 52L28 37L6 45L6 40L28 26L28 12Q28 5 32 3Z"))
      instance.addImage("aircraft",ctx.getImageData(0,0,64,64))
      instance.addSource("traffic", { type: "geojson",  data: { type: "FeatureCollection", features: [] } })
      instance.addSource("simulation",{type:"geojson",data:{type:"FeatureCollection",features:[]}})
      instance.addLayer({id:"simulation-routes",type:"line",source:"simulation",filter:["==",["geometry-type"],"LineString"],paint:{"line-color":color("--map-disrupt"),"line-width":["case",["get","selected"],4,1.5],"line-opacity":["case",["get","selected"],1,.45]}})
      instance.addLayer({id:"simulation-hubs",type:"circle",source:"simulation",filter:["==",["geometry-type"],"Point"],paint:{"circle-radius":8,"circle-color":color("--map-disrupt"),"circle-stroke-color":color("--ink-700"),"circle-stroke-width":2}})
      instance.addSource("route", { type:"geojson", data:{type:"FeatureCollection",features:[]} })
      instance.addLayer({id:"observed-route",type:"line",source:"route",filter:["==",["get","kind"],"observed"],paint:{"line-color":color("--map-route"),"line-width":3}})
      instance.addLayer({id:"projected-route",type:"line",source:"route",filter:["==",["get","kind"],"projected"],paint:{"line-color":color("--map-route"),"line-width":3,"line-dasharray":[3,2]}})
      instance.addLayer({ id: "selection", type: "circle", source: "traffic", filter: ["==",["get","id"],""], paint: { "circle-radius": 18, "circle-color": color("--ink-800"), "circle-opacity": .5, "circle-stroke-color": color("--map-route"), "circle-stroke-width": 2 } })
      instance.addLayer({ id: "aircraft", type: "symbol", source: "traffic", filter:["!",["has","point_count"]], layout: { "icon-image":"aircraft", "icon-size":["interpolate",["linear"],["zoom"],2,.19,8,.4,14,.55], "icon-rotate":["get","heading"], "icon-rotation-alignment":"map", "icon-allow-overlap":true, "icon-ignore-placement":true }, paint: { "icon-opacity": ["case",["get","stale"],.35,.9] } })
      instance.addLayer({id:"selected-aircraft",type:"symbol",source:"traffic",filter:["==",["get","id"],""],layout:{"icon-image":"aircraft","icon-size":.45,"icon-rotate":["get","heading"],"icon-rotation-alignment":"map","icon-allow-overlap":true,"icon-ignore-placement":true}})
      instance.addSource("airports",{type:"geojson",data:{type:"FeatureCollection",features:Object.entries(NIMBUS_AIRPORTS).map(([id,a])=>({type:"Feature",properties:{id,label:a.iata},geometry:{type:"Point",coordinates:[a.lon,a.lat]}}))}})
      instance.addLayer({id:"airport-nodes",type:"circle",source:"airports",paint:{"circle-radius":6,"circle-color":color("--map-land"),"circle-stroke-color":color("--ink-700"),"circle-stroke-width":2}})
      instance.addLayer({id:"airport-labels",type:"symbol",source:"airports",layout:{"text-field":["get","label"],"text-font":["Noto Sans Regular"],"text-size":12,"text-offset":[0,1.4],"text-allow-overlap":true},paint:{"text-color":color("--ink-700"),"text-halo-color":color("--map-land"),"text-halo-width":2}})
      instance.on("click","airport-nodes",e=>{const id=e.features?.[0]?.properties?.id;if(id)airportClick.current?.(String(id))})
      instance.on("mouseenter","airport-nodes",()=>{instance.getCanvas().style.cursor="pointer"})
      instance.on("mouseleave","airport-nodes",()=>{instance.getCanvas().style.cursor=""})
      const paint = () => {
        if (document.hidden) return
        const now=Date.now()/1000
        for(const f of latest.current) {observations.set(f.icao24,observeFlight(observations.get(f.icao24),f));if(f.last_contact>=(contacts.get(f.icao24)?.last_contact??0))contacts.set(f.icao24,f)}
        for(const [id,f] of observations) if(now-f.last_contact>180 && id!==selection.current){observations.delete(id);positions.delete(id);contacts.delete(id)}
        const features: GeoJSON.Feature<GeoJSON.Point>[] = Array.from(observations,([id,observation]) => {
          const point=trackPosition(observation,now,reduced.matches)
          positions.set(id,point)
          return { type:"Feature",geometry:{type:"Point",coordinates:[point[1],point[0]]},properties:{id,heading:observation.heading||0,stale:now-observation.last_contact>60} }
        })
        const simulationFeatures:GeoJSON.Feature[]=[]
        for(const f of sim.current.schedule) {
          const state=sim.current.states[f.id], a=NIMBUS_AIRPORTS[f.origin],b=NIMBUS_AIRPORTS[f.destination]
          if(a&&b && (simSelection.current===f.id || (!simSelection.current && state?.cascade_order>=0))) simulationFeatures.push({type:"Feature",properties:{selected:simSelection.current===f.id},geometry:{type:"LineString",coordinates:[[a.lon,a.lat],[b.lon,b.lat]]}})
        }
        for(const e of sim.current.events) {
          const a=NIMBUS_AIRPORTS[e.params.airport||e.params.base]
          if(a) simulationFeatures.push({type:"Feature",properties:{},geometry:{type:"Point",coordinates:[a.lon,a.lat]}})
        }
        ;(instance.getSource("simulation") as GeoJSONSource)?.setData({type:"FeatureCollection",features:simulationFeatures})
        const current=observations.get(selection.current||"")
        const route:GeoJSON.Feature<GeoJSON.LineString>[]=[]
        if(current) {
          const observation=current, point=positions.get(selection.current||"")
          if(observation && observation.fixes.filter(f=>f.last_contact<=now-30).length>0) route.push({type:"Feature",properties:{kind:"observed"},geometry:{type:"LineString",coordinates:[...observation.fixes.filter(f=>f.last_contact<=now-30).map(f=>[f.lon,f.lat]),...(point?[[point[1],point[0]]]:[])]}})
          const live=contacts.get(selection.current||"")
          const inferred=live?deriveLive({...live,...current}).ahead:null
          if(point && inferred){const a=NIMBUS_AIRPORTS[inferred.icao];route.push({type:"Feature",properties:{kind:"projected"},geometry:{type:"LineString",coordinates:arcPoints(point[0],point[1],a.lat,a.lon).map(p=>[p[1],p[0]])}})}
          if(!inferred && point && current.heading!==null && current.velocity_kt!==null) {
            const coords=Array.from({length:31},(_,i)=>{const p=deadReckon(point[0],point[1],current.heading!,current.velocity_kt!,i*20,600);return [p[1],p[0]]})
            route.push({type:"Feature",properties:{kind:"projected"},geometry:{type:"LineString",coordinates:coords}})
          }
        }
        ;(instance.getSource("route") as GeoJSONSource)?.setData({type:"FeatureCollection",features:route})
        instance.setFilter("selection",["==",["get","id"],selection.current||""])
        instance.setFilter("selected-aircraft",["==",["get","id"],selection.current||""])
        ;(instance.getSource("traffic") as GeoJSONSource)?.setData({type:"FeatureCollection",features})
      }
      paint(); timer=setInterval(paint,100)
      instance.on("click",e => {
        if(instance.queryRenderedFeatures(e.point,{layers:["airport-nodes"]}).length)return
        const hits=instance.queryRenderedFeatures([[e.point.x-12,e.point.y-12],[e.point.x+12,e.point.y+12]],{layers:["selected-aircraft","aircraft"]})
        hits.sort((a,b)=>{const distance=(f:typeof a)=>{const p=instance.project((f.geometry as GeoJSON.Point).coordinates as [number,number]);return Math.hypot(p.x-e.point.x,p.y-e.point.y)};return distance(a)-distance(b)})
        const id=hits[0]?.properties?.id;if(id)select.current?.(String(id))
      })
      instance.on("mouseenter","aircraft",()=>{instance.getCanvas().style.cursor="pointer"})
      instance.on("mouseleave","aircraft",()=>{instance.getCanvas().style.cursor=""})
    })
    const resize = new ResizeObserver(()=>instance.resize());resize.observe(node)
    return () => { clearInterval(timer);resize.disconnect();instance.remove();map.current=null }
  }, [compact])
  useEffect(() => {
    const m=map.current;const f=latest.current.find(f=>f.icao24===selected)
    if (!m || !m.getLayer("selection")) return
    m.setFilter("selection",["==",["get","id"],selected||""])
    if(f){
      const ahead=deriveLive(f).ahead, a=ahead&&NIMBUS_AIRPORTS[ahead.icao]
      if(a)m.fitBounds([[Math.min(f.lon,a.lon),Math.min(f.lat,a.lat)],[Math.max(f.lon,a.lon),Math.max(f.lat,a.lat)]],{padding:{top:100,bottom:200,left:innerWidth>1100?360:80,right:innerWidth>700?400:40},maxZoom:7,duration:matchMedia("(prefers-reduced-motion: reduce)").matches?0:320})
      else m.easeTo({center:[f.lon,f.lat],zoom:Math.max(m.getZoom(),6),offset:[innerWidth>700?-180:0,0],duration:matchMedia("(prefers-reduced-motion: reduce)").matches?0:320})
    }
  }, [selected, ready])
  useEffect(()=>{
    const m=map.current,f=sim.current.schedule.find(f=>f.id===simulatedFlight)
    if(!m||!f)return
    const a=NIMBUS_AIRPORTS[f.origin],b=NIMBUS_AIRPORTS[f.destination]
    if(a&&b)m.fitBounds([[Math.min(a.lon,b.lon),Math.min(a.lat,b.lat)],[Math.max(a.lon,b.lon),Math.max(a.lat,b.lat)]],{padding:{top:100,bottom:200,left:innerWidth>1100?360:80,right:innerWidth>700?400:40},maxZoom:7,duration:matchMedia("(prefers-reduced-motion: reduce)").matches?0:320})
  },[simulatedFlight,ready])
  useEffect(()=>{
    const m=map.current;if(!m||!ready)return
    for(const id of ["aircraft","selected-aircraft","selection","observed-route","projected-route"])if(m.getLayer(id))m.setLayoutProperty(id,"visibility",showLive?"visible":"none")
    for(const id of ["simulation-routes","simulation-hubs","airport-nodes","airport-labels"])if(m.getLayer(id))m.setLayoutProperty(id,"visibility",showNetwork?"visible":"none")
  },[showLive,showNetwork,ready])
  useEffect(()=>{const a=airport&&NIMBUS_AIRPORTS[airport];if(a&&map.current)map.current.easeTo({center:[a.lon,a.lat],zoom:6,offset:[innerWidth>700?-180:0,0],duration:matchMedia("(prefers-reduced-motion: reduce)").matches?0:320})},[airport,ready])
  return <><div ref={host} className={styles.mapView} data-map-ready={ready} aria-label="Observed aircraft map"/>{!ready && !failure && <div className={styles.mapNotice} role="status">Loading vector map...</div>}{failure && <div className={styles.mapNotice} role="status">{failure}</div>}</>
}
