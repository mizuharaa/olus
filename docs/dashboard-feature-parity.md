# Dashboard feature restoration

The previous workspace omitted existing simulator capabilities. This pass reuses their data and implementation, keeping the map full-screen and controls collapsible.

| Existing capability | Restored entry point | Source / verification |
| --- | --- | --- |
| Individual live aircraft | Live map, blue glyphs at every zoom; no clustering or world copies | `traffic-map.tsx`; actual canvas-click regression |
| Stable selected contact and trail | Selected aircraft inspector and highlighted path survive missing polls | `flight-track.ts`; buffered observations check and browser pixel assertion |
| Arrival guidance | Nearest network field, inferred arrival, distance and ETA; airport endpoints are clickable | Shared `deriveLive`; unknown heading cannot infer arrival |
| Airport network | Labeled, clickable nodes; airport selector | Existing `NIMBUS_AIRPORTS`; airport canvas-click check |
| Airport details | FAA programs, NWS alerts, simulation events, all scheduled movements | Existing API endpoints; explicit loading/error states |
| Scheduled-flight detail | Origin/destination, scheduled/revised times, tail, passengers, delay, applied action and downline flights | Schedule and simulation store; row-click browser check |
| Watchlist and external tracking | Selected aircraft actions; Analysis tools > Watchlist | Existing `useWatchlist`; browser toggle check |
| 3D aircraft | Selected aircraft inspector, pauseable | Existing airliner GLB and Meshopt decoder; generic airframe label |
| 22 disruption forms | Events | Shared original form schema and API catalog; real trigger/apply/revert/cancel regression |
| Live event import | Events > live FAA/weather feed | Reused `LiveFeed`; existing event parameter validation |
| Schedule import/reset | Events > Schedule source & reset | Existing reseed/reset endpoints with confirmation; inferred routes labeled |
| Financial recovery | Recovery | Server costs, passenger delay, swaps, legality violations, carbon and uncertainty where returned |
| Cascade timeline | Affected simulated flights > Cascade timeline | Existing `CascadeTimeline` component |
| Full schedule list | Affected simulated flights > All scheduled flights | Complete schedule, not only disrupted legs |
| Globe | Layers & airports > Network globe | Existing `GlobeView`; explicit scheduled replay hour |
| Crew, passenger, carbon, compare, stress/playtest, settings | Header > Analysis tools | Existing screens retained and linked |
| Grounded assistant | Analysis tools > Ask Olus | Reused `AgentBubble` and backend `/agent/ask` |

## Reference evidence

Mobbin MCP was used to inspect KAYAK's flight list and flight-detail screens:
- https://mobbin.com/screens/a60c42b8-9aea-4d69-82eb-0b381b3fc9c4
- https://mobbin.com/screens/6bcc82eb-d4a3-4917-917d-ca105eb006fb

Applied layout grammar: map remains primary, bounded inspector, route endpoint grouping, labeled schedule/status rows and hairline separation. Static captures do not establish exact animation timing. Existing Aroval reference supplies the 3D aircraft panel direction.

## Data boundaries

The live ADS-B feed does not provide filed origins/destinations or assigned crew. Inferred arrival uses the original nearest-airport-within-track-cone helper; it is not a confirmed destination. Scheduled simulation flights do have explicit routes. No fabricated route metadata was added.

The old notification bell incorrectly announced touchdown when a contact disappeared. That alert is not mounted in the new workspace. FAA/NWS alerts remain in the airport and event panels. Illustrative cabin occupancy is not presented as live passenger data. Legacy analysis screens are preserved; their full visual redesign is not claimed here.

## Checks

- `node scripts/check-flight-controls.cjs`: buffered movement, heading guard and shared event forms.
- `node scripts/check-fullscreen-map.mjs`: full-screen map, aircraft/airport clicks, retained route, watchlist, scheduled detail, 22 forms and responsive overflow.
- `node scripts/check-workspace.mjs`: actual local API event/solve/apply/revert/cancel, preferences, responsive overflow and scoped axe AA audit.
- Screenshots and axe output: `docs/verification/dashboard/`.

These changes are local on `ui/olus-dashboard-v2`; this document does not assert a production deployment.

### Final local verification

Optimized `npm run build` passed. On `next start` at port 3001, both full-screen-map and real recovery-flow checks passed; `operations-axe.json` contains zero violations for the scoped workspace audit. `check-restored-tools.mjs` passed globe replay, map return, analysis links and assistant opening. Existing landing lint warnings remain; this is not a whole-site accessibility certification. No production deployment was performed.

## Dashboard layout replacement after restart

The map remains full-screen. Search and network controls now share a left rail; the network summary is collapsible and groups schedule, affected-flight and recovery counts. Events replace the summary body, recovery and aircraft details occupy the right inspector, and the flight tray spans the bottom. The slim header and bottom connection bar free vertical map space. The prior scattered floating controls are no longer the layout authority.

Verified locally: TypeScript, summary collapse/expand and 320/768/1280 overflow checks, plus the real event/solve/apply/revert/cancel workflow and scoped axe audit. Screenshot: `verification/dashboard/revamp-layout.png`. Services restarted at localhost:3001 and 127.0.0.1:8000. No deployment performed.


## Original-console restoration (current implementation)

This supersedes the layout descriptions above. `/app/overview` now directly mounts the original `FlightMap`, `EventPanel`, `PlanCompareBoard`, `FlightDetailPanel` and `CascadeTimeline`. Their original event catalog, FAA/weather import, airport details, simulation route layers, event rings, cascade-depth encodings, cancellation/swap patterns, globe, recovery comparison and changed-leg ledger are retained in these components. Existing analysis routes remain linked from the header. The live inspector keeps the interactive generic 3D airframe.

The full-screen map uses neutral OpenStreetMap tiles instead of the watermarked CARTO endpoint. Scoped workspace styles provide dark panels, larger controls, 44px event targets, 52px comparison rows and short hover/reveal transitions. Recovery is a closable lower comparison board. A/B/C/D previews drive the original map's plan layers without applying a plan; commit remains a separate confirmed API action. Live traffic stays individually selectable during disruptions and can be explicitly hidden.

`node scripts/check-original-operations.mjs` (from `apps/web`) checks live-contact selection and the 3D inspector, original event controls, all four map previews without backend mutation, real local trigger/commit/unapply, browser errors and responsive overflow. Existing older layout tests describe the replaced workspace and are not evidence for this revision. The original code contains more legacy analysis routes than this focused check traverses; a full regression of every analysis tool is not claimed. Live ADS-B still cannot supply confirmed destinations when the feed lacks them. Simulated flight routes and plan effects use actual scenario data; their aircraft movement is illustrative.

Current restoration verification: clean optimized build passed; the restored-operations browser check passed against next start on port 3001, including live-contact selection, 3D inspector, plan-change confirmation reset, non-mutating previews, real commit/unapply and responsive widths. No production deployment in this pass.

Traffic rendering regression: replaced thousands of live Leaflet DOM markers with one canvas layer, retaining every visible contact and per-aircraft hit testing. Selected aircraft retains the detailed marker and 3D inspector. Measured browser check: 6,752 contacts / 785 DOM nodes / one simulation WebSocket, versus 6,724 markers / 34,413 DOM nodes before. Aircraft preview renders at up to 30fps, skips unchanged paused frames and hidden tabs, and releases its WebGL context on unmount. Run apps/web/scripts/check-traffic-rendering.mjs for this regression; original-operations check covers recovery separately.

Local startup/reset correction: localhost startup now resets the simulator before mounting data feeds and WebSocket, so old API events are not rehydrated on page reload. Client navigation retains the current run. Production hostnames do not auto-reset. Operations exposes Reset simulation; failures remain visible as errors. Legend panels now use theme surfaces, and live traffic is no longer mislabeled hidden during events. check-workspace-reset.mjs passed real API boot/reset/reload and measured 18.03:1 contrast for the live-layer toggle.
