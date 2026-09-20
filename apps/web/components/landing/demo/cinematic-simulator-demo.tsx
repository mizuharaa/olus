"use client"
/** Scroll-owned recovery demonstration. One pin coordinates the device,
 * headline, and four illustrative recovery stages; reduced motion stays static. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { CloudLightning, FileText, LayoutGrid, Leaf, Route, Users } from "lucide-react"
import { gsap, ScrollTrigger } from "@/components/landing/gsap"
import { OlusMark } from "@/components/ds/logo"
import { DemoMap } from "@/components/landing/demo/demo-map"
import { AgentCommandDemo } from "@/components/landing/demo/agent-command-demo"
import { CursorChoreography } from "@/components/landing/demo/cursor-choreography"
import { LaptopStage } from "@/components/landing/demo/laptop-stage"
import {
  AGENT_COMMAND,
  DEMO_STEPS,
  FLIGHT_GEO,
  KORD,
  PLANS,
  WORLD_H,
  WORLD_W,
  bezAngle,
  bezPoint,
} from "@/components/landing/demo/demo-data"
import {
  getLenis,
  landingScroll,
  queueLandingRefresh,
  registerLandingFrame,
  resetLandingScene,
} from "@/lib/scroll"

const STATUS = [
  { label: "Nominal", color: "var(--dk-teal)" },
  { label: "Disrupted", color: "var(--dk-rose)" },
  { label: "Recovering", color: "#B8863C" },
  { label: "Stable", color: "var(--dk-teal)" },
]

const RAIL_ICONS = [LayoutGrid, CloudLightning, Route, Users, Leaf, FileText]
/** which rail icon is "active" per scene */
const RAIL_ACTIVE = [0, 1, 2, 5]

// Mirrors the real simulator's event LEDGER (mono index + name — see
// event-panel.tsx), so the demo previews the product that actually ships.
const EVENT_ROWS = [
  { label: "Weather closure", hot: true },
  { label: "Ground stop" },
  { label: "Runway closure" },
  { label: "Crew sick-out" },
]

/** loop length in seconds + where each caption scene starts */
const TOTAL = 25
const SCENE_STARTS = [0, 7.8, 15.2, 18.4]

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = gsap.utils.clamp(0, 1, (value - edge0) / (edge1 - edge0))
  return x * x * (3 - 2 * x)
}

export function CinematicSimulatorDemo() {
  const rootRef = useRef<HTMLElement>(null)
  const tlRef = useRef<gsap.core.Timeline | null>(null)
  const [staticMode, setStaticMode] = useState(false)
  const [screenReady, setScreenReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const sceneRef = useRef(0)
  // 0 nominal · 1 disrupted/hold · 2 recovering · 3 stable — drives the plane loop
  const phaseRef = useRef(0)
  // Set by the matchMedia effect; called by LaptopStage on every hinge change.
  // A ref, not state: the hinge updates every frame and this must not re-render.
  const openHandlerRef = useRef<
    ((open: number, pushed: number) => void) | null
  >(null)
  const handleOpenChange = useCallback((open: number, pushed: number) => {
    openHandlerRef.current?.(open, pushed)
  }, [])

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce), (max-width: 639px)")
    const sync = () => setStaticMode(preference.matches)
    sync()
    preference.addEventListener("change", sync)
    return () => preference.removeEventListener("change", sync)
  }, [])

  const connectScreen = useCallback((node: HTMLDivElement | null) => {
    if (node) setScreenReady(true)
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || staticMode || !screenReady) return

    const q = gsap.utils.selector(root)
    const mm = gsap.matchMedia()

    mm.add(
      {
        desktop: "(min-width: 40rem) and (prefers-reduced-motion: no-preference)",
        mobile: "(max-width: 39.99rem) and (prefers-reduced-motion: no-preference)",
      },
      (mctx) => {
        const mobile = Boolean(mctx.conditions?.mobile)
        const canvas = q(".dm-canvas")[0] as HTMLElement
        const world = q(".dm-world")[0] as HTMLElement
        if (!canvas || !world) return

        const fit = () => {
          const r = canvas.getBoundingClientRect()
          const s = Math.max(r.width / WORLD_W, r.height / WORLD_H) * 1.05
          return { s, x: (r.width - WORLD_W * s) / 2, y: (r.height - WORLD_H * s) / 2 }
        }
        /** camera transform putting world point (wx,wy) at canvas fraction (ox,oy) */
        const cam = (wx: number, wy: number, zoom: number, ox = 0.5, oy = 0.5) => {
          const r = canvas.getBoundingClientRect()
          const s = fit().s * zoom
          return { scale: s, x: r.width * ox - wx * s, y: r.height * oy - wy * s }
        }

        const kordZoom = mobile ? 2.15 : 1.8
        const typeProxy = { n: 0 }
        const heldProxy = { v: 0 }
        const cxlProxy = { v: 16 }
        const paxProxy = { v: 0 }
        const costProxy = { v: 0 }

        const cmdEl = q(".ag-cmd")[0] as HTMLElement
        const heldEl = q(".dm-held-n")[0] as HTMLElement
        const mCxl = q(".dm-m-cxl")[0] as HTMLElement
        const mPax = q(".dm-m-pax")[0] as HTMLElement
        const mCost = q(".dm-m-cost")[0] as HTMLElement

        // ── live flight loop ──────────────────────────────────────────
        // One rAF pass moves every plane along its arc at its own speed.
        // Background flights always cruise; hub flights freeze amber while
        // the closure holds (phase 1), then re-flow teal on their reroute
        // arcs once recovery commits (phase ≥ 2). Independent of the GSAP
        // timeline, gated to on-screen by the ScrollTrigger below.
        const geo = FLIGHT_GEO
        const planes = q(".dm-plane") as HTMLElement[]
        const glyphs = planes.map((p) => p.querySelector(".dm-plane-glyph") as HTMLElement)
        const holds = planes.map((p) => p.querySelector(".dm-plane-hold") as HTMLElement)
        const rt = geo.map(() => ({ color: "" }))
        // thin out background traffic on small screens for headroom
        if (mobile) geo.forEach((f, i) => { if (f.role === "bg" && i % 2 === 1 && planes[i]) planes[i].style.display = "none" })

        let running = false
        const paint = (i: number, c: string) => {
          if (rt[i].color !== c) { rt[i].color = c; if (planes[i]) planes[i].style.color = c }
        }
        const frame = () => {
          if (!running) return
          const timelineTime = tlRef.current?.time() ?? 0
          const phase = phaseRef.current
          for (let i = 0; i < geo.length; i++) {
            const el = planes[i]
            if (!el || el.style.display === "none") continue
            const f = geo[i]
            const s = rt[i]
            const hub = f.role !== "bg"
            const onReroute = hub && phase >= 2
            const held = hub && phase === 1
            const path = onReroute ? f.reroute : f.primary
            const movingT = (f.phase + timelineTime / f.dur) % 1
            const heldT = (f.phase + 9.3 / f.dur) % 1
            const flightT = held ? heldT : movingT
            const pt = bezPoint(path, flightT)
            const bob = held
              ? Math.sin(timelineTime * 3.4 + i * 1.3) * 2.2
              : 0
            el.style.transform = `translate(${pt.x}px, ${(pt.y + bob).toFixed(2)}px)`
            glyphs[i].style.transform = `rotate(${bezAngle(path, flightT).toFixed(1)}deg)`
            paint(i, held ? "var(--dk-amber)" : onReroute && phase === 2 ? "var(--dk-amber)" : "#5B3FA8")
            if (holds[i]) holds[i].style.opacity = held ? "1" : "0"
          }
        }
        const unregisterFlightFrame = registerLandingFrame(frame)
        const startFlights = () => {
          running = true
        }
        const stopFlights = () => {
          running = false
        }

        const tl = gsap.timeline({
          paused: true,
          defaults: { ease: "power2.inOut" },
          onUpdate: () => {
            const t = tl.time()
            // network phase drives the live plane loop; derived from time so
            // seeking the captions keeps the fleet in the right state.
            phaseRef.current = t < 9.3 ? 0 : t < 18.1 ? 1 : t < 21.5 ? 2 : 3
            const s = t < SCENE_STARTS[1] ? 0 : t < SCENE_STARTS[2] ? 1 : t < SCENE_STARTS[3] ? 2 : 3
            if (s !== sceneRef.current) {
              sceneRef.current = s
              root.dataset.demoScene = String(s)
              ;(q(".dm-rail-icon") as HTMLElement[]).forEach((element, index) => {
                element.dataset.active = String(RAIL_ACTIVE[s] === index)
              })
              ;(q(".dm-cap") as HTMLElement[]).forEach((element, index) => {
                element.dataset.active = String(s === index)
              })
            }
          },
        })
        tlRef.current = tl
        // dev-only handle so the loop can be seeked deterministically in tests
        if (process.env.NODE_ENV !== "production") {
          ;(window as unknown as { __demoTL?: gsap.core.Timeline }).__demoTL = tl
        }

        // ── 0s · reset framing ─────────────────────────────────────────
        tl.set(world, { scale: () => fit().s, x: () => fit().x, y: () => fit().y }, 0)
        tl.fromTo(q(".dm-playhead"), { scaleX: 0 }, { scaleX: 1, duration: TOTAL, ease: "none" }, 0)

        // ── 0.3–4.6s · the agent types ────────────────────────────────
        tl.fromTo(q(".ag-card"), { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" }, 0.3)
        tl.set(q(".ag-caret"), { opacity: 1 }, 0.9)
        tl.to(
          typeProxy,
          {
            n: AGENT_COMMAND.length,
            duration: 3.2,
            ease: "none",
            onUpdate: () => {
              if (cmdEl) cmdEl.textContent = AGENT_COMMAND.slice(0, Math.round(typeProxy.n))
            },
          },
          1.2,
        )
        tl.set(q(".ag-caret"), { opacity: 0 }, 4.6)

        // ── 4.7–8s · cursor opens the event selector, clicks the storm ─
        // Follows the selector to the right-hand side, and the panel now slides
        // in from the right edge rather than the left.
        const evTarget = { left: mobile ? "76%" : "84%", top: "26%" }
        tl.fromTo(q(".dm-events"), { x: 14, opacity: 0 }, { x: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, 4.7)
        tl.fromTo(q(".demo-cursor"), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 4.7)
        tl.to(q(".demo-cursor"), { left: evTarget.left, top: evTarget.top, duration: 1.5, ease: "power2.inOut" }, 5.0)
        tl.to(q(".demo-cursor"), { scale: 0.82, duration: 0.18, yoyo: true, repeat: 1 }, 6.6)
        tl.fromTo(
          q(".demo-click"),
          { left: evTarget.left, top: evTarget.top, scale: 0.4, opacity: 0.9 },
          { scale: 1.9, opacity: 0, duration: 0.7 },
          6.6,
        )
        tl.to(q(".dm-evrow-hot"), { backgroundColor: "rgba(236, 72, 153, 0.10)", borderColor: "rgba(236, 72, 153, 0.55)", duration: 0.4 }, 6.7)
        tl.fromTo(q(".dm-sev-fill"), { opacity: 0.15 }, { opacity: 1, duration: 0.25, stagger: 0.12 }, 7.0)
        tl.to(q(".demo-cursor"), { opacity: 0, duration: 0.4 }, 7.6)
        tl.to(q(".dm-events"), { x: 14, opacity: 0, duration: 0.6, ease: "power2.in" }, 7.9)

        // ── 8–15s · fly to KORD, cascade spreads ──────────────────────
        tl.to(q(".st-0"), { opacity: 0, duration: 0.4 }, 8.0)
        tl.to(q(".st-1"), { opacity: 1, duration: 0.4 }, 8.2)
        tl.to(world, {
          scale: () => cam(KORD.x, KORD.y, kordZoom, 0.47, 0.4).scale,
          x: () => cam(KORD.x, KORD.y, kordZoom, 0.47, 0.4).x,
          y: () => cam(KORD.x, KORD.y, kordZoom, 0.47, 0.4).y,
          duration: 2.6,
          ease: "power3.inOut",
        }, 8.0)
        tl.fromTo(q(".ag-line-0"), { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.5 }, 8.8)
        tl.to(q(".dm-kord-dot"), { borderColor: "#C13A6B", background: "#F6DCE6", duration: 0.5 }, 9.4)
        tl.to(q(".dm-kord-rings"), { opacity: 1, duration: 0.5 }, 9.7)

        tl.fromTo(q(".dm-held"), { y: -10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 10.4)
        tl.to(
          heldProxy,
          {
            v: 47,
            duration: 3.2,
            ease: "power1.inOut",
            onUpdate: () => {
              if (heldEl) heldEl.textContent = String(Math.round(heldProxy.v))
            },
          },
          10.4,
        )
        tl.to(q(".dm-c1"), { strokeDashoffset: 0, duration: 1.7, stagger: 0.16, ease: "sine.inOut" }, 10.5)
        tl.to(q('[data-wave="1"] .dm-ap-dot'), { borderColor: "#B8863C", background: "#F7EAD5", duration: 0.6, stagger: 0.08 }, 11.4)
        tl.to(q('[data-wave="2"] .dm-ap-dot'), { borderColor: "#B8863C", background: "#F7EAD5", duration: 0.6, stagger: 0.08 }, 13.2)
        tl.fromTo(q(".ag-line-1"), { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.5 }, 12.9)
        tl.to(world, { x: "-=26", y: "-=12", duration: 6, ease: "none" }, 10.8)

        // ── 15.2–18.4s · four plans, cursor commits B ─────────────────
        tl.to(q(".dm-held"), { opacity: 0, y: -8, duration: 0.6 }, 15.0)
        // x:0 in both states: GSAP parses the React inline translateX(108%)
        // into a PIXEL x cache, which would otherwise survive the xPercent
        // tween and keep the panel offscreen.
        tl.fromTo(q(".dm-plans"), { xPercent: 108, x: 0 }, { xPercent: 0, x: 0, duration: 1.0, ease: "power3.out" }, 15.2)
        tl.fromTo(q(".dm-plan"), { y: 12, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.15, duration: 0.6, ease: "power3.out" }, 15.5)
        tl.fromTo(q(".ag-line-2"), { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.5 }, 16.1)

        const planTarget = { left: mobile ? "72%" : "84%", top: "36%" }
        tl.set(q(".demo-cursor"), { left: "58%", top: "72%" }, 16.3)
        tl.to(q(".demo-cursor"), { opacity: 1, duration: 0.4 }, 16.4)
        tl.to(q(".demo-cursor"), { left: planTarget.left, top: planTarget.top, duration: 1.3, ease: "power2.inOut" }, 16.5)
        tl.to(q(".demo-cursor"), { scale: 0.82, duration: 0.18, yoyo: true, repeat: 1 }, 17.9)
        tl.fromTo(
          q(".demo-click"),
          { left: planTarget.left, top: planTarget.top, scale: 0.4, opacity: 0.9 },
          { scale: 1.9, opacity: 0, duration: 0.7 },
          17.9,
        )
        tl.to(q(".dm-plan-b"), { borderColor: "#5B3FA8", backgroundColor: "rgba(91, 63, 168, 0.08)", duration: 0.4 }, 18.1)
        tl.to(q(".dm-plan:not(.dm-plan-b)"), { opacity: 0.5, duration: 0.5 }, 18.3)
        tl.to(q(".demo-cursor"), { opacity: 0, duration: 0.4 }, 18.9)

        // ── 18.4–25s · commit: metrics, reroutes, toast, pull back ────
        tl.to(q(".st-1"), { opacity: 0, duration: 0.4 }, 18.6)
        tl.to(q(".st-2"), { opacity: 1, duration: 0.4 }, 18.8)
        tl.fromTo(q(".dm-metrics"), { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, 18.5)
        tl.to(cxlProxy, {
          v: 3, duration: 3.0, ease: "power1.inOut",
          onUpdate: () => { if (mCxl) mCxl.textContent = String(Math.round(cxlProxy.v)) },
        }, 18.8)
        tl.to(paxProxy, {
          v: 4860, duration: 3.0, ease: "power1.inOut",
          onUpdate: () => { if (mPax) mPax.textContent = Math.round(paxProxy.v).toLocaleString("en-US") },
        }, 18.8)
        tl.to(costProxy, {
          v: 1.7, duration: 3.0, ease: "power1.inOut",
          onUpdate: () => { if (mCost) mCost.textContent = `−$${costProxy.v.toFixed(1)}M` },
        }, 18.8)
        tl.to(q(".dm-rr"), { strokeDashoffset: 0, duration: 1.8, stagger: 0.3, ease: "sine.inOut" }, 18.9)
        tl.to(q(".dm-cascade"), { opacity: 0.22, duration: 1.5 }, 19.0)
        tl.to(q(".dm-ap-dot"), { borderColor: "#7E98A8", background: "#FFFFFF", duration: 1.2, stagger: 0.05 }, 19.8)
        tl.to(q(".dm-ring"), { borderColor: "#5B3FA8", duration: 0.6 }, 21.2)
        tl.fromTo(q(".ag-line-3"), { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.5 }, 21.9)
        tl.fromTo(q(".dm-toast"), { y: -12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, 22.5)
        tl.to(q(".st-2"), { opacity: 0, duration: 0.4 }, 23.0)
        tl.to(q(".st-3"), { opacity: 1, duration: 0.4 }, 23.2)
        // return exactly to the start framing so the loop cuts cleanly
        tl.to(world, {
          scale: () => fit().s,
          x: () => fit().x,
          y: () => fit().y,
          duration: 2.2,
          ease: "power3.inOut",
        }, 22.8)
        tl.set({}, {}, TOTAL)

        const headline = q(".dm-headline")[0] as HTMLElement
        const captions = q(".dm-captions-row")[0] as HTMLElement
        gsap.set(captions, { opacity: mobile ? 1 : 0, y: mobile ? 0 : 18 })

        // The title card holds over the closed device and lifts as the lid
        // opens; the caption rail takes its place once the loop is running.
        // Both are functions of the HINGE, not of scroll position — the lid
        // is what tells the viewer the console is live.
        const applyOpen = (open: number, pushed: number) => {
          // On mobile the title card is a normal block in the column, not an
          // overlay: fading it there left its full height as dead space above
          // the device instead of handing the frame over to it.
          const copyExit = mobile ? 0 : smoothstep(0.08, 0.55, open)
          // The caption rail leaves as the push-in closes on the panel — at
          // 2.35x the device covers the frame and the rail would print on it.
          const captionEntry = mobile
            ? 1
            : smoothstep(0.55, 0.95, open) * (1 - smoothstep(0.25, 0.7, pushed))
          headline.style.opacity = String(1 - copyExit)
          headline.style.transform = `translate3d(0, ${(-copyExit * 9).toFixed(3)}%, 0)`
          captions.style.opacity = String(captionEntry)
          captions.style.transform = `translate3d(0, ${(18 * (1 - captionEntry)).toFixed(3)}px, 0)`
        }
        applyOpen(0, 0)
        openHandlerRef.current = applyOpen

        // One scroll position owns the device and all four recovery stages.
        tl.repeat(0)
        const syncPlayback = () => {
          const progress = landingScroll.scenes.demo
          if (!pausedRef.current && !document.hidden) {
            tl.pause().time(gsap.utils.clamp(0, 1, (progress - .25) / .6) * TOTAL, false)
          }
          if (progress > .25 && progress < .9 && !pausedRef.current && !document.hidden) startFlights()
          else stopFlights()
        }
        const unregisterPlaybackFrame = registerLandingFrame(syncPlayback)

        // The pin: it owns the physical choreography only. `scenes.demo` is what
        // laptop-stage reads for the lid and the push-in.
        const deviceTween = gsap.fromTo(
          landingScroll.scenes,
          { demo: 0 },
          {
            demo: 1,
            ease: "none",
            scrollTrigger: {
              id: "olus-demo",
              trigger: root,
              start: "top top",
              end: () => "+=" + window.innerHeight * 3.5,
              scrub: 1.1,
              pin: true,
              pinSpacing: true,
              anticipatePin: 1,
              invalidateOnRefresh: true,
              fastScrollEnd: true,
            },
          },
        )

        queueLandingRefresh()
        const onResize = () => tl.invalidate()
        window.addEventListener("resize", onResize)

        return () => {
          window.removeEventListener("resize", onResize)
          unregisterPlaybackFrame()
          deviceTween.scrollTrigger?.kill()
          deviceTween.kill()
          stopFlights()
          unregisterFlightFrame()
          openHandlerRef.current = null
          resetLandingScene("demo")
          tl.kill()
          if (tlRef.current === tl) tlRef.current = null
        }
      },
      root,
    )

    return () => mm.revert()
  }, [screenReady, staticMode])

  const seekTo = (i: number) => {
    const trigger = ScrollTrigger.getById("olus-demo")
    if (!trigger) return
    pausedRef.current = false
    setPaused(false)
    const position = trigger.start + (.25 + (SCENE_STARTS[i] + .05) / TOTAL * .6) * (trigger.end - trigger.start)
    if (getLenis()) getLenis()!.scrollTo(position, { immediate: true })
    else window.scrollTo(0, position)
  }

  return (
    <section
      id="demo"
      ref={rootRef}
      aria-label="Simulator demo"
      className="dm-section"
      data-static={staticMode}
      data-demo-scene="0"
      style={{ position: "relative" }}
    >
      <noscript><style>{`.dm-section .dm-pin{display:none!important}.olus-demo-fallback{padding:64px 24px;max-width:68ch;margin:auto;font-size:18px;line-height:1.7}.olus-demo-fallback h2{font-size:36px}.olus-demo-fallback li{margin:20px 0}`}</style><div className="olus-demo-fallback"><h2>One disruption. Every decision, in view.</h2><p>Illustrative Nimbus Air recovery workflow.</p><ol><li>Command: select an airport and configure a weather closure.</li><li>Cascade: inspect the directly affected flights and the following rotations.</li><li>Solve: compare operating cost, passenger impact, next-day readiness and carbon alternatives.</li><li>Commit: review changed flights and crew checks before applying a plan.</li></ol><a href="/docs#optimizer">Read how recovery works</a></div></noscript>
      <div className="dm-pin">
        <div className="olus-demo-controls">
          <span>Illustrative recovery · Nimbus Air</span>
          {!staticMode && <button type="button" aria-pressed={paused} onClick={() => {
            pausedRef.current = !pausedRef.current
            setPaused(pausedRef.current)
          }}>{paused ? "Play demo" : "Pause demo"}</button>}
          {!staticMode && <button type="button" onClick={() => seekTo(0)}>Replay</button>}
          <a href="/simulator">Open the workspace ↗</a>
        </div>
        {/* the text appears first, then dissolves into the animation */}
        <div className="dm-headline">
          <h2 className="dm-headline-title">
            One disruption.{" "}
            <span>Every decision, in view.</span>
          </h2>
          <p className="dm-headline-sub">{staticMode ? "A storm closes ATL. Compare four recovery options, inspect crew legality, then review the selected plan. Open the workspace to run your own scenario." : "One full recovery loop — event to committed plan — played inside the real console."}</p>
        </div>

        <div className="dm-product-wrap">
          <LaptopStage staticMode={staticMode} onOpenChange={handleOpenChange}>
            <div
              ref={connectScreen}
              className="demo-screen dm-frame"
              style={{
                display: "flex",
                flexDirection: "column",
              }}
            >
            {/* top bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "0 14px",
                height: 42,
                borderBottom: "1px solid var(--dk-line)",
                background: "var(--dk-panel)",
                flexShrink: 0,
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <OlusMark size={16} style={{ color: "var(--dk-text)" }} />
                <span className="demo-chrome-label" style={{ color: "var(--dk-text)" }}>Olus OCC</span>
              </span>
              <span className="demo-chrome-label lp-hide-mobile">Nimbus Air · 202 flights</span>
              <span className="demo-chrome-label" style={{ marginLeft: "auto" }}>14:31Z</span>
              <span style={{ position: "relative", width: 86, height: 16 }}>
                {STATUS.map((s, i) => (
                  <span
                    key={s.label}
                    className={`st-${i} demo-chrome-label`}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      color: s.color,
                      borderBottom: `2px solid ${s.color}`,
                      paddingBottom: 2,
                      opacity: staticMode ? (i === 3 ? 1 : 0) : i === 0 ? 1 : 0,
                    }}
                  >
                    {s.label}
                  </span>
                ))}
              </span>
            </div>

            {/* body */}
            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
              {/* icon rail */}
              <div
                className="lp-hide-mobile"
                style={{
                  width: 46,
                  borderRight: "1px solid var(--dk-line)",
                  background: "var(--dk-panel)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  paddingTop: 12,
                  flexShrink: 0,
                }}
              >
                {RAIL_ICONS.map((Icon, i) => {
                  const active = RAIL_ACTIVE[staticMode ? 3 : 0] === i
                  return (
                    <span
                      key={i}
                      className="dm-rail-icon"
                      data-active={active}
                      style={{
                        display: "inline-flex",
                        padding: 7,
                        borderRadius: 8,
                      }}
                    >
                      <Icon style={{ width: 15, height: 15 }} strokeWidth={1.75} />
                    </span>
                  )
                })}
              </div>

              {/* map canvas */}
              <div className="dm-canvas" style={{ position: "relative", flex: 1, overflow: "hidden", minWidth: 0 }}>
                <DemoMap staticMode={staticMode} />

                {/* event selector */}
                <div
                  className="demo-card dm-events"
                  style={{
                    position: "absolute",
                    // Top-RIGHT, not top-left. The agent console is anchored
                    // bottom-left and grows upward as its response lines land,
                    // and from 4.7s to 8.5s the two were stacked on the same
                    // corner with the selector printing through the card. The
                    // right side is free for this whole window — the plan
                    // inspector does not arrive until 15.2s.
                    right: 14,
                    top: 14,
                    zIndex: 25,
                    width: 216,
                    padding: 12,
                    background: "rgba(255, 255, 255, 0.96)",
                    boxShadow: "0 8px 28px rgba(11, 36, 52, 0.12)",
                    opacity: 0,
                    visibility: staticMode ? "hidden" : undefined,
                  }}
                >
                  <span className="demo-chrome-label" style={{ display: "block", marginBottom: 10 }}>
                    Trigger event
                  </span>
                  <div style={{ display: "grid", gap: 5 }}>
                    {EVENT_ROWS.map((r, i) => (
                      <span
                        key={r.label}
                        className={r.hot ? "dm-evrow-hot" : undefined}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 9,
                          padding: "7px 9px",
                          borderRadius: 7,
                          border: "1px solid transparent",
                          fontSize: 12,
                          fontWeight: 500,
                          color: "var(--dk-text)",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--ae-font-mono)",
                            fontSize: 9.5,
                            letterSpacing: "0.06em",
                            color: "var(--dk-muted)",
                            width: 16,
                            flexShrink: 0,
                          }}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {r.label}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}>
                    <span className="demo-chrome-label">Severity</span>
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className={n <= 4 ? "dm-sev-fill" : undefined}
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 3,
                            background: n <= 4 ? "var(--dk-rose)" : "rgba(11, 36, 52, 0.12)",
                            opacity: n <= 4 ? 0.15 : 1,
                          }}
                        />
                      ))}
                    </span>
                  </div>
                </div>

                {/* departures-held chip */}
                <div
                  className="demo-card dm-held"
                  style={{
                    position: "absolute",
                    top: 12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 26,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 14px",
                    background: "rgba(255, 255, 255, 0.96)",
                    borderColor: "rgba(236, 72, 153, 0.45)",
                    boxShadow: "0 8px 28px rgba(11, 36, 52, 0.10)",
                    opacity: 0,
                    visibility: staticMode ? "hidden" : undefined,
                  }}
                >
                  <span className="demo-chrome-label" style={{ color: "var(--dk-rose)" }}>
                    Departures held
                  </span>
                  <span
                    className="dm-held-n"
                    style={{ fontFamily: "var(--ae-font-mono)", fontSize: 15, fontWeight: 600, color: "var(--dk-text)" }}
                  >
                    0
                  </span>
                </div>

                {/* toast */}
                <div
                  className="demo-card dm-toast"
                  style={{
                    position: "absolute",
                    top: 12,
                    // 25%, not 50%: the toast lands at 22.5s, by which time the
                    // plan inspector owns the right half of this canvas and a
                    // centred toast was cut in half by it.
                    left: "25%",
                    transform: "translateX(-50%)",
                    zIndex: 27,
                    padding: "9px 16px",
                    background: "rgba(255, 255, 255, 0.96)",
                    borderColor: "rgba(91, 63, 168, 0.5)",
                    boxShadow: "0 8px 28px rgba(11, 36, 52, 0.10)",
                    fontSize: 12.5,
                    fontWeight: 550,
                    whiteSpace: "nowrap",
                    color: "var(--dk-text)",
                    opacity: staticMode ? 1 : 0,
                  }}
                >
                  Recovery plan applied
                  <span style={{ color: "var(--dk-muted)", fontWeight: 450 }}> — 118 actions committed</span>
                </div>

                <AgentCommandDemo staticMode={staticMode} />

                {/* plan inspector */}
                <div
                  className="dm-plans"
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 28,
                    width: "min(238px, 52%)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "7px 10px",
                    background: "rgba(255, 255, 255, 0.97)",
                    borderLeft: "1px solid var(--dk-line)",
                    transform: staticMode ? undefined : "translateX(108%)",
                    overflow: "hidden",
                  }}
                >
                  <span className="demo-chrome-label">Recovery plans · A–D</span>
                  {/* Sized to fit: four cards plus the committed block came to
                      429px inside a 314px panel, so the payoff metrics hung off
                      the bottom edge. Trimmed padding and leading, not content.
                      The list is also the flexible child while the committed
                      block is not, so on a shorter viewport the last plan card
                      clips before the payoff metrics ever do. */}
                  <div style={{ display: "grid", gap: 4, minHeight: 0, overflow: "hidden" }}>
                    {PLANS.map((p) => (
                      <div
                        key={p.id}
                        className={`dm-plan${p.id === "B" ? " dm-plan-b" : ""}`}
                        style={{
                          border: `1px solid ${staticMode && p.id === "B" ? "#5B3FA8" : "var(--dk-line)"}`,
                          background: staticMode && p.id === "B" ? "rgba(91, 63, 168, 0.08)" : "var(--dk-panel-2)",
                          borderRadius: 7,
                          padding: "4px 8px",
                          opacity: staticMode ? (p.id === "B" ? 1 : 0.55) : 0,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                          <span style={{ fontFamily: "var(--ae-font-display)", fontWeight: 700, fontSize: 13, color: "var(--dk-text)" }}>
                            {p.id}
                          </span>
                          <span style={{ fontSize: 10.5, color: "var(--dk-muted)", fontWeight: 500 }}>{p.objective}</span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 9,
                            marginTop: 1,
                            fontFamily: "var(--ae-font-mono)",
                            fontSize: 10,
                            color: "var(--dk-text)",
                          }}
                        >
                          <span>{p.cost}</span>
                          <span style={{ color: "var(--dk-muted)" }}>{p.cxl}</span>
                          <span style={{ color: "var(--dk-teal)" }}>{p.flags}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* committed metrics */}
                  <div
                    className="dm-metrics"
                    style={{
                      marginTop: "auto",
                      flexShrink: 0,
                      borderTop: "1px solid var(--dk-line)",
                      paddingTop: 6,
                      display: "grid",
                      gap: 3,
                      opacity: staticMode ? 1 : 0,
                    }}
                  >
                    <span className="demo-chrome-label" style={{ color: "var(--dk-teal)" }}>
                      Plan B — committed
                    </span>
                    {/* "Crew legality · 0 flags" is gone from this block: every
                        plan card above already shows its own flag count, so the
                        row restated a number the reader had just been given. */}
                    {[
                      ["Cancellations", <span key="v" className="dm-m-cxl">{staticMode ? "3" : "16"}</span>, "was 16"],
                      ["Pax reaccommodated", <span key="v" className="dm-m-pax">{staticMode ? "4,860" : "0"}</span>, ""],
                      ["Cost vs no action", <span key="v" className="dm-m-cost">{staticMode ? "−$1.7M" : "−$0.0M"}</span>, ""],
                    ].map(([label, value, note], i) => (
                      <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 10.5 }}>
                        <span style={{ color: "var(--dk-muted)", fontWeight: 500 }}>{label}</span>
                        <span
                          style={{
                            marginLeft: "auto",
                            fontFamily: "var(--ae-font-mono)",
                            fontSize: 11,
                            color: "var(--dk-text)",
                          }}
                        >
                          {value}
                        </span>
                        {note ? (
                          <span style={{ fontFamily: "var(--ae-font-mono)", fontSize: 9.5, color: "var(--dk-muted)" }}>{note}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <CursorChoreography staticMode={staticMode} />
              </div>
            </div>

            {/* bottom timeline — doubles as the video's progress bar */}
            <div
              style={{
                position: "relative",
                height: 30,
                borderTop: "1px solid var(--dk-line)",
                background: "var(--dk-panel)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 14px",
                flexShrink: 0,
              }}
            >
              {["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"].map((t) => (
                <span key={t} className="demo-chrome-label" style={{ fontSize: 9 }}>
                  {t}
                </span>
              ))}
              <span
                className="dm-playhead"
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 0,
                  height: 2,
                  width: "100%",
                  background: "var(--dk-teal)",
                  transformOrigin: "0 50%",
                  transform: staticMode ? undefined : "scaleX(0)",
                }}
              />
            </div>
            </div>
          </LaptopStage>
        </div>

        {/* caption chips — auto-advance with playback; click to seek */}
        <div className="dm-captions-row" style={{ opacity: staticMode ? 1 : 0 }}>
          {DEMO_STEPS.map((s, i) => {
            const active = staticMode || i === 0
            return (
              <button
                key={s.n}
                disabled={staticMode}
                className="dm-cap"
                data-active={active}
                onClick={() => !staticMode && seekTo(i)}
                style={{ cursor: staticMode ? "default" : "pointer" }}
              >
                <span className="dm-cap-n">{s.n}</span>
                <span className="dm-cap-title">{s.title}</span>
              </button>
            )
          })}
        </div>
      </div>{/* .dm-pin */}
    </section>
  )
}
