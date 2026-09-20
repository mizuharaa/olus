"use client"
import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import type { Route } from "next"
import { usePathname, useRouter } from "next/navigation"
import { Search, ArrowUpRight, LayoutDashboard, Map, SlidersHorizontal, X } from "lucide-react"
import {useSimulationStore} from "@/stores/simulation"
import { AgentBubble } from "@/components/simulator/agent-bubble"
import { DashboardLoader } from "@/components/simulator/dashboard-loader"
import { OlusMark } from "@/components/ds/logo"
import { WorkspaceData, useWorkspaceData } from "./workspace-data"
import styles from "./workspace.module.css"
const PlanWorkbench=dynamic(()=>import("./plan-workbench").then(m=>m.PlanWorkbench))
const ActiveRunToast=dynamic(()=>import("./run-monitor").then(m=>m.ActiveRunToast))
const CrewAudit=dynamic(()=>import("./run-monitor").then(m=>m.CrewAudit))
const CrewLedger=dynamic(()=>import("@/components/simulator/crew-legality-ledger").then(m=>m.CrewLegalityLedger))
const CrewOverbooking=dynamic(()=>import("@/components/simulator/crew-overbooking").then(m=>m.CrewOverbooking))
const OpsBrief=dynamic(()=>import("@/components/simulator/ops-brief").then(m=>m.OpsBrief))
const analysisRoutes=[["/simulator/cascade","Cascade timeline"],["/simulator/plans/compare","Compare recovery plans"],["/simulator/crew","Crew legality"],["/simulator/passengers","Passenger impact"],["/simulator/carbon","Carbon ledger"],["/simulator/watchlist","Watchlist"],["/simulator/stress-test","Stress test"],["/simulator/playtest","Playtest"],["/simulator/settings","Simulation settings"]] as const
const routes = [{ href: "/app/overview", label: "Operations", icon: LayoutDashboard }] as const
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return <><DashboardLoader/><Suspense fallback={<p role="status">Opening workspace...</p>}><WorkspaceData><Shell>{children}</Shell></WorkspaceData></Suspense></>
}
function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(), router = useRouter()
  const { errors, loading, connected, retry, runId } = useWorkspaceData()
  const [theme, setTheme] = useState("dark"), [density, setDensity] = useState("comfortable"), [search, setSearch] = useState("")
  const [analysis,setAnalysis]=useState<string|null>(null),[brief,setBrief]=useState(false),[systemDark,setSystemDark]=useState(true)
  const analysisDialog=useRef<HTMLDialogElement>(null),toolsMenu=useRef<HTMLDetailsElement>(null)
  const command = useRef<HTMLDialogElement>(null), preferences = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    try { setTheme(localStorage.getItem("olus-workspace-theme") || "dark"); setDensity(localStorage.getItem("olus-workspace-density") || "comfortable") } catch {}
    const preferencesChanged=(event:Event)=>{const p=(event as CustomEvent<{theme:string;density:string}>).detail;setTheme(p.theme);setDensity(p.density)}
    window.addEventListener("olus-preferences-changed",preferencesChanged)
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); command.current?.showModal() } }
    window.addEventListener("keydown", key); return () => {window.removeEventListener("keydown", key);window.removeEventListener("olus-preferences-changed",preferencesChanged)}
  }, [])
  useEffect(()=>{const media=matchMedia("(prefers-color-scheme: dark)");const sync=()=>setSystemDark(media.matches);sync();media.addEventListener("change",sync);return()=>media.removeEventListener("change",sync)},[])
  useEffect(()=>{const clear=()=>{setAnalysis(null);setBrief(false);analysisDialog.current?.close();useSimulationStore.getState().reset();useSimulationStore.setState({schedule:[],fleet:[],liveFlights:[],selectedLiveFlight:null})};window.addEventListener("olus-account-changed",clear);return()=>window.removeEventListener("olus-account-changed",clear)},[])
  const openAnalysis=(name:string)=>{setAnalysis(name);if(toolsMenu.current)toolsMenu.current.open=false;analysisDialog.current?.show()}
  const save = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch {} }
  return <div className={styles.workspace} data-theme={theme==="system"?(systemDark?"dark":"light"):theme} data-density={density}>
    <ActiveRunToast/>
    <a className={styles.skip} href="#workspace-main">Skip to workspace</a>
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Olus home"><OlusMark size={36}/><span>olus</span></Link>
      <nav aria-label="Workspace" className={styles.nav}>{routes.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}><Icon size={17}/>{label}</Link>)}<Link href={"/app/scenarios" as Route}>Scenarios <ArrowUpRight size={15}/></Link></nav>
      <div className={styles.headerActions}><button onClick={() => command.current?.showModal()} aria-label="Search workspace"><Search size={19}/><kbd>Ctrl K</kbd></button><button onClick={() => preferences.current?.showModal()} aria-label="Workspace preferences"><SlidersHorizontal size={19}/></button><details ref={toolsMenu} className={styles.tools}><summary>Analysis tools</summary><nav aria-label="Analysis tools">{!runId&&<AgentBubble/>}<Link href={"/app/account" as Route}>Account & API keys</Link><Link href={"/app/benchmarks" as Route}>Run history & benchmarks</Link><button onClick={()=>openAnalysis("plans")}>Plan timeline & explanation</button><button onClick={()=>openAnalysis("crew")}>Crew coverage & duty margins</button><button disabled={!!runId} onClick={()=>setBrief(true)}>Daily operations brief</button>{!runId&&analysisRoutes.map(([href,label])=><Link key={href} href={href as Route}>{label}</Link>)}</nav></details></div>
    </header>
    <div className={styles.feedline}><span><span className={connected ? styles.good : styles.muted}>{runId?"Loaded":pathname.startsWith("/app/")&&!pathname.endsWith("overview")?"Account workspace":connected ? "Connected" : "Reconnecting"}</span> &nbsp; {runId?"Saved private run":pathname.startsWith("/app/")&&!pathname.endsWith("overview")?"Saved scenarios & runs":"Simulation stream"}</span><span>All times UTC &middot; Simulated recovery</span></div>
    {errors.length > 0 && <div className={styles.warning} role="status"><span><strong>Some feeds are unavailable.</strong> {errors.join(", ")}. Retained figures may be stale.</span><button onClick={retry}>Retry feeds</button></div>}
    {loading && <p className={styles.loading} role="status">Connecting to schedule, fleet and traffic feeds...</p>}
    <main id="workspace-main" className={styles.main}>{children}</main>
    <dialog ref={command} className={styles.dialog}><div className={styles.sectionHeading}><h2>Go to workspace</h2><button aria-label="Close search" onClick={() => command.current?.close()}><X size={20}/></button></div><label>Search pages<input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Operations..."/></label><div className={styles.commandList}>{search.toLowerCase().split(" ").every(word=>"plan timeline explanation recovery".includes(word))&&<button onClick={()=>{command.current?.close();openAnalysis("plans")}}>Plan timeline & explanation</button>}{[{href:"/app/overview",label:"Operations"},{href:"/app/scenarios",label:"Saved scenarios"},{href:"/app/account",label:"Account & API keys"},...analysisRoutes.map(([href,label])=>({href,label}))].filter(r=>r.label.toLowerCase().includes(search.toLowerCase())).map(r=><button key={r.href} onClick={()=>{command.current?.close();router.push(r.href as Route)}}>{r.label}<ArrowUpRight size={18}/></button>)}</div></dialog>
    <dialog ref={analysisDialog} className={styles.analysisDialog} aria-label="Operations analysis" onClose={()=>{setAnalysis(null);toolsMenu.current?.querySelector("summary")?.focus()}} onKeyDown={e=>{if(e.key==="Escape")analysisDialog.current?.close()}}><header><h2>{analysis==="crew"?"Crew analysis":"Plan analysis"}</h2><button autoFocus onClick={()=>analysisDialog.current?.close()} aria-label="Close analysis">Close</button></header><Suspense fallback={<p role="status">Loading analysis...</p>}>{analysis==="plans"&&<PlanWorkbench/>}{analysis==="crew"&&(runId?<CrewAudit runId={runId}/>:<><p>Rotation margins are a schedule-derived proxy. Crew coverage uses the recovery service; this is not a complete per-rule legality certificate.</p><CrewLedger/><CrewOverbooking/></>)}</Suspense></dialog>
    {brief&&!runId&&<OpsBrief open={brief} onClose={()=>setBrief(false)} railWidth={0}/>}
    <dialog ref={preferences} className={styles.dialog}><div className={styles.sectionHeading}><h2>Workspace preferences</h2><button aria-label="Close preferences" onClick={() => preferences.current?.close()}><X size={20}/></button></div><p>Saved on this device.</p><label htmlFor="workspace-theme">Theme</label><select id="workspace-theme" value={theme} onChange={e => { setTheme(e.target.value); save("olus-workspace-theme", e.target.value) }}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select><label htmlFor="workspace-density">Density</label><select id="workspace-density" value={density} onChange={e => { setDensity(e.target.value); save("olus-workspace-density", e.target.value) }}><option value="comfortable">Comfortable</option><option value="default">Default</option><option value="compact">Compact</option></select></dialog>
  </div>
}
