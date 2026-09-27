# Olus component research — 20 September 2026

Scope: the operations workspace and supporting scenario/account screens. Preserve the approved landing page. This extends the September 16 **Floating tools** decision in `design.md`: full-screen map, collapsible tools, 8px corners, 1px neutral borders, real operational data. It does not revive the superseded beige board or delete working tools.

## Evidence you can inspect

- [Visual reference board](reference/ui-20260920/index.html): 31 locally saved, full-resolution Mobbin images, grouped by component. Each image links back to its canonical source.
- [Mobbin manifest](reference/ui-20260920/manifest.json): returned screen/section/flow IDs and image URLs. Downloads use the high-resolution URLs, not the inline previews.
- [Public computed styles](reference/ui-20260920/public-computed-styles.json): browser measurements at 1440×1000 from Intercom and Linear. These are public-site measurements, not authenticated product CSS.
- [Implementation prompts and layout contract](OLUS-UI-PROMPTS.md): exact Olus targets, relationships, responsive rules and checks.

Nine Mobbin MCP searches covered aviation, navigation, analytics, toasts, tables/drawers, website header sections, API-key flows, setup forms and empty states. All 21 individual screen/section previews and the six supplied flow previews were visually inspected. The four intermediate Klaviyo frames were then opened at full resolution, completing inspection of both key flows (10 frames).

### Popular, recent and award research

- [Dribbble Popular dashboards](https://dribbble.com/search/dashboard) and [New & Noteworthy dashboards](https://dribbble.com/search/shots/recent?q=dashboard) were inspected independently. Their retrieved results overlap. Ranking and engagement establish discovery signals, not task success, accessibility or measured product performance.
- [Aviation dashboard results](https://dribbble.com/tags/aviation-dashboard) show Aroval, Aircraft Bluebook and other aviation concepts. The retrieved page showed Aroval at 103 likes / 16.3k views, and Aircraft Bluebook at 34 / 23k. These are page snapshots, not a claim of highest performance.
- [Aroval](https://dribbble.com/shots/27153251-Aroval-AI-Flight-Tracking) is explicitly a Figma concept. Use its selected-flight/map composition; do not treat it as evidence of a working airline system. Its supplied reference image already lives in `reference/olus-ui`.
- [Awwwards nominees](https://www.awwwards.com/websites/nominees/) were inspected. Retrieved entries include WISPR FLOW and PRIME OS. No aviation operations dashboard was established among those entries. The Site of the Day/data-visualization requests failed; no winner or trend ranking is inferred from that failure.
- Mobbin MCP returns relevance matches, not dates, likes, ratings or a popularity sort. Its public catalog did not yield a usable ranking through the available route. **No claim that these are Mobbin's newest or most popular apps.**

## What transfers into Olus

| Element | Inspected reference | Observation | Olus decision |
|---|---|---|---|
| Flight list + map | [KAYAK](https://mobbin.com/screens/a60c42b8-9aea-4d69-82eb-0b381b3fc9c4) | Repeated flight rows beside a persistent map, with a shared header rail | Keep map context while selecting a flight; align identifiers and route/time columns |
| Aviation search mismatch | [Better Stack](https://mobbin.com/screens/d010f35a-a593-4bde-8646-90474c5067a4), [Mindtrip](https://mobbin.com/screens/a3f03288-4029-4633-a514-06f5ce4f5761) | Log viewer and booking results respectively | Do not pass either off as an aviation operations reference |
| Account navigation | [Webflow](https://mobbin.com/screens/e6ef30e7-d8d2-450f-b039-1fd1ccc0bdd3) | Avatar menu aligned to its trigger; account/workspace/sign-out grouped | Keep tools and account discoverable; menu anchored to trigger and clamped to viewport |
| Command search | [Asana](https://mobbin.com/screens/a6cc9c82-315c-40ef-bc5e-62fe158cdfff) | Search results attached to the search rail, grouped by purpose | Preserve Cmd/Ctrl K, visible label, keyboard close and aligned results |
| Header section | [Intercom](https://mobbin.com/sites/sections/650d948a-d6fe-47dc-8332-f3639148b176) | Dropdown begins under navigation and uses separated link groups | Use a bounded tool menu; do not insert a marketing mega-menu into operations |
| Header alternatives | [Square](https://mobbin.com/sites/sections/28c2f772-c177-4a07-82f5-96b0aefca614), [AngelList](https://mobbin.com/sites/sections/df6f47be-606e-488d-b2c9-a3fe010d35b9) | Edge-aligned identity/actions; AngelList has a central nav group | Equal outer grid tracks for true centering; no absolute 50% centering into adjacent controls |
| Metrics and tables | [Mintlify](https://mobbin.com/screens/4e5e24d5-edf6-4895-9a0c-b8634c37a34c), [StackAI](https://mobbin.com/screens/7bd07fc7-33e1-4ebd-8684-52112bb37050) | Metric labels/values share rails; detail table follows the chart | Use for benchmarks, not extra dashboard cards over the map; align numeric columns right |
| Detail drawer | [Airtable](https://mobbin.com/screens/f65719b7-eafe-4246-be7e-e3afd0b8da07) | Selected-row context remains beside an inspector | Keep selected-flight context; inspector occupies a reserved grid column |
| Search mismatch | [Height](https://mobbin.com/screens/63a8a72a-c47e-4f1d-90b4-5cd7b99ec799) | Returned for a Linear query; it is not Linear | Label the actual product; use only its visible list/detail relationship |
| Toasts | [Lovable](https://mobbin.com/screens/986c056e-925a-49fb-b300-30a3f2ac8f7d) | Bottom-right message with title and supporting line | One bounded notification stack; reserve enough space and keep critical actions available |
| Toast counterexamples | [Gamma](https://mobbin.com/screens/513cdf3f-b769-4238-be13-b414e31279ef), [Origin](https://mobbin.com/screens/51895887-f33f-42f7-a85f-1c6c6721626f) | Messages compete with modal/drawer headers | Keep confirmation errors inside the dialog; do not duplicate success messaging across overlays |
| API-key workflow | [Klaviyo, seven frames](https://mobbin.com/flows/c64b59bd-31c2-43e5-a4af-175c6d56338e), [Perplexity, three frames](https://mobbin.com/flows/a5556e09-0139-4611-983f-840ccd687b3e) | Named settings destination, key creation, copy and return-to-list | Explicit Account & API keys navigation; retain Olus's one-time secret, confirmation and existing permissions |
| Setup | [Lightfield](https://mobbin.com/screens/44d70382-9b3b-4888-a593-175c9efb542d), [Navattic](https://mobbin.com/screens/19895879-3d36-4311-acac-65f7c5809adf) | Labels and inputs share a left rail; progress separated from the form | Keep six explicit steps, aligned labels/fields/actions, and a persistent summary where width allows |
| Empty state | [Microsoft Copilot](https://mobbin.com/screens/5c465bd2-580a-450d-b921-6b6a19fd1f06), [Frame.io](https://mobbin.com/screens/131f6ec6-eeb4-4d4a-9bfd-710869658d1b) | Existing page header and create action remain present when the list is empty | Preserve page geometry; explain the next action; omit promotional banners |

## Actual source measurements versus Olus choices

| Source / element | Measured at 1440×1000 | Transfer decision |
|---|---|---|
| Intercom public header | 66px tall; nav x=12, y=13, height=40 | Adopt explicit header/control alignment, not its marketing dimensions |
| Intercom Product control | 40px high, 16px type / 24px line height, 6px radius, 4px internal gap | Olus uses 44px targets and its locked 8px radius |
| Intercom login/sales links | 40px high; 12px horizontal padding; vertically centered | One reusable control-height and padding rule |
| Linear public header/nav | 73px outer header including border; 72px nav; flex aligned center | Olus uses 64px header with 44px controls, so 10px vertical inset |
| Linear Product/login controls | 32px high; 13px type; 12px horizontal padding | Do not inherit the smaller targets/type into the operational console |

Fonts, radii and spacing of the authenticated Mobbin product screens remain **not recovered as CSS**. Their screenshots support composition observations only. Exact values below are authored Olus specifications, not invented measurements of competitors.

## First implementation checkpoint

Before this checkpoint, the source contained repeated generations of absolute offsets for operation controls, plan previews, event panels, inspection and recovery. Their positions were computed independently; a wrapped toolbar could enter the panel area. Mobile CSS also hid the primary navigation.

The first implementation uses a shared grid for floating tool rows, common outer rails, visible mobile navigation and an explicit account destination. Existing map, event, comparison and solver components remain in use. Browser checks must cover simultaneous panel states and 320/390/768/1024/1280/1440/1920 widths. Production release and the remaining product work remain governed by [the carry-out ledger](REVAMP-CARRYOUT-20260920.md).


The implementation and screenshots are now available in the [measured review](verification/dashboard/ui-review-20260920.html). The runnable check is `node scripts/check-scenario-integration.mjs` from `apps/web`; it creates an isolated signed-in scenario, solves it, then checks the layout at seven widths. `node scripts/check-account-integration.mjs` covers account/key behavior, theme contrast tokens and mobile notification/consent separation. The exact measurements are authored-layout results, distinct from the competitor observations above.
