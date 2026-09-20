/** Shared Olus O-loop. Legacy props remain compatible with existing callers. */
import type { CSSProperties } from "react"

export const OLUS_MARK_PATH = "M5 23C8 12 17 5 26 7C35 9 31 20 22 26C13 32 3 27 5 23ZM9 22C10 26 16 27 22 23C28 19 31 12 25 11C19 9 12 15 9 22Z"

export function OlusMark({
  size = 34,
  accent: _accent,
  ink: _ink,
  radius: _radius,
  className,
  style,
}: {
  size?: number
  accent?: string
  ink?: string
  radius?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={className}
      aria-label="Olus"
      role="img"
      style={{ display: "inline-flex", flexShrink: 0, width: size, height: size, ...style }}
    >
      <svg viewBox="0 0 36 36" width="100%" height="100%" style={{ display: "block" }}>
        <path d={OLUS_MARK_PATH} fill="currentColor" />
      </svg>
    </span>
  )
}

export function OlusLogo({
  size = 34,
  radius: _radius, // kept for call-site compatibility
  className,
  style,
}: {
  size?: number
  radius?: number
  className?: string
  style?: CSSProperties
}) {
  return <OlusMark size={size} className={className} style={style} />
}
