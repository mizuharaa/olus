# Olus dashboard reference teardown

Research checkpoint, 2026-09-15. **Reference pack located and inspected:** `reference/olus-ui`, indexed by `README.md`, governed by root `OLUS_UX_WORKORDER.md`. All 27 images were inspected, including full-size PRIMARY Outcrowd and MAP Aroval. Exact dashboard CSS and hover timing remain unavailable from these static captures; no substitute search result has been elevated to primary authority.

## Tools and evidence

- Enumerated the available skills and MCP tools. Loaded **Impeccable** and its new-work guidance; Ponytail governs implementation restraint.
- Mobbin MCP is available and was used for all seven named dashboard products. No dedicated chart/dataviz/artifact-design skill was found in the available skill search. Before chart implementation, use Impeccable's applicable craft guidance and the existing Recharts dependency; do not claim a nonexistent skill was loaded.
- Downloaded and visually inspected **all 26 screens** in the four accepted captured flows. This means all screens in these selected flows, not all flows in Mobbin's catalog.
- Screen IDs, ordered positions and original image URLs: [dashboard-flows.json](reference/dashboard-flows.json).
- Contact sheets: [Shopify](reference/dashboard/Shopify-contact.jpg), [Copilot Money](reference/dashboard/Copilot-Money-contact.jpg), [HoneyBook](reference/dashboard/HoneyBook-contact.jpg), [Higgsfield](reference/dashboard/Higgsfield-contact.jpg). Original-resolution frames are in the corresponding subdirectories.
- Public-site computed styles: [dashboard-live-values.json](reference/dashboard-live-values.json). Authenticated dashboard CSS was not accessible. Screenshot observations below must not be read as recovered CSS values.

## Authority and search results

| Requested reference | Result | Authority / use |
|---|---|---|
| PRIMARY Outcrowd / Anna Smith | Search returned HoneyBook Home, not Outcrowd | Rejected mismatch. Exact shell reference unresolved. Agency homepage is not its dashboard design. |
| MAP Aroval | Search returned Mindtrip flight search | Rejected mismatch. Need actual map reference; cannot infer its physics or CSS. |
| LAYOUT-ONLY SkyMind | Search returned Neon Dashboard | Rejected mismatch. Never substitute its styling. |
| Shopify Analytics | [Filtering analytics by date, 8 screens](https://mobbin.com/flows/da561a38-7fdc-45f4-bd2e-5019d75e2601) | Accepted analytics patterns. |
| Copilot Money | [Categories, 3 screens](https://mobbin.com/flows/ee84c39f-99cd-430b-b316-5cf8b4d41077) | Accepted hierarchy, value/limit rows and empty states. |
| HoneyBook | [Home, 6 screens](https://mobbin.com/flows/1bc80e45-14ba-408d-a55d-4fe3d984142c) | Accepted overview/onboarding composition. |
| Higgsfield | [Manage account, 9 screens](https://mobbin.com/flows/d2115889-c17b-4fee-8b97-cf983db999cf) | Accepted dark surfaces; screen 7 includes spend summary, segmented bar and wrapped legend. |

## Measurement legend

**NR = not recovered.** Static captures reveal hierarchy and composition, not font stacks, exact CSS pixels, easing, hover physics or chart stroke widths. No pixel estimates are presented as measurements. Colors below are qualitative observations; Olus implementation uses its locked tokens, not sampled/compressed screenshot colors. The requested 24px Outcrowd radius and 160ms hover are **work-order targets**, not independently recovered source values.

## Screen-by-screen storyboard

Screen numbers map exactly to `position` in the manifest and the downloaded filenames.

| Screen | Grid | Type scale | Spacing rhythm | Radii | Shadows | Color values | Component inventory | Interaction notes |
|---|---|---|---|---|---|---|---|---|
| Shopify 01: empty analytics | Persistent rail; 4 KPI row; wide chart + narrow breakdown; lower 3 columns | Value/title/body hierarchy; px NR | Consistent card gutters; px NR | Rounded, NR | Subtle, NR | White/grey/cyan; hex NR | Date/comparison/currency controls, sparklines, line plot, breakdown | Empty ranges preserve final chart layout. |
| Shopify 02: date chooser | Anchored overlay over same grid | Compact calendar labels; px NR | Preset rail + two months; px NR | NR | NR | Same; NR | Two date inputs, presets, calendars, Cancel/Apply | Range selection stays contextual to analytics. |
| Shopify 03: relative range | Same anchored overlay | NR | Form above two months; NR | NR | NR | Same; NR | Last 30 days input, unit select, include-today checkbox | Apply is explicit; underlying report unchanged until committed. |
| Shopify 04: populated report | Same 4 / wide+narrow / 3 composition | Large value, small definition; NR | Same grid; NR | NR | NR | Cyan actual series; NR | KPI deltas, time series, right-aligned breakdown, channel donut, product bars | Dates/comparison remain visible above report. |
| Shopify 05: chart inspection | Same | Tooltip date/value distinction; NR | NR | NR | NR | Cyan plus pale comparison; NR | Hover marker, vertical guide, floating values | Derivation/point detail appears without navigation; timing NR. |
| Shopify 06: acquisition | 3-column report grid, some wider lower panels | NR | Repeated card gutters; NR | NR | NR | Cyan/blue plots; NR | Sessions trend, conversion, device donut, device/location lists | Empty panels explain absence instead of disappearing. |
| Shopify 07: cohorts/referrals | Wide cohort table + narrow landing-page list; 3 below | Tabular numerical hierarchy; NR | Aligned rows; NR | NR | NR | Neutral field, blue bars; NR | Cohort matrix, page counts, referrer/channel bars | Dense analytics belongs on its own route. |
| Shopify 08: report end | 3-column row, single lower empty card | NR | Same; NR | NR | NR | Same; NR | Referrer bars, POS empty states, product sell-through | Lower rows continue the same component language. |
| Copilot 01: empty dashboard | Grouped left rail; two wide charts; asymmetric lower panels | Values above supporting labels; NR | Calm empty regions; NR | Soft rounding, NR | Subtle, NR | Near-white/grey, green actual; NR | Spending/net-worth, review queue, categories, upcoming | Empty states have a next action and keep structure. |
| Copilot 02: empty categories | Left rail / category list / right detail | List labels vs summary value; NR | Flat rows; NR | NR | NR | Neutral with muted selection; NR | Spent/budget heading, category groups, detail trend/table | Selection exposes detail without nested cards. |
| Copilot 03: populated categories | Same 3-part shell | Aligned spent/budget/remaining; NR | Repeated bar rows; NR | NR | NR | Green/red/amber bars; NR | Value-limit progress, grouped balances, threshold chart, detail table | Transfer to crew slack; use explicit pass/fail and numeric margins. |
| HoneyBook 01: setup | Dark rail / wide checklist / narrow help column | Greeting then checklist labels; NR | Repeated checklist rows; NR | Restrained, NR | NR | Dark rail, white cards; NR | Setup completion, tasks, brand/integrations, support | Persistent completion communicates where to resume. |
| HoneyBook 02: home | Greeting + 4-stat strip; 3 columns below | Large greeting/numerals; NR | Sections separated from row content; NR | NR | NR | Dark rail/light field; NR | Create actions, automation empty state, leads, calendar | Main next actions precede secondary activity. |
| HoneyBook 03: populated home | Same | Same; NR | Same; NR | NR | NR | Same; NR | Populated booking total, lead list, waiting/activity tabs | Same layout handles live and empty content. |
| HoneyBook 04: calendar/activity | Two upper columns; wide unread + narrow payments | NR | Lists align within panels; NR | NR | NR | Green payment progress; NR | Calendar rows, event feed, unread empty state, payments | Avoid copying decorative illustrations; retain clear state copy. |
| HoneyBook 05: payments/tasks | Wide unread panel + payments; 3 panels below | NR | Repeated panel spacing; NR | NR | NR | Neutral/green; NR | Payment summaries, notes empty state, task checklist | Long overview scrolls instead of compressing everything above fold. |
| HoneyBook 06: lower home | 3 columns; offer card below | NR | Same rhythm; NR | NR | NR | Same; NR | Payments overview tabs, notes, tasks, offer | Olus should omit unrelated promotion cards. |
| Higgsfield 01: avatar menu | Global top navigation; right-anchored popover | Small menu labels; NR | Grouped actions; NR | Rounded, NR | NR | Near-black, light text, lime; NR | Credits, profile, account, workspace, community, sign out | Relevant avatar hierarchy; translate semantics, not lime branding. |
| Higgsfield 02: account | Left section nav; centered content column | Profile heading / numeric credits; NR | Stacked flat sections; NR | NR | NR | Near-black cards on dark; NR | Profile, dismissible banner, credit/history, auto-publish, deletion | Dangerous account action separated from normal actions. |
| Higgsfield 03: empty history | Same | Value + supporting caption; NR | Empty table region retains size; NR | NR | NR | Same; NR | Credits, history empty state, toggle, danger zone | Empty history includes a specific action. |
| Higgsfield 04: gifts | Same rail, single compact panel | NR | Large unused content region; NR | NR | NR | Same; NR | Gift card promotion | No reason to copy the promotion into Olus. |
| Higgsfield 05: subscription | Same centered column | Plan/title/value hierarchy; NR | Grouped plan details; NR | NR | NR | Light controls, lime primary; NR | Plan feature list, credits bar, auto-refill, bundle | Strong contrast for actions; Olus uses jade only where meaningful. |
| Higgsfield 06: plan features | Same, scrolled feature list | NR | Flat repeated rows; NR | NR | NR | Same; NR | Feature rows with right actions, manage subscription | Trailing actions share one alignment rail. |
| Higgsfield 07: usage overview | Left rail; banner; KPI strip + full-width segmented bar | Oversized spend and secondary units; NR | Summary before detail; NR | NR | NR | Dark surfaces, multi-color segments; NR | Date range, dismiss banner, four metrics, wrapped legend, bundle | This is the requested spend-overview grammar. Avoid decorative categories/colors. |
| Higgsfield 08: usage detail | Same shell, full-width list | Monospace-like numerical columns; exact stack NR | Consistent rows; NR | NR | NR | Same; NR | Credit amount, product, status, timestamp | Right-aligned figures; table alternative required for Olus charts. |
| Higgsfield 09: promo empty | Same shell; central input | Large input prompt; NR | Sparse; NR | NR | NR | Dark/grey; NR | Single promo field | One task per page; not an Olus feature requirement. |

## Live computed-style forensics

Browser: Edge via Playwright, 1440×900 viewport. Values captured with `getComputedStyle`; raw JSON retains each sampled element. These are limited to the public surfaces named below.

| Public surface / element | Recovered values | Scope limitation |
|---|---|---|
| Higgsfield public top-nav Explore | Inter; 14px; padding 4px 8px; radius 8px; foreground RGB(209,254,23), equivalent #D1FE17; 200ms cubic-bezier(.4,0,.2,1) color/background transitions | Public nav, **not** spend cards or Outcrowd hover. Do not copy lime into Olus. |
| Copilot login Continue with email | 15px; padding 8px; radius 12px; Matter/Inter font stack | Login control, not category row measurements. |
| Copilot login Apple control | 15px; padding 8px; radius 12px | Same limitation. |
| Outcrowd agency Contact | 14px; padding 14.544px 21.024px 11.52px; radius 8.064px; background RGB(254,74,35), #FE4A23 | Agency marketing button, **not** Anna Smith dashboard. |
| Outcrowd agency View details | Background transition 300ms; radius 8.064px | Does not establish dashboard card physics. |
| Shopify admin | Verification challenge | No dashboard DOM/style measurements recovered; do not bypass access checks. |
| HoneyBook app | No visible sampled UI after the initial load window | No usable dashboard measurements recovered in this pass. |

Authenticated card padding, row heights, chart stroke widths, dashboard hover transform/duration/ease and exact dashboard hex remain **NR**. User-provided screenshots may establish layout evidence; only source/live DOM or design specs can establish exact CSS values. Do not manufacture numbers to fill the table.

## Olus application decisions from evidence

- Primary shell remains reserved for the actual PRIMARY Outcrowd attachment. HoneyBook supplies overview task grouping, not a replacement shell authority.
- Benchmark reports use Shopify's date/comparison context, fixed numerical columns, empty-state continuity and point detail. Do not copy its smaller typography.
- Legality uses Copilot's direct value-versus-limit rows, with crew/rule/value/limit/slack and an accessible derivation expansion.
- Dark mode uses Higgsfield's flat near-black surfaces and clear control contrast. Its usage screen demonstrates the requested banner, metric strip and wrapped legend.
- Map selection and 3D airframe remain reserved for the actual Aroval reference. Mindtrip is not acceptable evidence.
- V2 supplies conflicting 24px reference radii and a locked 8/12/20/999 scale. Use the locked 20px card token while retaining the observed composition; record this as an Olus adaptation, not an exact source measurement.

## Supplied reference pack: resolved authority

The earlier search-result table records the Mobbin lookup, not current attachment availability. The local references now resolve the three missing identities.

| Screen | Grid | Type scale | Spacing rhythm | Radii / shadows / color values | Component inventory | Interaction notes |
|---|---|---|---|---|---|---|
| PRIMARY Outcrowd | Full-width pill navigation; three upper columns; lower small 2×2 metrics beside a wider list/map region | Large numerals at card bottom; small grey supporting labels; exact px NR | Consistent open gutters, close title/subtitle grouping; exact px NR | Rounded white cards on neutral field; exact CSS NR | Active black nav pill, search, avatar, multi-series lines, dashed crosshair, +24% bubble, bar chart, delta chips, selectable company rows, labeled map | Selected row inverts black. Static frame cannot prove hover physics. Transfer shell rhythm; omit decorative sticker cluster and nested map card because v2 forbids those. |
| MAP Aroval | Left navigation, adjacent selected-flight column, dominant full-height map, bottom flight strip | Airport codes dominate panel; mono-like flight IDs/times; exact stack NR | Image → airport pair → time rows → progress → flight details; exact px NR | Charcoal surfaces with fine rules; exact CSS NR | White aircraft render, airport pair, timezone labels, schedule/actual, route arc, distance/time, white map aircraft and selected halo, ticker | Static frame demonstrates selection composition, not live interpolation or true 3D. Build those as explicit Olus requirements; translate purple to semantic jade. |
| LAYOUT-ONLY SkyMind | Four KPI tiles, two charts, right alerts rail, lower operations table | Low-contrast small labels; exact px NR | Dense table/chart grouping; NR | Pastel tiles and faint borders explicitly rejected | KPI strip, trend/bar charts, utilization, alerts, operations | Use hierarchy only; no icon/color/contrast inheritance. |
| DARKTHEME Higgsfield | Centered usage column with left account rail | Values over small units; NR | Banner → summary → detailed history; NR | Near-black surfaces; exact CSS NR | Dismissible banner, four summary values, stacked segment bar, wrapped legend, history | Corresponds to Mobbin usage screen 7 already inspected. |
| ANALYTICS Shopify | Four KPI tiles, wide chart plus narrow numeric breakdown | Value/definition hierarchy; NR | Repeated report gutters; NR | White/grey/cyan; CSS NR | Date and comparison controls, sparkline tiles, breakdown, secondary charts | Matches the accepted captured analytics flow. |
| PROGRESSBARS Copilot | Grouped account rail; two upper charts; category and upcoming rows | Inline balances and value/limit figures; NR | Flat rows inside clear groups; NR | Near-white surface; CSS NR | Spending/net-worth, review empty state, category bars, upcoming | Confirms grouped balances and threshold presentation for legality. |
| SHELL HoneyBook | Dark rail, greeting, four-value strip, three task columns | Greeting then large values; NR | Tasks grouped below summary; NR | White cards / dark rail; CSS NR | Setup completion, create actions, automation, leads, calendar | Supplies overview content order; Outcrowd still owns global shell. |

The eleven Joby frames establish the opening, hero/caption, gallery size contrast, asymmetric journey, full-bleed technology, staggered news and sky/footer sequence. Three United Carriers frames establish flat dots, cropped sphere with rim/arcs, and asymmetric two-tone stats. This local UC folder does not include the flyover frame; the earlier supplied chat image and work-order path/timing remain its references.

The six bug images were inspected: loader palette/mark, **Joby reference** paragraph wipe (bug-02 is not an Olus runtime capture), docs identity/type, simultaneous laptop/gallery layers, blank section and missing stats-left composition. Static defects establish symptoms, not their JavaScript causes.

## Research checkpoint

The supplied-reference review is complete and both documents have been shown before implementation. Live authenticated CSS values remain NR as documented. Proceed to production diagnosis without inventing those measurements. No dashboard deletion occurred during research.


## Mobbin follow-up: map inspector and status strip
Queried the live Mobbin MCP for flight-tracking screens and flows. Inspected KAYAK, Mindtrip and Kiwi screen previews and KAYAK's seven-screen tracking flow.
- Primary retrieved reference: https://mobbin.com/screens/6bcc82eb-d4a3-4917-917d-ca105eb006fb
- Flow: https://mobbin.com/flows/b60748fd-8694-4baf-a6cf-3d9335976cec
- Applied grammar: flight identity above grouped, rule-separated label/value rows; map stays visible beside the inspector. Adapted to existing dark Olus controls and full-screen map.
- Local Aroval reference supplies the visible 3D-aircraft inspector composition. Reused the shipped olus-airliner.glb asset.
- No exact easing or duration can be recovered from the static Mobbin captures. The 180ms inspector entrance and reduced-motion fallback are implementation choices, not measured reference values.
- World wrapping disabled; minimum zoom 2. Aircraft remain individual blue sprites at every zoom, per the latest user instruction; clustering has been removed.

## Feature-restoration follow-up

Rechecked the KAYAK airport flight list (https://mobbin.com/screens/a60c42b8-9aea-4d69-82eb-0b381b3fc9c4) and flight detail via Mobbin MCP. Airport movements, route endpoint groups and labeled status rows informed the restoration. See `dashboard-feature-parity.md` for old-to-new capability mapping and data boundaries.
