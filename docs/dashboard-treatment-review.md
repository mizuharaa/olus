# Dashboard treatment review — 2026-09-16

## Evidence
Mobbin MCP search_screens was used and the returned previews inspected. No aircraft-dispatch-specific screen was returned; do not claim these are Aroval or that the apps are proven top-performing.
- KAYAK: https://mobbin.com/screens/a60c42b8-9aea-4d69-82eb-0b381b3fc9c4 — airport/date/time summary over a plain flight ledger beside a large map. Reuse the list hierarchy and stable map/detail relationship.
- Asana: https://mobbin.com/screens/95628ff8-7999-4c30-9820-5924b8fd9c59 — neutral selected row, thin separators, docked detail pane, aligned label/value fields. Reuse quiet inspection states.
- Mindtrip: https://mobbin.com/screens/a11bd1b6-96ff-4aff-9a73-e353f5fa0971 — map/list split; small secondary flight details. Considered, not copied wholesale.
- shadcn Tabs: https://ui.shadcn.com/docs/components/radix/tabs — use existing repository components, no package installation.

Screenshots establish composition, not exact CSS dimensions or animation timing. No timings were recovered; local transitions are authored at 160ms and respect reduced motion.

## Confirmed causes in our code
- EventPanel draws an active-tab inset fringe while workspace styles also round every event button, causing the colored raised edge.
- Command selection combines inherited violet inset shadow with a jade rectangular outline.
- Flight detail title adds an ornamental blue 3px strip.
- Financial comparison hovers add another blue inset shadow.
- Inspector forces a 350px child minimum inside an already scrollable column, producing competing scroll areas.

## Implemented common repair
Neutral tab underlines and list selection; explicit Selected label; semantic map/event colors retained. Removed title stripe and financial hover stripe. Inspector content can shrink. Keyboard focus stays jade.

## Choose before broad layout rollout
/design-review embeds one real operations dashboard, not three copies of its WebGL map. It presents Docked console, Floating tools and Daylight console. Styles affect only the iframe preview. Controls operate local simulation normally; no automatic event is triggered. Copy the chosen implementation prompt to request the final rollout.

The existing PRODUCT.md and DESIGN.md contain older beige/brand/backend statements. Current user instructions override those; unrelated historical records were not silently rewritten.

Agent command: `$impeccable live apps/web/app/app/overview/page.tsx` for the skill's browser element selection/variant workflow. This is entered into the coding-agent chat, not PowerShell.

## Accepted direction
User selected **Floating tools**. Applied to the operations console: 8px floating panel corners, hairline boundaries without layered shadows, neutral tabs and selection, 48px event rows, contained scrolling, short color transitions and preserved keyboard focus. Fullscreen map and all existing operation callbacks remain intact. The review page defaults to Floating tools.
