"use client"

import { useEffect, useState } from "react"
import { useSimulationStore } from "@/stores/simulation"
import { OlusMark } from "@/components/ds/logo"
import { LoadingAura } from "@/components/ui/loading-aura"
import styles from "./dashboard-loader.module.css"

export function DashboardLoader() {
  const ready = useSimulationStore(s => s.schedule.length > 0)
  const [visible, setVisible] = useState(true)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    const deadline = setTimeout(() => setLeaving(true), reduced ? 0 : 700)
    return () => clearTimeout(deadline)
  }, [])
  useEffect(() => { if (ready) setLeaving(true) }, [ready])
  useEffect(() => {
    if (!leaving) return
    const fade = setTimeout(() => setVisible(false), 200)
    return () => clearTimeout(fade)
  }, [leaving])
  if (!visible) return null
  return <div className={styles.loader} data-app-loader data-leaving={leaving}>
    <div className={styles.mark}><LoadingAura progress={ready ? 1 : 0}/><OlusMark size={120}/></div>
    <p role="status">{ready ? "Schedule ready" : "Opening workspace..."}</p>
    <button type="button" onClick={() => setLeaving(true)}>Skip &rarr;</button>
  </div>
}
