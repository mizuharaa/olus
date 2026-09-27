"use client"
import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { OlusLogo } from "@/components/ds/logo"
import { facts } from "@/lib/facts"
import s from "./docs.module.css"

const sections = [
  ["problem", "The recovery problem"], ["optimizer", "Recovery optimizer"],
  ["prediction", "Cascade prediction"], ["crew", "Crew checks"],
  ["data", "Data and replay"], ["architecture", "System architecture"],
] as const
function Section({ id, children }: { id: typeof sections[number][0]; children: React.ReactNode }) {
  const index = sections.findIndex(section => section[0] === id)
  return <section id={id} className={s.section}><h2><span>{String(index + 1).padStart(2, "0")}</span><a href={`#${id}`}>{sections[index][1]} <span aria-hidden>#</span></a></h2>{children}</section>
}
function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  return <div className={s.code}><button type="button" onClick={async () => {
    try { await navigator.clipboard.writeText(children); setCopied(true); toast.success("Code copied") }
    catch { toast.error("Copy unavailable", { description: "Select the code and copy it with your keyboard." }) }
  }}>{copied ? "Copied" : "Copy"}</button><pre tabIndex={0}><code>{children}</code></pre></div>
}
export default function DocsPage() {
  const [active, setActive] = useState<string>(sections[0][0])
  useEffect(() => {
    const update = () => {
      const passed = sections.filter(([id]) => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= 180)
      setActive(passed.at(-1)?.[0] ?? sections[0][0])
    }
    update(); window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [])
  const activeIndex = sections.findIndex(([id]) => id === active)
  return <main className={s.page}>
    <a href="#documentation" className={s.skip}>Skip to documentation</a>
    <header className={s.header}><Link href="/" aria-label="Olus home"><OlusLogo size={32}/><strong>olus</strong></Link><nav aria-label="Primary"><Link href="/scenarios">Scenarios</Link><Link href="/faq">FAQ</Link><Link href="/simulator">Open workspace ↗</Link></nav></header>
    <div className={s.layout}>
      <article id="documentation" className={s.article}>
        <header className={s.intro}><p>OLUS / MODEL DOCUMENTATION</p><h1>Read the plan.<br/>Inspect the model.</h1><p>How a simulated disruption becomes a set of recovery alternatives, and which assumptions sit behind the result.</p><small>Source review: <time dateTime={facts.verifiedAt}>{facts.verifiedAt}</time>. Source paths below identify the reviewed implementation; this is not a deployment or regulatory certification.</small></header>
        <Section id="problem"><p>A closure or unavailable aircraft changes more than one departure. The same tail may be assigned to later flights; its delay can propagate through a rotation. Recovery requires comparing service, cost, aircraft position and crew constraints together.</p><p>Olus uses a synthetic airline network. Start with a scenario, inject an event, compare recovery plans and inspect changed flights before applying one. Public aircraft positions provide map context; they are not the synthetic schedule.</p><p>The canonical catalog currently contains <strong>{facts.disruptionTypes} disruption types</strong>. Each has parameters and normalization rules. Event coverage is a simulation approximation, not a claim to model every operational consequence.</p><p className={s.source}>Source: {facts.sources.events}</p><Link href="/faq#disruption-types">Read the event catalog scope ↗</Link></Section>
        <Section id="optimizer"><p>The recovery optimizer uses <strong>{facts.solver}</strong>. Boolean decisions select cancellations and eligible spare-aircraft assignments. Delay estimates are inputs from cascade prediction, not freely optimized departure times.</p><div className={s.tableWrap}><table><caption>{facts.recoveryObjectives} recovery objectives, evaluated against the same disruption</caption><thead><tr><th scope="col">Plan</th><th scope="col">Objective</th><th scope="col">Inspect before applying</th></tr></thead><tbody>
          <tr><th scope="row">A</th><td>Minimize Cost</td><td>Cancellation, delay and reposition costs</td></tr>
          <tr><th scope="row">B</th><td>Minimize Passenger Impact</td><td>Passenger delay and service continuity</td></tr>
          <tr><th scope="row">C</th><td>Protect Tomorrow&apos;s Schedule</td><td>Downline rotations and cancellations</td></tr>
          <tr><th scope="row">D</th><td>Green Recovery</td><td>Carbon ledger, service impact and modeled EU ETS cost</td></tr>
        </tbody></table></div><p>Financial totals are modeled exposure, not airline quotes. Compare the detailed cancellation, delay and reposition components. Carbon and passenger totals must be interpreted alongside cancellations: reducing service can reduce those totals without producing a better plan.</p><p>Inspect the returned status. <strong>Optimal</strong> means the solver proved the objective within this model. <strong>Feasible</strong> means it found a satisfying assignment without that proof. <strong>Heuristic</strong> identifies a fallback result; <strong>infeasible</strong> is not a dispatchable plan. A time limit alone does not establish optimality.</p><CodeBlock>{`RecoveryPlan
  status: optimal | feasible | heuristic | infeasible
  cancelled_flights / delayed_flights / aircraft_swaps
  total_cost_usd / cost_breakdown
  total_passenger_delay_minutes / crew_violations
  total_co2_kg / carbon_breakdown / eu_ets_cost_usd
  uncertainty: optional expected-cost and regret analysis`}</CodeBlock><p>For uncertain closure durations, inspect the expected cost, cost range and regret fields when returned. Do not interpret an absent uncertainty result as zero risk.</p><p className={s.source}>Source: {facts.sources.optimizer}; apps/api/src/optimizer/uncertain.py</p></Section>
        <Section id="prediction"><p>The prediction layer estimates direct and downline delay before recovery optimization. Its implementation supports a trained predictor and rule-based propagation. Whether a trained model is available depends on the running installation; the site makes no claim about a deployed model&apos;s accuracy.</p><p>Direct disruption, first-order propagation and later cascade effects are separate states on the map and timeline. Compare the disrupted baseline with each candidate, then inspect the changed legs. A map animation illustrates the simulated movement; it is not recorded ADS-B history.</p><p>There is no published solve-time or prediction-accuracy guarantee on this page. Use measured run results and the stress-test tool with the scenario, machine and configuration recorded.</p><Link href="/simulator/stress-test">Open stress tests ↗</Link></Section>
        <Section id="crew"><p>The crew engine implements selected checks inspired by FAR Part 117 using the supplied pairing and crew inputs. Its rule tables and exceptions are bounded by the implementation. A passed modeled check is not a comprehensive legal determination.</p><p>Review flight time, report time, duty duration, rest and cumulative inputs together. The aircraft-rotation ledger is explicitly a proxy where crew assignments are missing; it must not be read as an individual crew audit.</p><p>For a result, inspect the computed value, its implemented limit, remaining margin and the inputs used. Keep violations and warnings visible when comparing financial alternatives. Do not treat a cheaper plan as legal simply because it has a cost total.</p><p className={s.source}>Source: {facts.sources.crew}; apps/web/components/simulator/crew-legality-ledger.tsx</p><Link href="/simulator/crew">Open crew analysis ↗</Link></Section>
        <Section id="data"><p><strong>Nimbus Air is synthetic.</strong> Network size depends on the loaded scenario. Read current schedule and fleet counts from the workspace instead of assuming a fixed demonstration size.</p><p>Optional public weather and ADS-B overlays are external context. Feed availability, stale observations and route metadata vary by provider. An inferred destination or heading projection is not a confirmed flight plan.</p><p>Deterministic recovery replay uses saved events, frozen weather snapshots, a seeded search and <strong>{facts.replayWorkers} solver worker</strong>. Normal search may use multiple workers and a wall-clock limit. Solve duration is measured separately from recovery equality.</p><p className={s.source}>Source: {facts.sources.optimizer}; apps/api/src/events/catalog.py</p><Link href="/faq#determinism">Read replay boundaries ↗</Link></Section>
        <Section id="architecture"><p>The browser is a Next.js and React frontend. FastAPI serves simulator data and operations over HTTP and WebSocket. Python prediction, optimization and crew checks produce the recovery result; SQLite persists scenarios. Deployment topology is installation-specific.</p><CodeBlock>{`Synthetic schedule + event parameters
                  |
          Cascade prediction
                  |
       OR-Tools CP-SAT recovery
          /               \\
     Crew checks       Cost / carbon ledgers
          \\               /
            Recovery alternatives
                  |
       FastAPI HTTP + WebSocket
                  |
       Olus operations workspace`}</CodeBlock><p>Keep the API running when evaluating the workflow. A rendered landing demonstration does not prove the backend is connected. An offline banner or stale-data label is part of the result, not something to ignore.</p><Link href="/faq#run-locally">Local setup guidance ↗</Link></Section>
        <nav className={s.pagination} aria-label="Documentation sections">{activeIndex > 0 ? <a href={`#${sections[activeIndex - 1][0]}`}>← {sections[activeIndex - 1][1]}</a> : <Link href="/">← Home</Link>}{activeIndex < sections.length - 1 ? <a href={`#${sections[activeIndex + 1][0]}`}>{sections[activeIndex + 1][1]} →</a> : <Link href="/faq">FAQ →</Link>}</nav>
      </article>
      <aside className={s.toc}><nav aria-label="On this page"><p>ON THIS PAGE</p>{sections.map(([id, title]) => <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined}>{title}</a>)}</nav></aside>
    </div>
  </main>
}
