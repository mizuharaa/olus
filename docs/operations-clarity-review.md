# Map legend follow-up (October 26)

Production frontend is now `f8a0d98`, deployment `dpl_Ai4woPaprXpHdbFyvhDo6oK8FTXf` on olus.sh. Fixed summary padding overridden by generic workspace styling (observed10px0), tiny uppercase tracking, and popup centering that put its left edge at-122.8px. Removed obsolete positioning comments. The panel is left-aligned, text is13px, trigger is14px with12px horizontal padding and44px height. Native details/summary and a visible chevron preserve keyboard operation. Short-screen panel height uses the actual map container, reserving88px for offsets; narrow-phone footer width reserves space for the trigger.

Observed release checks: desktop1440x812 popup left12/right372, phone390x844 left12/right370, narrow320x700 left12/right300. No document horizontal overflow. At844x390 landscape, map top162, popup top174/bottom284, clientHeight108 vs scrollHeight323: content scrolls within the map. Enter closed; Space opened; Tab reached the first layer control. Public domain confirmed14px Inter,10px12px padding and44px target after promotion. A final cropped production screenshot capture timed out; geometry verification succeeded. Existing inspector screenshots below predate this legend correction.

Executed: type-check exit0, lint exit0 with six existing warnings, check-flight-controls and check-operations-clarity exit0, Impeccable layout scan empty. Final Vercel production build Ready and promotion exit0. No new dependencies or changes to map data/seed/apply handlers. Zoom performance remains unverified as documented below.

---

# October 26 production revision

Deployed frontend commit `f0d0dcc` to `https://olus.sh/app/overview` through Vercel deployment `dpl_5cPgdQPLNjpo4DSAKoaHTpJd1HoJ`. Promotion exited 0. Public-domain browser verification found the new compact toolbar and NB202 inspector with scheduled 20:55Z / 23:30Z and revised 21:18Z / 23:53Z. Backend deployment and production data changes were not part of this release.

## Design and fixes

Fresh Mobbin references are recorded in `design.md`: Felt and PamPam for map/overlay structure; KAYAK for flat flight-detail hierarchy. User feedback superseded the permanent sidebar. The map fills the workspace, recovery is an optional overlay, and bottom bars are removed. At the same 1440x812 viewport, map area changed from 1090x454.90625 to 1440x661 (91.96% larger); toolbar height changed from 105.09375 to 57px. These are layout measurements, not performance results.

The flight inspector's flex children had been compressed into strips. Its body now uses ordinary block flow inside a scroll region. Removed decorative aircraft plates and nested fact cards; merged expand and close into one header; preserved schedule, actual delay calculations, cancellation dashes and inferred live-route disclosures. Optional 3D preview mounts only when open. The inert Centre action was removed; selecting a flight focuses it, and Fit network remains. Keyboard-resize hit area is not clipped.

## Executed checks

- `npm run type-check`: exit 0 after inspector changes.
- `npm run lint`: exit 0, six existing warnings (font, image and effect dependencies).
- `node scripts/check-flight-inspector.cjs`: exit 0; scheduled/revised UTC times, cancelled timing dashes, recorded passenger value, and zero mounted preview components while closed. Direct TSX rendering emits two styled-jsx attribute warnings because it does not run the Next compiler; production builds compiled those styles successfully.
- `node scripts/check-zoom-benchmark.cjs`: a new no-canvas case first failed, then passed after correcting trafficVisible. Existing timing, timeout, visibility and cleanup checks passed.
- `node scripts/check-operations-clarity.cjs`, `check-flight-controls.cjs`, `check-release-boundaries.cjs`: exit 0.
- `npm run build`: exit 0 with 33 static pages on the inspector revision before the final small heading/disclosure refinements. Vercel production builds on the final source also completed Ready, exit 0.
- Impeccable mechanical layout scan: empty finding list. This is not a substitute for browser checks.
- Read-only independent reviewer found the clipped resize hit area and eagerly mounted closed preview; both corrected before promotion.

## Browser smoke observed

Chrome, actual hosted builds; no mocked browser data. Desktop 1440x812 and phone override390x844; override reset afterward. Public-domain final check at1920x1083.

- Recovery costs aligned to consistent numeric columns. Plan B preview changed route colors and retained the not-applied label. Preview did not call apply.
- On phone, no document horizontal overflow (scrollWidth390), toolbar105px, visible legend and preview label, closable recovery and financial comparison.
- NB202 route summary109px and timing table123px; no squeezed strips. Phone route/table heights also109/123px. Inspector body naturally scrolls.
- Tab from inspector close reached Track and scrolled the body200.5px; Track stayed inside the body viewport. Keyboard resize changed420 to436px and back. Expand/restore worked.
- Financial comparison opened with all four plans and a reachable close control; the wide comparison table uses horizontal scrolling on phone. No plan committed.
- Live search selected UAL2624. Inferred endpoints and data caveat remained visible. Aircraft preview canvas count was0 closed,1 open, then0 after closing.
- Public domain served the new inspector after promotion; screenshot `design-previews/inspector-production.jpg`.

## Performance boundary

Zoom is NOT certified smooth. `design-previews/zoom-observed.json` preserves two actual samples with7194 live contacts. Capture-handler-to-zoom-start delays were932.9ms and112.4ms; zoom-event durations295.3ms and283.5ms; worst observed rAF gaps259.5ms and1023.6ms. The next expected sample never arrived. Chrome foreground/occlusion conditions were not confirmed, so the cause cannot be assigned to application code or browser throttling. The probe ignores starts delayed more than1s; therefore this run cannot provide reliable tail-latency statistics. Do not claim FPS, speedup or resolved zoom lag from it. A controlled foreground run remains outstanding.

Earlier review follows for history; its sidebar composition was superseded.

---

# Operations clarity review

Local implementation, 2026-10-25. Preview: http://localhost:5411/app/overview

## Design

Uses approved draft 1's sidebar and map with draft 2's financial organization. The additional Mobbin pass inspected [Quicken](https://mobbin.com/screens/23ff7f72-3314-4836-86eb-9ee60a99821f), [YNAB](https://mobbin.com/screens/62817fae-ab1b-43cf-a15d-3d372afd32ca), and [Midday](https://mobbin.com/screens/6ead266a-00ac-4779-ab2f-772183755698). Applied persistent navigation, aligned amounts, flat rows and compact controls. Draft images use illustrative data; the implemented screen uses the existing local simulation API.

Recovery choices and actual ledger totals remain visible beside the map. Preview and commit remain separate. Map strokes distinguish delays, aircraft reassignments and cancellations; aircraft reassignment does not imply a geographic reroute. Removed unsupported geographic impact circles and map filters. Live traffic starts hidden and can be enabled. Flight refreshes no longer repeatedly refocus the map; interrupted zoom restores the traffic canvas.

## Executed checks

From `apps/web`, all completed successfully:

```sh
npm run type-check
node scripts/check-operations-clarity.cjs
node scripts/check-flight-controls.cjs
git diff --check
```

The new check extracts production callbacks and verifies plan-only route visibility, preview cancellation precedence, stable focus identity, interrupted zoom recovery and listener cleanup. The existing flight check reported passing duplicate/out-of-order fixes, stale freeze, reduced motion, and 22 event forms with consumed parameters.

Browser checks used the real local API and Chrome:

- A severe four-hour JFK weather closure generated four priced plans. Preview A showed zero cancelled markers; preview C showed 16, matching their action totals.
- Commit required confirmation; confirmed plan C applied, and unapply returned the commit control.
- At 390 by 844, financial review remained between y=116 and y=816 after scrolling to its entry button. The ledger and page had no horizontal overflow.
- Opening disruptions from the empty-state action closed the flight inspector.
- Live traffic recovered after zoom, with a visible canvas and 6,009 contacts observed in that session. This is a functional observation, not a performance result.

An independent finishing review found interrupted-zoom cleanup, panel arbitration, mobile fixed positioning and swap-only cancellation precedence issues. These were repaired and relevant checks rerun.

## Limits

No production deployment or full production build was executed. Zoom frame rate was not benchmarked. External live-flight requests intermittently returned 503 during testing; successful subsequent requests do not establish provider reliability. Geographic rerouting requires actual route geometry from the backend and is not fabricated by this UI.
