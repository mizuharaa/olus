"use client"
import { createContext, useContext, useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { consumeLoadedScenario } from "@/lib/workspace-handoff"
import { apiClient } from "@/lib/api"
import { hydrateAirportTiers } from "@/components/simulator/airports"
import { useWebSocket } from "@/lib/websocket"
import { useSimulationStore, type ScheduledFlight, type FleetAircraft, type LiveFlight } from "@/stores/simulation"

const DataContext = createContext({ loading: true, errors: [] as string[], connected: false, runId: null as string|null, scenarioId: null as string|null, retry: () => {} })
export const useWorkspaceData = () => useContext(DataContext)
export async function resetWorkspaceSimulation() {
  await apiClient.post("/simulator/reset")
}
export function WorkspaceData({ children }: { children: React.ReactNode }) {
  const runId=useSearchParams().get("run"),pathname=usePathname()
  if(pathname.startsWith("/app/") && !["/app/overview","/app/map"].includes(pathname))return <DataContext.Provider value={{loading:false,errors:[],connected:false,runId:null,scenarioId:null,retry:()=>{}}}>{children}</DataContext.Provider>
  return runId ? <PrivateRunFeeds key={runId} runId={runId}>{children}</PrivateRunFeeds> : <DemoBoot>{children}</DemoBoot>
}
function DemoBoot({children}:{children:React.ReactNode}) {
  const boot=useQuery({queryKey:["workspace-boot"],staleTime:Infinity,retry:false,queryFn:async()=>{
    const loadedScenario = consumeLoadedScenario()
    if(!loadedScenario && ["localhost","127.0.0.1","[::1]"].includes(window.location.hostname))await resetWorkspaceSimulation()
    return true
  }})
  if(boot.isError)return <div role="alert">Could not start a clean simulation. <button onClick={()=>void boot.refetch()}>Retry startup</button></div>
  if(!boot.isSuccess)return <p role="status">Starting simulation...</p>
  return <WorkspaceFeeds>{children}</WorkspaceFeeds>
}
function WorkspaceFeeds({ children }: { children: React.ReactNode }) {
  const { isConnected } = useWebSocket()
  const schedule = useQuery({ queryKey: ["workspace-schedule"], refetchOnMount:"always", queryFn: async () => {
    const { data } = await apiClient.get<ScheduledFlight[] | { flights: ScheduledFlight[] }>("/simulator/schedule")
    const rows = Array.isArray(data) ? data : data.flights
    if (!Array.isArray(rows)) throw new Error("Schedule response unavailable")
    return rows
  } })
  const airports = useQuery({queryKey:["workspace-airports"],queryFn:async()=>{const {data}=await apiClient.get<{airports?:{id:string;hub_type?:string}[]}|{id:string;hub_type?:string}[]>("/airports");const rows=Array.isArray(data)?data:data.airports;if(!Array.isArray(rows))throw new Error("Airport metadata unavailable");hydrateAirportTiers(rows);return rows}})
  const fleet = useQuery({ queryKey: ["workspace-fleet"], refetchOnMount:"always", queryFn: async () => {
    const { data } = await apiClient.get<{ aircraft: FleetAircraft[] }>("/aircraft")
    if (!Array.isArray(data.aircraft)) throw new Error("Fleet response unavailable")
    return data.aircraft
  } })
  const state = useQuery({ queryKey: ["workspace-state"], refetchOnMount:"always", refetchInterval: 30000, queryFn: async () => {
    const { data } = await apiClient.get<Record<string, unknown>>("/simulator/state")
    return data
  } })
  const traffic = useQuery({ queryKey: ["workspace-traffic"], refetchInterval: 15000, queryFn: async ({ signal }) => {
    const response = await fetch("/api/flights-live", { signal })
    if (!response.ok) throw new Error("Traffic feed unavailable")
    const data = await response.json() as { flights?: LiveFlight[]; error?: string }
    if (!Array.isArray(data.flights) || data.error) throw new Error("Traffic feed unavailable")
    const valid = data.flights.filter(f => typeof f.icao24 === "string" && Number.isFinite(f.lat) && Math.abs(f.lat) <= 90 && Number.isFinite(f.lon) && Math.abs(f.lon) <= 180)
    return valid
  } })
  useEffect(() => { const s = useSimulationStore.getState(); s.hydrateStaticFromCache(); s.hydrateLiveFromCache() }, [])
  // Hydrate only while this provider is mounted. Late public responses must
  // never overwrite the private run opened during an in-flight request.
  useEffect(()=>{if(schedule.data)useSimulationStore.getState().setSchedule(schedule.data)},[schedule.data])
  useEffect(()=>{if(fleet.data)useSimulationStore.getState().setFleet(fleet.data)},[fleet.data])
  useEffect(()=>{if(state.data)useSimulationStore.getState().setUpdate({...state.data,type:"plan_applied"})},[state.data])
  useEffect(()=>{if(traffic.data)useSimulationStore.getState().setLiveFlights(traffic.data,Date.now())},[traffic.data])
  const queries = [schedule, fleet, state, traffic, airports]
  const errors = queries.flatMap((q, i) => q.isError ? [["Schedule", "Fleet", "Simulation", "ADS-B traffic", "Airports"][i]] : [])
  return <DataContext.Provider value={{ loading: queries.some(q => q.isPending), errors, connected: isConnected, runId: null, scenarioId: null, retry: () => queries.forEach(q => void q.refetch()) }}>{children}</DataContext.Provider>
}

export type RunResult = Record<string, unknown> & {schedule: ScheduledFlight[]; aircraft: FleetAircraft[]}
export function hydrateRunResult(result: RunResult) {
  const store=useSimulationStore.getState()
  // Private inputs must never enter the public demo session cache.
  useSimulationStore.setState({schedule:result.schedule,fleet:result.aircraft})
  store.setUpdate({...result,type:"plan_applied"})
}
function PrivateRunFeeds({runId,children}:{runId:string;children:React.ReactNode}) {
  const [hydrated,setHydrated]=useState(false)
  const run=useQuery({queryKey:["private-run",runId],retry:false,refetchInterval:q=>q.state.data&&["queued","running"].includes(q.state.data.status)?5000:false,queryFn:async()=>{
    const {data}=await apiClient.get<{scenario_id:string;status:string;result:RunResult|null}>(`/runs/${encodeURIComponent(runId)}`)
    return data
  }})
  useEffect(()=>{const clear=()=>{useSimulationStore.getState().reset();useSimulationStore.setState({schedule:[],fleet:[],liveFlights:[],selectedLiveFlight:null})};clear();return clear},[runId])
  useEffect(()=>{if(run.data?.result){hydrateRunResult(run.data.result);setHydrated(true)}},[run.data])
  if(run.isPending)return <p role="status">Loading saved recovery run...</p>
  if(run.isError)return <div role="alert">Could not load this run. Sign in with its owner account, then <button onClick={()=>void run.refetch()}>retry</button>.</div>
  if(!run.data?.result)return <p role="status">Run {run.data?.status}. Results will appear when the solver finishes.</p>
  if(!hydrated)return <p role="status">Preparing recovery map...</p>
  return <DataContext.Provider value={{loading:false,errors:[],connected:true,runId,scenarioId:run.data.scenario_id,retry:()=>void run.refetch()}}>{children}</DataContext.Provider>
}
