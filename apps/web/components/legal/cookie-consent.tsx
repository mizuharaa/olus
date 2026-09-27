"use client"
/**
 * CookieConsent — a GDPR/ePrivacy-style consent banner shown until the visitor
 * makes a choice. Olus sets only first-party functional storage (theme, map
 * focus, rail collapse, and this consent record) — no third-party ad/analytics
 * cookies — so the banner offers Accept / Reject / details, records the choice
 * in localStorage, and never blocks the page. Mounted once in the root layout.
 *
 * The choice is stored under `olus-cookie-consent` as "all" | "essential".
 * Reject still keeps essential functional storage (needed for the app to work)
 * but signals that no optional analytics should ever be initialised.
 */

import Link from "next/link"
import { useEffect, useRef, useState } from "react"

const KEY = "olus-cookie-consent"

export function CookieConsent() {
  const [open, setOpen] = useState(false)
  const banner = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !banner.current) return
    const update = () => document.documentElement.style.setProperty("--consent-height", `${banner.current?.getBoundingClientRect().height ?? 0}px`)
    const observer = new ResizeObserver(update)
    observer.observe(banner.current)
    update()
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--consent-height") }
  }, [open])

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true)
    } catch {
      // storage blocked — show the banner but choices simply won't persist
      setOpen(true)
    }
  }, [])

  const choose = (value: "all" | "essential") => {
    try {
      localStorage.setItem(KEY, value)
      localStorage.setItem(`${KEY}-at`, new Date().toISOString())
    } catch {}
    setOpen(false)
  }

  if (!open) return null

  return (
    <div
      ref={banner}
      role="dialog"
      aria-label="Cookie preferences"
      aria-live="polite"
      /* A CENTRED SLIM BAR, not a bottom-left block.
       *
       * As a 420×206 card pinned to the bottom-left corner this covered the
       * console's Events list — the primary control on the page — on every
       * first visit, and on the landing it sat on top of the hero copy. Both
       * corners of an ops console are claimed (panel launcher bottom-left, map
       * instruments and timeline controls bottom-right), so the honest place
       * for a site-wide notice is the middle of the bottom edge, laid out
       * horizontally so it is ~72px tall instead of ~206px.
       *
       * It still never blocks the page: no backdrop, no focus trap. */
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "clamp(10px, 2vw, 20px)",
        zIndex: 9000,
        width: "min(760px, calc(100vw - 24px))",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        background: "#14100F",
        color: "#F2ECE1",
        border: "1px solid rgba(242, 236, 225, 0.16)",
        borderRadius: 14,
        boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
        padding: "13px 16px",
        fontFamily: 'Inter, "Inter Display", system-ui, sans-serif',
      }}
    >
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650, letterSpacing: "-0.01em", marginBottom: 3 }}>
          Cookies &amp; local storage
        </div>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "rgba(242, 236, 225, 0.72)" }}>
          First-party functional storage only (theme, map focus, layout). No third-party
          advertising or cross-site tracking. See our{" "}
          {/* #D9A441, not #B8863C: the old gold measured 3.94:1 on this near-black
              card, under AA for 12px body text. */}
          <Link href="/cookies" style={{ color: "#D9A441", textDecoration: "underline" }}>
            Cookie Policy
          </Link>{" "}
          and{" "}
          <Link href="/privacy" style={{ color: "#D9A441", textDecoration: "underline" }}>
            Privacy Policy
          </Link>
          .
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => choose("essential")}
          style={{
            minHeight: 38,
            padding: "0 16px",
            borderRadius: 999,
            border: "1px solid rgba(242, 236, 225, 0.28)",
            background: "transparent",
            color: "#F2ECE1",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Essential only
        </button>
        <button
          type="button"
          onClick={() => choose("all")}
          style={{
            minHeight: 38,
            padding: "0 18px",
            borderRadius: 999,
            border: "none",
            background: "#D9A441",
            color: "#14100F",
            fontSize: 13,
            fontWeight: 650,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Accept all
        </button>
      </div>
    </div>
  )
}
