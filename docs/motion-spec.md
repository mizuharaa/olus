# Olus opening — motion implementation

Stage B, 2026-09-14. Implemented values below are Olus targets, not recovered reference constants. The original reference evidence remains in `motion-forensics.md`.

| Motion | Trigger | Start/end | Scrub/pin | Duration/ease | Properties | Reduced motion |
| --- | --- | --- | --- | --- | --- | --- |
| Intro SVG draw | Every landing-page load | 0–0.85 s | None | 0.85 s, power2.inOut | stroke dash offset | Final mark immediately |
| Stroke to fill | Intro | 0.85–1.2 s | None | 0.35 s | fill/stroke opacity | Final fill |
| Same-node logo FLIP | Intro | 1.2–2.0 s | None | 0.8 s, expo.inOut | FLIP position/scale | Navbar placement |
| Wordmark reveal | Intro | 1.4–2.0 s | None | 0.6 s, power3.out | clip-path | Visible |
| Cover reveals downward | Intro | 1.2–2.0 s | None | 0.8 s, expo.inOut | inset clip-path | No cover |
| Nav chrome | Intro | 1.85–2.2 s | None | 0.25 s, stagger 0.05 | y/opacity | Visible |
| Headline line masks | Intro | 1.85–2.28 s | None | 0.35 s, stagger 0.08, power3.out | yPercent | Visible |
| Hero settle | Hero top | top top → +120vh | scrub 0.8, pin | linear progress | scale 1→0.94, radius 28→56, brightness 1→0.8 | Normal flow, static image |
| Hero caption | Opening top | top top → top -35% | scrub 0.8 | linear progress | opacity 0.65→1 | Fully visible |
| Nav background | Scroll position | 80px → max | toggleClass | CSS 0.3 s | background/backdrop | Static class follows position |
| Menu panel | Mouse hover or click | Open/close | None | 0.5 s expo.out; reverse speed 0.85 | clip-path/opacity | Immediate native dialog |
| Menu media slivers | Menu open | 0.08 s onward | None | 0.7 s expo.out, stagger 0.06 | scaleY/clip-path | Full media cards |
| Menu gradient change | Pointer/focus on link | Active link | None | CSS 0.4 s | Layer opacity | Immediate |
| Button wipe | Hover | Enter/leave | None | 260 ms cubic-bezier(.22,1,.36,1) | clip-path | Immediate |
| MacBook lid/push | Demo top | top top → +320vh desktop | scrub 1.1, pin | Existing hinge easing | DOM transforms | Open static MacBook + narrative summary |
| Recovery playback | Demo progress 0.36–0.88 | 25-second loop | Independent timeline | Existing chapter timings | Existing console choreography | No autoplay |

Lenis uses lerp 0.085, wheelMultiplier 1, syncTouch false, GSAP ticker integration and the existing shared render loop. Opening/menu constructions use matchMedia with cleanup; the demo retains its scoped construction. A 2.4-second intro failsafe releases scrolling. Browser preference migration precedes theme initialization. Pre-hydration styling masks the hero on every load. The intro replays on reload, including when the browser restores a scrolled position; reduced motion still skips it. This supersedes the original once-per-session requirement.

## Review evidence

`verification/opening/results.json` contains the browser assertions and scoped axe output. `opening-desktop.webm` and `opening-mobile.webm` show the opening and menu; desktop also shows the MacBook playback controls. PNGs show desktop, 320px/mobile, navigation, MacBook and reduced motion.

Axe covers the new opening and native menu only. It is not a WCAG certification or an audit of the retained dashboard. Current full landing first-load JavaScript is 274 KB according to Next build, above the 180 KB brief target. LCP/CLS/INP under throttled hardware and M1 globe FPS are not measured in this stage. The retained globe and other existing sections still need the requested rebuild and deferred loading.


## Work order v2 repair checkpoint (2026-09-15)

| Motion | Trigger | Start/end | Scrub/pin | Duration/ease | Properties | Reduced motion |
|---|---|---|---|---|---|---|
| Landing intro | First visit in session; real font/image readiness feeds aura | Draw 0-.85s, fill .85-1.2s, Flip 1.2-2s; hard cap 2.4s | None | Existing power2 / expo sequence | SVG dash/fill, aura scale/opacity, same-node Flip, cover clip | 200ms fade; no aura |
| Liquid indicator | Only mounted when motion allowed | Until intro completes | None | Counter-flow 7.3/11.1s; noise 9.7s | SVG displacement and transforms; intensity from completed prerequisites | Absent |
| App loader | Schedule boot | CSS visual deadline .9s, 700ms then 200ms exit; early exit when schedule ready | None | 200ms opacity | Shared O mark/aura, plain Skip control | Static mark, .2s fade |
| Demo recovery | Section owns device + existing four-stage timeline | top top to +=3.5 viewport heights; narrative .25-.85 progress | scrub 1.1, single pin | Narrative seek from scroll; no autoplay loop | Device, headline exit, console state; controls bottom anchored | Existing static readable console |
| Late layout refresh | Fonts and newly mounted laptop pin | Coalesced animation frame | Sort/refresh triggers, preserve scroll | Immediate geometry update | Downstream trigger bounds | No pins in reduced mode |

Reproduction and regression evidence: `prod-animation-fix.md`; `scripts/check-scroll-motion.mjs`; `scripts/check-intro-reload.mjs`. These rows supersede the old every-reload intro and time-loop demo descriptions above.

### Reload clarification
Latest user instruction overrides session gating: the landing logo intro runs on every full page reload, including when the legacy session flag exists. Reduced motion keeps its 200ms fade.

## Audit resolution: docs and landing (2026-09-16)

These rows supersede earlier conflicting flyover/reveal descriptions. Intro continues to replay on every full reload; this repair does not alter opening timing.

| Motion | Trigger | Start / end | Scrub / pin | Properties / ease | Reduced motion and no JS |
|---|---|---|---|---|---|
| Long statement wipe | Each story paragraph longer than 90 characters, excluding footer | top 90% / bottom 35% | .6 / none | background-position 100% to 0%; 12% soft gradient edge; linear | Ordinary fully colored text; CSS does not hide copy before JS |
| Aircraft flyover | decisions section | top bottom / bottom top | .6 / none | MotionPath coordinates measured from section; off-left to off-right; midpoint at .5; tangent rotation; linear | Static faint aircraft at approximately one-third path |
| Aircraft shadow | Same section progress | same range, progress minus .04 clamped | Same owner | Same path with 24px/32px offset; opacity .22 and 18px blur | Hidden |
| Aircraft text occlusion | Same aircraft progress | same range | Same owner | MotionPath, soft radial mask, backdrop blur 3px | Hidden |
| Validation title wipe | decisions section | top bottom / center 35% | .6 / none | background-position; neutral ink to neutral bone | Solid ink |
| Docs navigation | Scroll position and anchor selection | Heading crosses 180px top rail | no scrub or pin | aria-current updates; native anchor behavior | Same readable document; no hidden entrance states |

The demo now provides an ordered four-stage narrative in noscript and hides the inaccessible animated device only in that mode. Gallery cards switch to a readable normal-flow grid without JS. A static source-model export replaces the old flyover sprite; render script and Apache-2.0 provenance live with the asset.

Verification: `node scripts/check-product-facts.mjs`; `node scripts/check-landing-docs-repair.mjs` from apps/web; TypeScript no-emit check. Screenshots in docs/verification: docs-repaired-desktop.png, docs-repaired-mobile.png, flyover-repaired.png. This is local behavior evidence, not a production performance claim.

### Aircraft and sky restoration
- Landing runway, fly-over (including shadow), and sky interlude reuse the original `aircraft-top.png` airliner. The generic turboprop replacement is no longer used here.
- Sky heading: section trigger, `top top` to `top -45%`, scrub 0.6; opacity 1 to 0 and y 0 to -40px.
- Sky statements: each line owns its trigger, `top 95%` to `top 65%`, scrub 0.6; opacity 0 to 1 and y 24px to 0. Reverse scrolling reverses the fade.
- Reduced motion / JavaScript disabled: fully visible text, no fade. Check: `node scripts/check-sky-restoration.mjs` from apps/web with localhost:3001 running.
