"use client"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { apiClient } from "@/lib/api"
import { deriveLive, cardinal } from "@/lib/flight-derive"
import { useWatchlist } from "@/lib/use-watchlist"
import { NIMBUS_AIRPORTS, airportTier } from "@/components/simulator/airports"
import { useSimulationStore, type LiveFlight, type ScheduledFlight } from "@/stores/simulation"
import styles from "./workspace.module.css"

export function LiveRoute({flight,onAirport}:{flight:LiveFlight;onAirport:(id:string)=>void}) {
  const d=deriveLive(flight), watch=useWatchlist()
  return <>
    <p>{d.phase.label} &middot; {flight.heading===null?"Track not reported":cardinal(flight.heading)}</p>
    <div className={styles.routeEndpoints}>
      <button disabled={!d.nearest} onClick={()=>d.nearest&&onAirport(d.nearest.icao)}><small>Nearest network airport</small><strong>{d.nearest?.icao||"Unavailable"}</strong><span>{d.nearest&&NIMBUS_AIRPORTS[d.nearest.icao].city}</span><small>{d.nearest&&`${Math.round(d.nearest.nm)} nm away`}</small></button>
      <button disabled={!d.ahead} onClick={()=>d.ahead&&onAirport(d.ahead.icao)}><small>Inferred arrival</small><strong>{d.ahead?.icao||"Unknown"}</strong><span>{d.ahead&&NIMBUS_AIRPORTS[d.ahead.icao].city}</span><small>{d.ahead&&`${Math.round(d.ahead.nm)} nm / ~${Math.round(d.ahead.etaMin)} min`}</small></button>
    </div>
    <p className={styles.modelNote}>Arrival is the nearest network airport within 55 degrees of track. It is an estimate, not a filed destination. Nearest airport is not necessarily the origin.</p>
    <div className={styles.flightActions}><button aria-pressed={watch.has(flight.icao24)} onClick={()=>watch.toggle(flight.icao24)}>{watch.has(flight.icao24)?"Watching":"Add to watchlist"}</button>{flight.tracking?.flightaware&&<a href={flight.tracking.flightaware} target="_blank" rel="noreferrer">FlightAware ↗</a>}{flight.tracking?.flightradar24&&<a href={flight.tracking.flightradar24} target="_blank" rel="noreferrer">Flightradar24 ↗</a>}<button onClick={()=>navigator.clipboard.writeText(flight.callsign||flight.icao24).then(()=>toast.success("Flight identifier copied")).catch(()=>toast.error("Could not copy flight identifier"))}>Copy ID</button></div>
  </>
}
const time=(s:string)=>{const d=new Date(s);return Number.isNaN(+d)?"Not provided":d.toISOString().slice(11,16)+"Z"}
export function ScheduledDetails({flight,onClose}:{flight:ScheduledFlight;onClose:()=>void}) {
  const {flightStates,fleet,schedule}=useSimulationStore(), state=flightStates[flight.id], watch=useWatchlist()
  const tail=flight.aircraft_id||flight.tail_number, aircraft=fleet.find(a=>a.id===tail)
  const downline=schedule.filter(f=>(f.aircraft_id||f.tail_number)===tail&&f.scheduled_departure>flight.scheduled_departure)
  return <aside className={styles.selectedFlight} aria-label="Scheduled flight"><div className={styles.dockHeading}><h2>{flight.id}</h2><button aria-label="Close scheduled flight" onClick={onClose}>×</button></div><p>Simulated schedule &middot; {state?.status||flight.status||"scheduled"}</p><div className={styles.routeEndpoints}><div><small>Departure</small><strong>{flight.origin}</strong><span>{NIMBUS_AIRPORTS[flight.origin]?.city}</span></div><div><small>Arrival</small><strong>{flight.destination}</strong><span>{NIMBUS_AIRPORTS[flight.destination]?.city}</span></div></div><dl>{[["Scheduled departure",time(flight.scheduled_departure)],["Scheduled arrival",time(flight.scheduled_arrival)],["Revised departure",state?.new_departure?time(state.new_departure):"Not returned"],["Delay",`${Math.round(state?.delay_minutes||0)} min`],["Aircraft",tail||"Not assigned"],["Type",aircraft?.type||"Not provided"],["Passengers",flight.passengers??"Not provided"],["Cascade depth",state?.cascade_order===undefined||state.cascade_order<0?"Unaffected":state.cascade_order],["Recovery action",state?.applied_action||"None"]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>{state?.reason&&<p>{state.reason}</p>}<h3>Downline flights</h3>{downline.length?<ul>{downline.map(f=><li key={f.id}>{f.id} · {f.origin} → {f.destination} · {time(f.scheduled_departure)}</li>)}</ul>:<p>No later legs for this tail.</p>}<div className={styles.flightActions}><button onClick={()=>watch.toggle(flight.id)}>{watch.has(flight.id)?"Watching":"Add to watchlist"}</button><Link href={`/simulator/cascade/${encodeURIComponent(flight.id)}`}>Cascade analysis ↗</Link><Link href="/simulator/crew">Crew legality ↗</Link></div></aside>
}
export function AirportDetails({id,onClose,onFlight,onDisrupt}:{id:string;onClose:()=>void;onFlight:(id:string)=>void;onDisrupt:(id:string)=>void}) {
  const {schedule,flightStates,activeEvents}=useSimulationStore(),a=NIMBUS_AIRPORTS[id]
  const faa=useQuery({queryKey:["airport-faa"],refetchInterval:90000,queryFn:async()=> (await apiClient.get<{programs?:{airport_icao?:string;type:string;avg_delay_minutes?:number;reason?:string}[]}>("/live/faa-status")).data})
  const wx=useQuery({queryKey:["airport-weather"],refetchInterval:120000,queryFn:async()=> (await apiClient.get<{alerts?:{event:string;headline?:string;affected_nimbus_airports?:string[]}[]}>("/live/weather-alerts")).data})
  const rows=schedule.filter(f=>f.origin===id||f.destination===id),programs=faa.data?.programs?.filter(p=>p.airport_icao===id)||[],alerts=wx.data?.alerts?.filter(p=>p.affected_nimbus_airports?.includes(id))||[]
  return <aside className={styles.selectedFlight} aria-label="Airport details"><div className={styles.dockHeading}><h2>{a.iata} / {id}</h2><button aria-label="Close airport" onClick={onClose}>×</button></div><p>{a.name}, {a.city} &middot; {airportTier(id).replaceAll("_"," ")}</p><h3>FAA status</h3>{faa.isError?<p>Feed unavailable. <button onClick={()=>faa.refetch()}>Retry FAA</button></p>:faa.isPending?<p>Loading FAA programs…</p>:programs.length?programs.map((p,i)=><p key={i}>{p.type.replaceAll("_"," ")} · {p.avg_delay_minutes===undefined?"Delay duration not reported":`${p.avg_delay_minutes} min`} · {p.reason}</p>):<p>No programs reported for this airport.</p>}<h3>Weather alerts</h3>{wx.isError?<p>Weather unavailable. <button onClick={()=>wx.refetch()}>Retry weather</button></p>:wx.isPending?<p>Loading weather…</p>:alerts.length?alerts.map((p,i)=><p key={i}>{p.event}: {p.headline}</p>):<p>No alerts returned for this airport.</p>}<h3>Simulation</h3><p>{activeEvents.filter(e=>e.params.airport===id||e.params.base===id).length} active events · {rows.filter(f=>flightStates[f.id]?.cascade_order>=0).length} affected legs</p><button className={styles.primary} onClick={()=>onDisrupt(id)}>Configure disruption here</button><h3>Scheduled movements ({rows.length})</h3><div className={styles.airportFlights}>{rows.map(f=><button key={f.id} onClick={()=>onFlight(f.id)}><strong>{f.id}</strong><span>{f.origin} → {f.destination}</span><small>{time(f.scheduled_departure)} · {flightStates[f.id]?.status||"scheduled"}</small></button>)}</div></aside>
}
