# Production animation investigation

2026-09-15, baseline `f3a0fd8`. **Root cause reproduced on restored navigation; fixed locally in the shared refresh path.**

Both `https://olus.sh` and local `next build` → `next start --port 3001` pass the same browser check. No page errors or failed static-chunk responses occurred. Earlier dev and deployed sweeps also returned matching positions and matrices. Production executes the scroll animations; plugin registration and Lenis wiring are present.

| Target | First sampled matrix | Later sampled matrix |
|---|---|---|
| Gallery progress | `matrix(0.125,0,0,1,0,0)` | `matrix(0.75,0,0,1,0,0)` |
| Technology image | y translation 23.9421 | y translation -15.9614 |
| Flyover plane | x -3612.82, y 701.547 | x -1412.37, y 72.4839 |

Historical stale releases came from the old checkout's CLI deployments, as reported by the other pane. That is a documented previous release issue, **not a demonstrated cause of the present report**. Only Git integration on main should release the web app.

## Root cause and fix

The fresh-navigation test initially passed. Reloading from mid-page reproduced the failure: the laptop pin mounts after its screen is ready, after downstream triggers were created. `queueLandingRefresh` discarded refreshes beyond 200px, and the laptop did not request one when mounting its pin. Gallery start was 3,251px while its actual document top was 6,131px: exactly 2,880px of late laptop pin spacing was absent. Downstream animations therefore ran too early, matching the apparently static/overlapping sections.

Fixed `lib/scroll.ts` once: sort and refresh after fonts, then restore the saved scroll position through Lenis. Request that shared refresh immediately after the laptop pin mounts. The guard now reloads from mid-page and checks gallery progress against its physical position. Before fix: **0.925, fail**. After fix: **0.125, pass**. The updated demo also uses one 3.5-viewport pin for its four scroll-driven stages, with controls below the laptop.

The fix is not yet deployed. The earlier deployed recording documents fresh-navigation behavior only; it does not certify the restored-navigation fix on production.

## Repeatable guard

From `apps/web`:

```powershell
node scripts/check-scroll-motion.mjs https://olus.sh
node scripts/check-scroll-motion.mjs http://localhost:3001
```

Optional `MOTION_EVIDENCE_DIR` writes JSON and a Playwright video. The guard uses computed transforms, not development-only globals; a static gallery, parallax image or flyover fails. It also fails on runtime and static-chunk HTTP errors.

Evidence: `docs/verification/deployed-motion` and `docs/verification/local-production-motion`. Earlier bounds sweep: `docs/reference/animation-runtime-before.json`.

## Limits and next repair

This proves sampled desktop scroll animations run in the tested Edge environment. It does not prove every animation, mobile browser, restored-scroll state or performance budget. Baseline demo pin range was 2351–5231; gallery was 6131–9731, so simultaneous pin ownership was not reproduced at this viewport. The supplied overlap screenshot remains valid defect evidence; test refresh/navigation/resizing before attributing it to competing pins. Loader design and other confirmed structural defects continue separately.
