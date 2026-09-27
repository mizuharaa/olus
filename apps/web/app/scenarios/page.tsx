"use client"
import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  ArrowLeft, ArrowRight, Cloud, OctagonAlert, Ban, ShieldAlert,
  Wrench, HeartPulse, AlertTriangle, Radio, Mountain, ServerCrash, Loader2, Radar,
} from "lucide-react"
import { OlusLogo } from "@/components/ds/logo"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import { preserveLoadedScenario } from "@/lib/workspace-handoff"
import { toast } from "sonner"

const SCENARIOS = [
  { name: "tan_son_nhat_drone",    displayName: "Tan Son Nhat Drone Incursion", description: "Two runway suspensions from one drone, ~2h total, with the closure length unknown at trigger time. Mapped structurally onto KDEN.", Icon: Radar,        affected: 22, dur: "4h",  difficulty: "High",   diffClass: "text-red-700 bg-red-50 border-red-200" },
  { name: "ord_thunderstorm",      displayName: "ORD Thunderstorm",         description: "Severe thunderstorm closes O'Hare for 4 hours. Classic midwest summer disruption with wide cascade.", Icon: Cloud,        affected: 47, dur: "12h", difficulty: "High",   diffClass: "text-red-700 bg-red-50 border-red-200" },
  { name: "atl_security",          displayName: "ATL Security Incident",     description: "Security threat forces evacuation of Concourse D at Hartsfield-Jackson; TSA re-screening lasts 3h.",  Icon: ShieldAlert,  affected: 28, dur: "6h",  difficulty: "Medium", diffClass: "text-amber-700 bg-amber-50 border-amber-200" },
  { name: "n001nb_aog",            displayName: "N001NB Mechanical AOG",      description: "Lead aircraft N001NB has hydraulic failure on landing at KATL. Grounded 8h awaiting parts.",          Icon: Wrench,       affected:  8, dur: "10h", difficulty: "Low",    diffClass: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  { name: "chicago_ground_stop",   displayName: "Chicago ARTCC Ground Stop", description: "FAA issues ground stop for all flights into KORD due to ARTCC volume / staffing.",                    Icon: OctagonAlert, affected: 35, dur: "4h",  difficulty: "Medium", diffClass: "text-amber-700 bg-amber-50 border-amber-200" },
  { name: "crew_sickout_ord",      displayName: "ORD Crew Sick-out (35%)",   description: "35% of ORD-based crews call in sick. Open pairings cascade across early-morning departures.",        Icon: HeartPulse,   affected: 42, dur: "16h", difficulty: "High",   diffClass: "text-red-700 bg-red-50 border-red-200" },
  { name: "dfw_runway_closure",    displayName: "DFW Runway 17L Closure",     description: "Foreign object debris closes 17L for 6h. DFW capacity reduced 45% during peak.",                     Icon: AlertTriangle,affected: 22, dur: "6h",  difficulty: "Medium", diffClass: "text-amber-700 bg-amber-50 border-amber-200" },
  { name: "las_vegas_atc",         displayName: "Las Vegas TRACON Shortage",  description: "L30 TRACON understaffed; arrivals into LAS held with 30-min MIT.",                                   Icon: Radio,        affected: 18, dur: "5h",  difficulty: "Low",    diffClass: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  { name: "iran_airspace_closure", displayName: "Iran Airspace Closure",      description: "Geopolitical airspace closure forces large reroutes around the region.",                            Icon: Ban,          affected: 12, dur: "24h", difficulty: "Medium", diffClass: "text-amber-700 bg-amber-50 border-amber-200" },
  { name: "volcanic_ash_pacific",  displayName: "Cascades Volcanic Ash",      description: "Ash plume from Mt. Rainier closes Pacific Northwest airspace for 18 hours.",                        Icon: Mountain,     affected: 31, dur: "20h", difficulty: "High",   diffClass: "text-red-700 bg-red-50 border-red-200" },
  { name: "cyber_incident",        displayName: "Nimbus Air Cyber Incident",   description: "CrowdStrike-style IT outage degrades departure control 60% network-wide for 12h.",                  Icon: ServerCrash,  affected: 95, dur: "14h", difficulty: "Extreme",diffClass: "text-purple-700 bg-purple-50 border-purple-200" },
]

export default function ScenariosPage() {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  const loadScenario = async (name: string) => {
    setLoading(name)
    try {
      await apiClient.post(`/simulator/scenarios/${name}/load`)
      preserveLoadedScenario()
      toast.success("Scenario loaded", { description: "Redirecting to simulator..." })
      router.push("/simulator")
    } catch (err: any) {
      toast.error("Failed to load scenario", { description: err.message })
    } finally {
      setLoading(null)
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="flex justify-center pt-4 px-4">
        <nav className="w-full max-w-6xl nav-pill-surface h-14 flex items-center justify-between pl-4 pr-3">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <OlusLogo size={36} />
            <span className="font-display font-medium text-lg">Olus</span>
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-ink font-medium transition-colors flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back home
          </Link>
        </nav>
      </div>

      <section className="max-w-7xl mx-auto px-6 py-14">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10 text-center"
        >
          <div className="section-badge mb-4">11 canned scenarios</div>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-3">Pre-built disruption scenarios</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Each scenario is a real-world style stress test — modeled from BTS / NTSB / FAA reports.
            Click <span className="font-semibold text-link">Run scenario</span> to launch it directly into the simulator.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {SCENARIOS.map((s, i) => (
            <motion.div
              key={s.name}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
                className="surface-card p-5 bg-white hover:border-ink/20 hover:-translate-y-0.5 transition-all flex flex-col"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-11 h-11 rounded-2xl bg-lifted border border-ink/10 flex items-center justify-center">
                  <s.Icon className="w-5 h-5 text-ink" />
                </div>
                <span className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border ${s.diffClass}`}>
                  {s.difficulty}
                </span>
              </div>

              <h3 className="font-display font-semibold text-base mb-1.5">{s.displayName}</h3>
              <p className="text-sm text-muted-foreground mb-4 flex-1 leading-relaxed">{s.description}</p>

              <div className="flex items-center justify-between text-xs text-muted-foreground mb-3 font-mono">
                <span>~{s.affected} flights</span>
                <span>{s.dur} cascade</span>
              </div>

              <Button
                onClick={() => loadScenario(s.name)}
                disabled={loading !== null}
                size="sm"
                className="w-full font-medium"
              >
                {loading === s.name ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Loading…</>
                ) : (
                  <>Run scenario <ArrowRight className="w-3.5 h-3.5 ml-1.5" /></>
                )}
              </Button>
            </motion.div>
          ))}
        </div>
      </section>
    </main>
  )
}
