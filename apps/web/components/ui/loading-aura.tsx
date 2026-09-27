"use client"

import { useEffect, useId, useState } from "react"
import styles from "./loading-aura.module.css"

/** Progress is completed prerequisites / total prerequisites, never elapsed time. */
export function LoadingAura({ progress = 0 }: { progress?: number }) {
  const id = useId().replace(/:/g, "")
  const [motion, setMotion] = useState(false)
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setMotion(!query.matches)
    update(); query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  if (!motion) return null
  return <svg className={styles.aura} viewBox="0 0 240 240" aria-hidden="true" style={{ opacity: .35 + Math.max(0, Math.min(1, progress)) * .4 }}>
    <defs>
      <linearGradient id={`${id}-color`}><stop stopColor="var(--disrupt)"/><stop offset="1" stopColor="var(--recover)"/></linearGradient>
      <filter id={`${id}-flow`} x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="2" seed="7">
          <animate attributeName="baseFrequency" values=".018;.025;.016;.018" dur="9.7s" repeatCount="indefinite"/>
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" scale="18"/><feGaussianBlur stdDeviation="2"/>
      </filter>
    </defs>
    <g filter={`url(#${id}-flow)`} fill="none" stroke={`url(#${id}-color)`} strokeWidth={3 + progress * 5}>
      <path className={styles.outer} d="M120 36C173 26 207 81 198 126S161 204 112 199S34 167 40 112S70 45 120 36Z"/>
      <path className={styles.inner} d="M120 47C172 38 192 73 186 123S150 185 109 192S43 150 51 106S74 52 120 47Z"/>
    </g>
  </svg>
}
