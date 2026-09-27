# Olus UI implementation prompts and geometric contract

Use with [the research evidence](OLUS-UI-RESEARCH-20260920.md) and the latest decision at the top of `design.md`. These are exact **Olus design targets**, not claimed Mobbin CSS measurements. Work in the existing Next.js app. Keep the landing page and root marketing tokens intact. Reuse current components and dependencies.

## Shared contract — prepend to every component prompt

```text
You are implementing Olus's existing aviation operations workspace.
Read the current component, callers, scoped tokens and OLUS-UI-RESEARCH-20260920.md.
Preserve all real workflows and data contracts. Use the approved full-screen map
with floating tools. Never replace a working tool with a decorative mockup.

Use these scoped layout tokens:
  spacing: 4, 8, 12, 16, 24, 32, 48 px
  desktop outer rail: 24px; tablet: 16px; mobile: 12px
  sibling controls: 8px; floating regions: 12px desktop, 8px mobile
  panel padding: 24px desktop, 16px mobile
  section separation: 32px; related field separation: 16px; label gap: 8px
  control target: minimum 44×44px; comfortable event rows: minimum 48px
  panel/control radius: 8px; boundary: 1px neutral; no ornamental shadow
  body: 15px/24px; labels: 14px/20px; metadata: 13px/20px
  headings: 24px/32px; numerals and timestamps: tabular, with units
  border-box sizing; min-width:0 and min-height:0 for shrinking grid children

Place layout with grid/flex and gap, not independent pixel nudges. All headers,
field labels, content and footers in a panel share its content rail. Text aligns
left; numbers align right; icons center in their own fixed-size box. Center an
element against the named container, never against an accidental sibling gap.
Equal left/right grid tracks are required for a truly centered primary nav.

Preserve the existing semantic palette: amber disrupted, jade recovered,
red violation/destructive, blue unaffected. Selection is neutral. Color always
has a text/state equivalent. Do not invent destinations, customers, metrics,
crew legality, solver progress or API capabilities.

Every component has loading, empty, error, partial/stale, focus and disabled
states. Errors remain next to the operation that failed. Keep keyboard order
the same as visual order, visible focus, Escape behavior and focus restoration.
Prefer native controls and existing primitives. No new UI framework.

Before handoff, measure getBoundingClientRect and computed styles at the target
sizes. Fail if related left rails or centered axes differ by more than 1 CSS px,
if a control is obscured, or if the document overflows horizontally. Tables may
scroll inside a labeled container. Capture real screenshots, including long
names, empty results and open overlays. A screenshot alone is not a test pass.
```

## 1. Shell and navigation

```text
Implement WorkspaceShell in place. At >=1200px use a 64px header with columns
minmax(0,1fr) auto minmax(0,1fr). Brand left, nav geometrically centered, search/
preferences/tools right. Use 24px outer padding, 16px column gaps, 44px controls.
Expose Operations, Scenarios and Account & API keys in primary navigation.
Set aria-current for the active route, including scenario child routes.

Below 1200px split the header into two intrinsic rows: brand/actions, then the
full-width nav. Do not hide routes. Navigation items retain 44px targets; short
screens may scroll the nav internally, never the page. At <=700px use 12px rails.

Anchor the tools menu to its trigger's trailing edge. Width <=320px and <=the
viewport minus both rails. Cap height to available viewport, scroll internally.
Use one active nav treatment and a neutral sign-out action. Do not center text
inside table-like menus. Dialogs have accessible names, bounded height and a
44px close target. The shell and content must use the same horizontal rails.
```

## 2. Operations map and floating tools

```text
Replace the independently positioned chrome with one shared grid over the map.
The map remains full-bleed behind the tools and receives pointer events in empty
grid space. Tool rows: operations toolbar; recovery preview; flexible working
area; bottom context; cascade timeline. Each row's actual height pushes the next
one down. Never assume a wrapping toolbar is 80px or 112px tall.

Desktop columns: 360px events, minmax(0,1fr) map space, 380px inspector, 12px gaps.
Below 1280px reduce side columns to 320px. Below 1100px show one side panel at a time,
including when an already-open desktop layout is resized.
At <=700px use one column; panel width is available width, no fixed 360px child.

Reserve 144px to the toolbar's right for projection controls on desktop. Search
gets minmax(180px,1fr) and wraps to a full row before it pushes controls out.
On mobile, keep map projection controls in a separate reserved corner/row.
Plan-preview buttons sit in their own row; horizontal scroll within that row is
acceptable at 320px. Never lay the preview over an inspector header.

Recovery comparison uses the working area. On wide screens an open events
panel occupies its own column; comparison takes the remaining columns. On
narrow screens opening Recovery closes the competing side panel. Preserve all
four plans and cost detail. Retain resize handles with a height cap based on
the working area. A plan table can scroll internally; no body overflow.

The cascade tray consumes a real row when expanded and releases it when closed.
Flight selection clears a conflicting narrow panel. Closing a panel returns
focus to its trigger where practical. Mark the control with aria-expanded and
aria-controls. No hidden interactive layers may intercept map gestures.
```

## 3. Cards, sections and benchmark tables

```text
Only use cards when the content is one independent unit. Do not place a card
inside another card. Benchmark sections share one max-1280px centered content
container. Section gap 32px; card padding 24px; same-row gap 16px. At narrow
widths collapse columns before body text becomes smaller than 15px.
Place title and section action on a shared row; wrap the action below on mobile.
Keep labels at the same y-coordinate across metric siblings; show units and a
definition. No fictional deltas or sparklines. Right-align numeric table cells
and headers on the same rail, use tabular numerals, 12px cell padding, 48px rows.
Use sticky headers only inside the table's own scroll container.
```

## 4. Scenario library and six-step setup

```text
Use the current ScenarioLibrary and ScenarioSetup data flow. One page container
owns padding; children must not add a second page gutter. At wide sizes use a
minmax(0,1fr) editor plus a 240px summary rail with a 32px gap. At <=900px move
summary below the editor. Steps wrap or scroll internally; retain all six names.
Use 8px label-to-input gaps and 16px field gaps. Form actions align to input
baselines, not label baselines. Text inputs fill available width. Keep broad
schedule/fleet tables in their own overflow container.
Save, continue and run retain actual backend behavior and unsaved-change guards.
Keep the primary action at the same logical location for each step. Long scenario
names wrap without moving trailing actions out of the viewport. Empty library
keeps the page title and create action; no ornamental illustration is needed.
```

## 5. Account, API keys and confirmation dialogs

```text
Make Account & API keys findable from desktop and mobile primary navigation and
command search. Reuse current session/CSRF/key endpoints. Profile, preferences,
keys and sessions are separated by 32px and a neutral rule, not nested cards.
Key rows align name/metadata, masked prefix, last-used state and actions.
At narrow widths stack metadata and actions; long names and key strings wrap.

New key appears once after successful creation, in a bounded code region with
a Copy button. Do not place its value in a toast or log. Rotation/revocation
dialogs name the affected key. Width min(480px, viewport minus 32px), padding
24px, heading/body gap 16px, action gap 8px. Errors show inside the dialog.
Cancel starts focused for destructive confirmation. Escape/backdrop cannot
silently complete an action. Preserve busy state and focus restoration.
```

## 6. Toasts, banners and error states

```text
Reuse Sonner. One stack, bottom-right, 16px horizontal inset, max width min(360px, viewport
minus 32px), 8px between messages. Title 14px/20px, optional supporting line
13px/20px, 16px padding, 8px radius. Keep dismiss/action targets at least 44px.
Use a 46px bottom inset above the workspace status strip. If cookie preferences
are open, place the stack 16px above the banner's measured top. Keep close
targets inside the toast instead of overhanging its corner. The stack must not
permanently hide run cancellation or commit/revert actions.
Persistent solver status should also be accessible from the run page; a toast
is supplemental. Pause dismiss timing while hovered/focused where supported.

Do not toast every intermediate field edit. Show routine saves inline where
already supported. Form errors are inline; persistent feed loss is a banner
with retry and data age; success toasts announce completed operations only.
Alerts use role=alert only when immediate interruption is justified; success
uses a polite live region. Do not duplicate the same error in dialog and page.
```

## 7. Verification prompt

```text
Test actual Olus routes, not a separately authored design mockup. Start with the
existing isolated account/scenario checks. Extend one runnable layout check.
At widths 320,390,768,1024,1280,1440,1920: assert header/nav bounds, common outer
rails, 44px controls, search bounds, preview/panel separation, and zero document
horizontal overflow. On desktop assert nav center within 1px of header center.
Open Events, select a flight, open Recovery/cost detail, expand the timeline,
open command search, open tools, switch theme and use account/key confirmation.
Check elementFromPoint at critical targets so a pretty screenshot cannot hide
a blocked action. Test 200% zoom-equivalent layout and long text. Capture the
same states before/after. Run typecheck/lint/build and the relevant real flows.
Record exact passes, failures and skipped states. Do not call the full revamp
or production release complete from the shell checkpoint alone.
```

## Review checkpoints

1. Reference evidence + this geometric contract (this research pass).
2. Real shell/map screenshots and overlap measurements before extending the rest.
3. Scenario/setup/run/plan/account consistency and complete user journeys.
4. Responsive, keyboard, accessibility, production parity and performance gates.

The user has authorized execution. These checkpoints make results reviewable;
they are not a reason to repeatedly ask permission for ordinary implementation.
