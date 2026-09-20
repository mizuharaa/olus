"use client"
import {useEffect,useRef,useState,type CSSProperties} from "react"
import Link from "next/link"
import type {Route} from "next"
import {useRouter} from "next/navigation"
import {useQueryClient} from "@tanstack/react-query"
import dynamic from "next/dynamic"
import {toast} from "sonner"
import {useSimulationStore} from "@/stores/simulation"
import {ResizeHandle,useResizable} from "@/components/simulator/workspace-chrome"
import {apiClient} from "@/lib/api"
import {resetWorkspaceSimulation,useWorkspaceData,hydrateRunResult,type RunResult} from "./workspace-data"
import s from "./operations.module.css"
const FlightMap=dynamic(()=>import("@/components/simulator/flight-map"),{ssr:false})
const EventPanel=dynamic(()=>import("@/components/simulator/event-panel").then(m=>m.EventPanel),{ssr:false})
const PlanCompare=dynamic(()=>import("@/components/simulator/plan-compare-board").then(m=>m.PlanCompareBoard),{ssr:false})
const FlightDetail=dynamic(()=>import("@/components/simulator/flight-detail").then(m=>m.FlightDetailPanel),{ssr:false})
const Timeline=dynamic(()=>import("@/components/simulator/cascade-timeline").then(m=>m.CascadeTimeline),{ssr:false})
const RecoveryDetail=dynamic(()=>import("@/components/simulator/recovery-detail").then(m=>m.RecoveryDetail),{ssr:false})
const FlightSearch=dynamic(()=>import("@/components/simulator/flight-search").then(m=>m.FlightSearch),{ssr:false})
const AircraftPreview=dynamic(()=>import("./aircraft-preview"),{ssr:false})
export function Overview(){
 const {runId,scenarioId}=useWorkspaceData(),router=useRouter(),queryClient=useQueryClient()
 const {schedule,activeEvents,recoveryPlans,appliedPlanId,selectedLiveFlight,setSelectedLiveFlight,setUpdate,setShowSimulation,setShowLiveFlights,showLiveFlights}=useSimulationStore()
 const [events,setEvents]=useState(false),[compare,setCompare]=useState(false),[timeline,setTimeline]=useState(false)
 const [selected,setSelected]=useState<string|null>(null),[inspected,setInspected]=useState("A"),[preview,setPreview]=useState<string|null>(null),[busy,setBusy]=useState(false),[recoveryView,setRecoveryView]=useState<"compare"|"detail">("compare")
 const recoverySize=useResizable("olus-recovery-height",520,300,900,"top")
 const timelineSize=useResizable("olus-timeline-height",300,220,650,"top")
 const generation=useRef(0)
 useEffect(()=>{generation.current++;const invalidate=()=>{generation.current++};window.addEventListener("olus-account-changed",invalidate);return()=>{generation.current++;window.removeEventListener("olus-account-changed",invalidate)}},[runId])
 const liveId=selectedLiveFlight?.icao24
 const scheduled=schedule.find(f=>f.id===selected)
 useEffect(()=>{setShowSimulation(true)},[setShowSimulation])
 useEffect(()=>{if(recoveryPlans.length&&!recoveryPlans.some(p=>p.plan_id===inspected))setInspected(recoveryPlans[0].plan_id);if(!recoveryPlans.length)setPreview(null)},[recoveryPlans,inspected])
 useEffect(()=>{if(liveId){setSelected(null);setCompare(false);if(innerWidth<1100)setEvents(false)}},[liveId])
 const select=(id:string|null)=>{setSelected(id);if(id){setSelectedLiveFlight(null);setCompare(false);if(innerWidth<1100)setEvents(false)}}
 const inspect=(id:string)=>{setInspected(id);setPreview(id);setShowSimulation(true)}
 const reset=async()=>{if(runId){router.push("/app/overview");return}if(busy)return;setBusy(true);const current=generation.current;try{await resetWorkspaceSimulation();if(current!==generation.current)return;useSimulationStore.getState().reset();useSimulationStore.getState().setSelectedLiveFlight(null);await queryClient.invalidateQueries({queryKey:["workspace-state"]});setPreview(null);setSelected(null);setCompare(false);setTimeline(false);toast.success("Simulation reset")}catch(e){toast.error(e instanceof Error?e.message:"Reset failed")}finally{setBusy(false)}}
 const commit=async(id:string|null)=>{if(busy)return;setBusy(true);const current=generation.current;try{const r=await apiClient.post<Record<string,unknown>&{result:RunResult}>(runId?`/runs/${encodeURIComponent(runId)}/apply`:"/recovery/apply",{plan_id:id});if(current!==generation.current)return;if(runId){hydrateRunResult(r.data.result as RunResult);await Promise.all(["private-run","crew-audit","recovery-run"].map(key=>queryClient.invalidateQueries({queryKey:[key,runId]})))}else setUpdate(r.data);setPreview(null);toast.success(id?`Plan ${id} applied to simulation`:"Plan reverted")}catch(e){toast.error(e instanceof Error?e.message:"Recovery failed")}finally{setBusy(false)}}
 return <div className={s.console} data-olus-console data-compare={compare} data-events={events} data-timeline={timeline} style={{"--recovery-height":`${recoverySize.size}px`,"--timeline-height":`${timelineSize.size}px`} as CSSProperties}>
  <div className={s.map}><FlightMap selectedFlight={selected} onFlightSelect={select} externalFeed readOnlyRun={!!runId} previewPlanId={preview}/></div>
  <nav className={s.toolbar} aria-label="Operations controls"><div className={s.identity}><span>NETWORK CONTROL</span><strong>Operations</strong></div><button aria-expanded={events} aria-controls="operations-events" onClick={()=>{setEvents(!events);if(innerWidth<1100){setCompare(false);setSelected(null);setSelectedLiveFlight(null)}}}>Events <b>{activeEvents.length}</b></button><button aria-expanded={compare} aria-controls="operations-recovery" onClick={()=>{setCompare(!compare);setTimeline(false);setSelected(null);setSelectedLiveFlight(null);if(innerWidth<1100)setEvents(false)}}>Recovery <b>{recoveryPlans.length}</b></button><button onClick={reset} disabled={busy} aria-busy={busy}>{runId?"Back to demo":"Reset simulation"}</button><div className={s.search}><FlightSearch selectedFlight={selected} onSelect={select}/></div></nav>
  {recoveryPlans.length>0&&<div className={s.planSwitcher} aria-label="Map recovery preview"><span>{preview?`Preview ${preview}`:appliedPlanId?`Applied ${appliedPlanId}`:"Disrupted baseline"}</span>{recoveryPlans.map(p=><button key={p.plan_id} aria-label={`Preview plan ${p.plan_id}`} aria-pressed={preview===p.plan_id} onClick={()=>inspect(p.plan_id)}>{p.plan_id}</button>)}<button onClick={()=>setPreview(null)} disabled={!preview}>Clear preview</button></div>}
  {events&&<aside id="operations-events" className={s.events} aria-label="Disruption controls"><header><div><span>SIMULATION</span><h2>Disruptions</h2></div><button aria-label="Close events" onClick={()=>setEvents(false)}>Close</button></header>{runId?<><p>These disruptions belong to your saved run. Edit the scenario and solve again to change them.</p><Link href={`/app/scenarios/${scenarioId}/setup` as Route}>Edit disruptions</Link><ul>{activeEvents.map((event,i)=><li key={i}>{String(event.kind)}</li>)}</ul></>:<EventPanel/>}</aside>}
  {(selectedLiveFlight||scheduled)&&!compare&&<aside className={s.inspector} aria-label="Flight inspector">{selectedLiveFlight&&<><AircraftPreview/><p className={s.note}>Interactive 3D preview · generic airframe</p></>}<FlightDetail live={selectedLiveFlight} scheduled={scheduled} onClose={()=>{setSelected(null);setSelectedLiveFlight(null)}}/></aside>}
  {compare&&<section id="operations-recovery" className={s.comparison} aria-label="Financial recovery" aria-busy={busy}><ResizeHandle label="Recovery height" side="top" value={recoverySize.size} min={300} max={900} onValue={recoverySize.setSize} onPointerDown={recoverySize.onPointerDown}/>{recoveryPlans.length?<><div className={s.recoveryTabs} aria-label="Recovery views"><button aria-pressed={recoveryView==="compare"} onClick={()=>setRecoveryView("compare")}>Compare plans</button><button aria-pressed={recoveryView==="detail"} onClick={()=>setRecoveryView("detail")}>Cost and risk detail</button>{recoveryView==="detail"&&<><label>Plan <select aria-label="Detail plan" value={inspected} onChange={e=>inspect(e.target.value)}>{recoveryPlans.map(p=><option key={p.plan_id} value={p.plan_id}>{p.plan_id} - {p.objective_label}</option>)}</select></label><button onClick={()=>setCompare(false)}>Close recovery</button></>}</div>{recoveryView==="compare"?<PlanCompare inspectedId={inspected} onInspect={inspect} onCommit={commit} onClose={()=>setCompare(false)} busy={busy}/>:<div className={s.recoveryDetail}><RecoveryDetail inspectedId={inspected} onOpenCompare={()=>setRecoveryView("compare")}/><button disabled={busy} onClick={()=>void commit(appliedPlanId===inspected?null:inspected)}>{appliedPlanId===inspected?"Unapply":"Commit"} plan {inspected}</button></div>}</>:<div className={s.empty}><h2>Compare recovery plans</h2><p>Trigger a disruption to calculate the four recovery strategies.</p><button onClick={()=>{setCompare(false);setEvents(true)}}>Configure disruption</button><button onClick={()=>setCompare(false)}>Back to map</button></div>}</section>}
  {!compare&&<section className={s.timeline} data-open={timeline}>{timeline&&<ResizeHandle label="Timeline height" side="top" value={timelineSize.size} min={220} max={650} onValue={timelineSize.setSize} onPointerDown={timelineSize.onPointerDown}/>}<button aria-expanded={timeline} onClick={()=>setTimeline(!timeline)}>{timeline?"Collapse":"Open"} cascade timeline <span>{schedule.length} scheduled flights</span></button>{timeline&&<Timeline selectedFlight={selected} onFlightSelect={select}/>}</section>}
  <div className={s.layerMode}><span>Simulation routes use illustrative motion</span><button aria-pressed={showLiveFlights} onClick={()=>setShowLiveFlights(!showLiveFlights)}>{showLiveFlights?"Hide":"Show"} live traffic</button></div>
 </div>
}
