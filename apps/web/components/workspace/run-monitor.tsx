"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import type { Route } from "next"
import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api"
import styles from "./run-monitor.module.css"
export type RunEvent={type:string;sequence:number;elapsed_ms:number;plan_id?:string;solve_sequence?:number;objective_value?:number;best_objective_bound?:number;incumbent_count?:number;constraints_satisfied?:number;constraint_count?:number;status?:string}
export type RecoveryRun={id:string;scenario_id:string;scenario_name:string;status:string;created_at:string;elapsed_ms:number;error?:string;events_dropped?:number;events:RunEvent[];result:null|{applied_plan_id:string|null;recovery_plans:{plan_id:string;status:string;total_cost_usd:number}[]}}
const active=(status:string)=>status==='queued'||status==='running'
export function RunMonitor({id}:{id:string}) {
 const run=useQuery({queryKey:['recovery-run',id],queryFn:async()=>(await apiClient.get<RecoveryRun>(`/runs/${encodeURIComponent(id)}`)).data,refetchInterval:q=>q.state.data&&active(q.state.data.status)?1000:false})
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(''),[table,setTable]=useState(false),[now,setNow]=useState(Date.now())
 useEffect(()=>{if(!run.data||!active(run.data.status))return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[run.data?.status])
 if(run.isPending)return <section className={styles.page} aria-busy="true"><h1>Opening recovery run</h1><p>Loading the recorded solver state.</p></section>
 if(run.isError)return <section className={styles.page}><h1>Run unavailable</h1><p role="alert">{run.error.message}</p><button onClick={()=>void run.refetch()}>Retry</button> <Link href={"/app/account" as Route}>Sign in</Link></section>
 const data=run.data,events=data.events,modelIds=[...new Set(events.filter(e=>e.solve_sequence).map(e=>String(e.solve_sequence)))],model=selected||modelIds.at(-1)||'',modelEvents=events.filter(e=>String(e.solve_sequence)===model),incumbents=modelEvents.filter(e=>typeof e.objective_value==='number'),last=incumbents.at(-1),first=modelEvents[0]
 const elapsed=active(data.status)?Math.max(data.elapsed_ms,now-Date.parse(data.created_at)):data.elapsed_ms
 const values=incumbents.map(e=>e.objective_value!),min=Math.min(...values),max=Math.max(...values),points=values.map((v,i)=>`${20+i*560/Math.max(1,values.length-1)},${150-(v-min)*120/Math.max(1,max-min)}`)
 async function cancel(){setBusy(true);setError('');try{await apiClient.post(`/runs/${encodeURIComponent(id)}/cancel`);await run.refetch()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <section className={styles.page}>
  <header className={styles.header}><div><p>RECOVERY RUN</p><h1>{data.scenario_name}</h1><p role="status" aria-live="polite">{data.status.replace('_',' ')}</p></div><div>{active(data.status)&&<button onClick={()=>void cancel()} disabled={busy} aria-busy={busy}>{busy?'Cancelling…':'Cancel solve'}</button>}{data.result&&<Link className={styles.primary} href={`/app/overview?run=${encodeURIComponent(id)}`}>Inspect recovery on map ?</Link>}</div></header>
  {(error||data.error)&&<p role="alert">{error||data.error}</p>}
  <dl className={styles.metrics}><div><dt>Elapsed</dt><dd>{(elapsed/1000).toFixed(1)} <small>seconds</small></dd></div><div><dt>Incumbents in selected model</dt><dd>{last?.incumbent_count??'—'}</dd></div><div><dt>Constraints satisfied by latest incumbent</dt><dd>{last?.constraints_satisfied??'—'}</dd></div><div><dt>Objective value · weighted solver units</dt><dd>{last?.objective_value?.toLocaleString()??'—'}</dd></div></dl>
  <section className={styles.panel}><div className={styles.header}><h2>Objective trace</h2><label>Model <select value={model} onChange={e=>setSelected(e.target.value)}>{modelIds.map(seq=><option key={seq} value={seq}>Plan {events.find(e=>String(e.solve_sequence)===seq)?.plan_id} · model {seq}</option>)}</select></label></div><p>Plan {first?.plan_id??'—'} · actual CP-SAT incumbents. Each model has its own objective; values are not compared across models.</p>
   {values.length?<figure>{table?<div className={styles.scroll}><table><caption>Recorded objective values for model {model}</caption><thead><tr><th scope="col">Incumbent</th><th scope="col">Elapsed (s)</th><th scope="col">Objective</th><th scope="col">Best bound</th></tr></thead><tbody>{incumbents.map(e=><tr key={e.sequence}><th scope="row">{e.incumbent_count}</th><td>{(e.elapsed_ms/1000).toFixed(2)}</td><td>{e.objective_value}</td><td>{e.best_objective_bound}</td></tr>)}</tbody></table></div>:<svg viewBox="0 0 600 180" role="img" aria-label={`Actual objective values for ${values.length} incumbents; open table for values`}><path d="M20 150H580" fill="none" stroke="currentColor" strokeDasharray="4 4"/><polyline points={points.join(' ')} fill="none" stroke="var(--recover)" strokeWidth="3"/>{points.map((point,i)=><circle key={i} cx={point.split(',')[0]} cy={point.split(',')[1]} r="4" fill="var(--recover)"/>)}</svg>}<figcaption>{values.length} observed incumbents. Lower objective is better within this model.</figcaption><button onClick={()=>setTable(!table)}>{table?'View chart':'View as table'}</button></figure>:<p>No incumbent reported yet. Empty or infeasible models may finish without one.</p>}
  </section>
  {data.result&&<section className={styles.panel}><h2>Returned plans</h2><div className={styles.planList}>{data.result.recovery_plans.map(plan=><Link key={plan.plan_id} href={`/app/overview?run=${encodeURIComponent(id)}`}>Plan {plan.plan_id} · {plan.status} · ${plan.total_cost_usd.toLocaleString()} modeled cost</Link>)}</div><CrewAudit runId={id}/></section>}
  <section className={styles.panel}><h2>Solver events</h2>{!!data.events_dropped&&<p>{data.events_dropped} earlier events omitted; the most recent 2,000 are retained.</p>}<p>Only events emitted by this worker appear here. Cancelling terminates its process and preserves other runs and committed plans.</p><ol className={styles.log}>{events.map(e=><li key={e.sequence}><time>{(e.elapsed_ms/1000).toFixed(2)}s</time> {e.type.replaceAll('_',' ')}{e.plan_id?` · Plan ${e.plan_id}`:''}{e.status?` · ${e.status}`:''}</li>)}</ol></section>
 </section>
}
type AuditRow={crew_id:string;crew_name:string;flight_id:string;rule:string;label:string;value:number|null;limit:number|null;slack:number|null;status:string;inputs:Record<string,unknown>}
export function CrewAudit({runId}:{runId:string}){
 const [open,setOpen]=useState(false),[crew,setCrew]=useState(''),[status,setStatus]=useState('all')
 const audit=useQuery({queryKey:['crew-audit',runId],enabled:open,queryFn:async()=>(await apiClient.get<{scope:string;limitations:string[];rows:AuditRow[]}>(`/runs/${encodeURIComponent(runId)}/crew-audit`)).data})
 const rows=(audit.data?.rows??[]).filter(r=>(!crew||`${r.crew_id} ${r.crew_name}`.toLowerCase().includes(crew.toLowerCase()))&&(status==='all'||r.status===status))
 return <details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Inspect crew rule computations</summary>{audit.isPending&&<p role="status">Loading crew audit…</p>}{audit.isError&&<p role="alert">{audit.error.message}</p>}{audit.data&&<><p>{audit.data.scope}</p><ul>{audit.data.limitations.map(item=><li key={item}>{item}</li>)}</ul><div className={styles.header}><label>Crew <input value={crew} onChange={e=>setCrew(e.target.value)} placeholder="Crew ID or name"/></label><label>Result <select value={status} onChange={e=>setStatus(e.target.value)}>{['all','pass','fail','unknown'].map(s=><option key={s}>{s}</option>)}</select></label></div><div className={styles.scroll}><table><caption>{rows.length} crew rule computations · values and slack in minutes</caption><thead><tr><th scope="col">Crew / flight</th><th scope="col">Modeled rule</th><th scope="col">Value</th><th scope="col">Limit</th><th scope="col">Slack</th><th scope="col">Result / derivation</th></tr></thead><tbody>{rows.map((r,i)=><tr key={`${r.crew_id}-${r.flight_id}-${r.rule}-${i}`}><th scope="row">{r.crew_id} / {r.flight_id}</th><td>{r.label}</td><td>{r.value?.toFixed(0)??'Unknown'}</td><td>{r.limit?.toFixed(0)??'Unknown'}</td><td>{r.slack?.toFixed(0)??'Unknown'}{r.slack!==null&&r.limit!==null&&r.limit>0&&<progress max={r.limit} value={Math.max(0,r.slack)} aria-label={`${r.slack.toFixed(0)} minutes slack`}/>}</td><td><details><summary>{r.status}</summary><dl>{Object.entries(r.inputs).map(([k,v])=><div key={k}><dt>{k.replaceAll('_',' ')}</dt><dd>{v===null?'Not supplied':String(v)}</dd></div>)}</dl></details></td></tr>)}</tbody></table></div></>}</details>
}

/** Mounted once by WorkspaceShell so a run stays observable while navigating. */
export function ActiveRunToast(){
 const pathname=usePathname(),[id,setId]=useState<string|null>(null),seenActive=useRef(false)
 useEffect(()=>{const match=pathname.match(/^\/app\/runs\/([^/]+)$/);try{const value=match?decodeURIComponent(match[1]):sessionStorage.getItem('olus-active-run');if(value){setId(value);sessionStorage.setItem('olus-active-run',value)}}catch{}},[pathname])
 useEffect(()=>{seenActive.current=false;return()=>{if(id)toast.dismiss(`recovery-${id}`)}},[id])
 useEffect(()=>{const clear=()=>{if(id)toast.dismiss(`recovery-${id}`);seenActive.current=false;setId(null);try{sessionStorage.removeItem('olus-active-run')}catch{}};window.addEventListener('olus-account-changed',clear);return()=>window.removeEventListener('olus-account-changed',clear)},[id])
 const run=useQuery({queryKey:['recovery-run',id],enabled:!!id,queryFn:async()=>(await apiClient.get<RecoveryRun>(`/runs/${encodeURIComponent(id!)}`)).data,refetchInterval:q=>q.state.data&&active(q.state.data.status)?1000:false})
 useEffect(()=>{
  if(!id||!run.data)return
  const toastId=`recovery-${id}`
  if(active(run.data.status)){
   seenActive.current=true
   toast.loading(`Solving ${run.data.scenario_name}`,{id:toastId,description:'Recovery continues on the server.',action:{label:'Cancel',onClick:()=>{void apiClient.post(`/runs/${encodeURIComponent(id)}/cancel`).then(()=>run.refetch()).catch(e=>toast.error(e.message))}}})
  }else{
   toast.dismiss(toastId)
   if(seenActive.current){seenActive.current=false;toast(run.data.status==='completed'?'Recovery plans ready':`Recovery ${run.data.status}`,{description:run.data.scenario_name})}
   try{sessionStorage.removeItem('olus-active-run')}catch{}
  }
 },[id,run.data?.status,run.data?.scenario_name])
 useEffect(()=>{if(run.isError&&id)toast.dismiss(`recovery-${id}`)},[run.isError,id])
 return null
}
