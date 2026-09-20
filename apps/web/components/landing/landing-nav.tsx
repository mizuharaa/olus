"use client"

import { OLUS_MARK_PATH } from "@/components/ds/logo"
import Image from "next/image"
import Link from "next/link"
import { ArrowUpRight, X } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import { gsap, ScrollTrigger } from "./gsap"
import { getLenis } from "@/lib/scroll"
import { media } from "@/lib/media"
import styles from "./opening.module.css"

const items = [
  { label: "Platform", href: "/simulator", image: media.hero, tone: "night" },
  { label: "Solver", href: "/docs#optimizer", image: media.approach, tone: "clear" },
  { label: "Scenarios", href: "/scenarios", image: media.sunset, tone: "dawn" },
  { label: "Benchmarks", href: "/simulator/stress-test", image: media.approach, tone: "night" },
  { label: "Docs", href: "/docs", image: media.hero, tone: "clear" },
  { label: "About", href: "/docs#architecture", image: media.cabin, tone: "dawn" },
]

export function LandingNav() {
  const navRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [tone, setTone] = useState("night")
  const hoverBlocked = useRef(false)
  const closeRef = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const nav = navRef.current!
    const mm = gsap.matchMedia()
    mm.add("all", () => {
      ScrollTrigger.create({ start: 80, end: "max", toggleClass: { targets: nav, className: styles.scrolled } })
    })
    return () => mm.revert()
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const dialog = dialogRef.current!
    dialog.showModal()
    getLenis()?.stop()
    dialog.querySelector<HTMLAnchorElement>("a")?.focus()
    const finish = () => { hoverBlocked.current = true; dialog.close(); setOpen(false); getLenis()?.start(); triggerRef.current?.focus() }
    const mm = gsap.matchMedia()
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const timeline = gsap.timeline()
      timeline.fromTo(dialog, { clipPath: "inset(0 0 100% 0)", opacity: 0 }, { clipPath: "inset(0)", opacity: 1, duration: .5, ease: "expo.out" })
        .fromTo(dialog.querySelectorAll("[data-menu-image]"), { scaleY: .03, clipPath: "inset(0 0 95% 0)" }, { scaleY: 1, clipPath: "inset(0)", duration: .7, stagger: .06, ease: "expo.out" }, .08)
      closeRef.current = () => { if (timeline.time() === 0) finish(); else timeline.eventCallback("onReverseComplete", finish).timeScale(.85).reverse() }
    }, dialog)
    mm.add("(prefers-reduced-motion: reduce)", () => { closeRef.current = finish }, dialog)
    return () => { mm.revert(); dialog.close(); getLenis()?.start() }
  }, [open])

  return (
    <>
      <header ref={navRef} className={styles.nav}>
        <button ref={triggerRef} data-nav-chrome className={styles.menuButton} aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={open} onPointerLeave={() => { hoverBlocked.current = false }} onPointerEnter={event => { if (event.pointerType === "mouse" && !hoverBlocked.current) setOpen(true) }} onClick={() => setOpen(true)}>
          <span className={styles.bars} aria-hidden="true"><i /><i /><i /></span><span>Explore</span>
        </button>
        <Link className={styles.brand} href="/" aria-label="Olus home">
          <span className={styles.markSlot}><svg data-logo-mark className={styles.mark} viewBox="0 0 36 36" aria-hidden="true">
            <path d={OLUS_MARK_PATH} fill="currentColor" stroke="currentColor" strokeWidth=".7" />
          </svg></span>
          <span data-nav-wordmark className={styles.brandText}>olus</span>
        </Link>
        <nav data-nav-chrome className={styles.navRight} aria-label="Quick links">
          <Link href="/docs" className={styles.docsLink}>Docs <ArrowUpRight size={14} /></Link>
          <Link href="/simulator" className={styles.button + " " + styles.primary}><span className={styles.workspaceLong}>Open workspace</span><span className={styles.workspaceShort}>Workspace</span></Link>
        </nav>
      </header>
      <dialog ref={dialogRef} className={styles.menu} data-tone={tone} aria-label="Explore Olus" onCancel={event => { event.preventDefault(); closeRef.current() }} onClick={event => { if (event.target === dialogRef.current) closeRef.current() }}>
        <div className={styles.menuGlow} aria-hidden="true">{["night", "dawn", "clear"].map(value => <span key={value} data-gradient={value} style={{ opacity: tone === value ? 1 : 0 }} />)}</div>
        <div className={styles.menuHeader}><p>A clearer view of recovery.</p><button className={styles.close} onClick={() => closeRef.current()} aria-label="Close navigation"><X size={20} /></button></div>
        <nav className={styles.menuGrid} aria-label="Explore">
          {items.map((item, index) => <a key={item.label} href={item.href} className={styles.menuItem} onPointerEnter={() => setTone(item.tone)} onFocus={() => setTone(item.tone)} onClick={() => closeRef.current()}>
            <span data-menu-image className={styles.menuImage}><Image src={item.image.src} alt="" fill sizes="(max-width:767px) 45vw, 30vw" placeholder="blur" /></span>
            <span className={styles.menuLabel}>{item.label}<ArrowUpRight size={18} /><small>{String(index + 1).padStart(2, "0")}</small></span>
          </a>)}
        </nav>
        <div className={styles.menuFoot}><span>Airline recovery, made inspectable.</span><span>Simulated operations · Nimbus Air</span></div>
      </dialog>
    </>
  )
}
