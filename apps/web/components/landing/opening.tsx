"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { LoadingAura } from "@/components/ui/loading-aura"
import Image from "next/image"
import Link from "next/link"
import { ArrowDown, ArrowUpRight } from "lucide-react"
import { Flip, gsap } from "./gsap"
import { getLenis, mountLandingScroll } from "@/lib/scroll"
import { media } from "@/lib/media"
import { LandingNav } from "./landing-nav"
import styles from "./opening.module.css"

export function Opening() {
  const rootRef = useRef<HTMLDivElement>(null)
  const skipIntro = useRef<() => void>(() => {})
  const [fontsReady, setFontsReady] = useState(false)
  const [imageReady, setImageReady] = useState(false)
  useEffect(() => {
    let active = true
    document.fonts.ready.then(() => { if (active) setFontsReady(true) })
    return () => { active = false }
  }, [])
  useLayoutEffect(() => mountLandingScroll(), [])
  useLayoutEffect(() => {
    const root = rootRef.current!
    root.dataset.introMounted = "true"
    const mark = root.querySelector<SVGSVGElement>("[data-logo-mark]")!
    const stroke = mark.querySelector("path")!
    const cover = root.querySelector<HTMLElement>("[data-intro-cover]")!
    const chrome = root.querySelectorAll("[data-nav-chrome]")
    const wordmark = root.querySelector("[data-nav-wordmark]")
    const mm = gsap.matchMedia()
    let failSafe: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      mark.classList.remove(styles.introMark)
      cover.style.display = "none"
      getLenis()?.start()
      root.dataset.ready = "true"
      document.documentElement.setAttribute("data-olus-intro", "seen")
      delete root.dataset.introRunning
    }
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      delete root.dataset.ready
      root.dataset.introRunning = "true"
      getLenis()?.stop()
      mark.classList.add(styles.introMark)
      const length = stroke.getTotalLength()
      gsap.set(cover, { display: "block", autoAlpha: 1, clipPath: "inset(0 0 0 0 round 0 0 0 0)" })
      gsap.set(chrome, { autoAlpha: 0 })
      gsap.set(wordmark, { clipPath: "inset(0 100% 0 0)" })
      gsap.set(stroke, { strokeDasharray: length, strokeDashoffset: length, fillOpacity: 0, strokeOpacity: 1 })
      const tl = gsap.timeline({ onComplete: () => finish() })
      tl.to(stroke, { strokeDashoffset: 0, duration: .85, ease: "power2.inOut" })
        .to(stroke, { fillOpacity: 1, strokeOpacity: 0, duration: .35 }, .85)
        .add(() => {
          const state = Flip.getState(mark)
          mark.classList.remove(styles.introMark)
          Flip.from(state, { duration: .8, ease: "expo.inOut", absolute: true })
        }, 1.2)
        .to(root.querySelector("[data-liquid]"), { scale: 0, opacity: 0, duration: .3, ease: "power2.inOut" }, .9)
        .to(cover, { clipPath: "inset(100% 0 0 0 round 28px 28px 0 0)", duration: .8, ease: "expo.inOut" }, 1.2)
        .to(wordmark, { clipPath: "inset(0)", duration: .6, ease: "power3.out" }, 1.4)
        .fromTo(chrome, { y: -8 }, { y: 0, autoAlpha: 1, stagger: .05, duration: .25 }, 1.85)
        .fromTo(root.querySelectorAll("[data-headline-line]"), { yPercent: 110 }, { yPercent: 0, stagger: .08, duration: .35, ease: "power3.out" }, 1.85)
      skipIntro.current = () => { tl.progress(1); finish() }
      failSafe = setTimeout(skipIntro.current, 2400)
      gsap.fromTo(root.querySelector("[data-hero]"), { filter: "brightness(1)" }, {
        scale: .94, borderRadius: "0 0 56px 56px", filter: "brightness(.8)", ease: "none",
        scrollTrigger: { trigger: root.querySelector("[data-hero]"), start: "top top", end: () => "+=" + window.innerHeight * 1.2, scrub: .8, pin: true, invalidateOnRefresh: true },
      })
      gsap.fromTo(root.querySelector("[data-caption]"), { opacity: .65 }, {
        opacity: 1, ease: "none", scrollTrigger: { trigger: root, start: "top top", end: "top -35%", scrub: .8 },
      })
    }, root)
    mm.add("(prefers-reduced-motion: reduce)", () => {
      gsap.fromTo(cover, { display: "block", opacity: 1 }, { opacity: 0, duration: .2, onComplete: () => finish() })
    }, root)
    return () => { clearTimeout(failSafe); mm.revert(); finish() }
  }, [])
  return (
    <div ref={rootRef} className={styles.opening}>
      <a className={styles.skip} href="#main-content">Skip to content</a>
      <LandingNav />
      <div data-intro-cover className={styles.introCover}>
        <div data-liquid className={styles.liquid}><LoadingAura progress={(Number(fontsReady) + Number(imageReady)) / 2}/></div>
        <div className={styles.loadingCopy}><p role="status">{!fontsReady ? "Preparing typography..." : !imageReady ? "Loading airport image..." : "Ready for departure"}</p><button type="button" onClick={() => skipIntro.current()}>Skip &rarr;</button></div>
      </div>
      <section id="main-content" data-hero className={styles.hero} aria-labelledby="hero-heading" tabIndex={-1}>
        <Image src={media.hero.src} alt={media.hero.alt} fill priority sizes="100vw" placeholder="blur" className={styles.photo} onLoad={() => setImageReady(true)} />
        <div className={styles.shade} aria-hidden="true" />
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>Airline disruption recovery, simulated.</p>
          <h1 id="hero-heading" className={styles.headline}>
            <span className={styles.line}><span data-headline-line>Disruption happens.</span></span>
            <span className={styles.line}><span data-headline-line>Recovery is solved.</span></span>
          </h1>
          <p className={styles.lead}>See the ripple. Compare the recovery.<br />Put a defensible plan in your dispatcher’s hands.</p>
          <div className={styles.actions}>
            <Link className={styles.button + " " + styles.primary} href="/simulator">Open the workspace <ArrowUpRight size={17} /></Link>
            <a className={styles.button} href="#demo">Watch the recovery <ArrowDown size={17} /></a>
          </div>
        </div>
        <div className={styles.heroFoot}>
          <p data-caption className={styles.caption}>A simulated network. Real constraints.<br />Recovery decisions you can inspect and explain.</p>
          <a href="#demo" aria-label="Scroll to the recovery demo">Scroll to explore <ArrowDown size={18} /></a>
        </div>
      </section>
      <div className={styles.identity}>
        <span className={styles.wordmark} aria-hidden="true">olus</span>
        <div className={styles.identityCopy}>
          <strong>Keep the whole day in view.</strong>
          <p>Weather closes a hub. Aircraft move out of position. Crew clocks keep running. See what each recovery choice changes, before you commit.</p>
        </div>
      </div>
    </div>
  )
}
