# Solver integrity audit and UI-lane handoff — 2026-09-20

## Implementation follow-up (supersedes the original open-findings list)

The original audit below is retained as historical evidence, not current status.
Backend follow-up now implements:

- Joint active-disruption solving and cancellation/recompute, stale-plan guards,
  and authenticated immutable child runs for dispatcher decision locks. Contract:
  `docs/what-if-backend-contract.md`.
- Shared aircraft assignment/rotation validation, solver/fallback lock enforcement,
  and uncertainty candidate validation. Evidence and conservative limits:
  `docs/optimizer-feasibility-audit-2026-09-20.md`.
- Traceable supported crew-rule checks with pass/fail/unknown coverage. Known
  failures constrain plans; missing history does not become regulatory clearance.
  Scope: `docs/crew-rules-supported-scope-2026-09-20.md`.
- Versioned estimated cost/carbon ledgers, ground-delay fuel as default, scheduled
  block-time cancellation carbon, explicit unknown cancelled-passenger recovery
  times, consistent passenger-count assumptions, and fixed scenario carbon price.
- Passenger rebooking uses the scenario's schedule, validates timezone-aware
  timestamps, orders candidates before selecting two, and calculates available
  seats from capacity minus bookings (unknown if either input is missing).
- New scenario drafts default to a deterministic fictional two-flight reference
  with coherent aircraft and crew inputs. Existing drafts are not rewritten;
  `template: legacy_network` explicitly selects the old large demonstration data.

Each implementation lane received actual read-only Claude CLI review. Findings
were checked against code/reproductions; accepted defects received regression tests.
No frontend implementation, resume file, commit, push or deployment is included.

Merged local verification: **261 backend tests passed**; scoped mypy passed on
**18 source files**. Economic regression evidence:
`docs/economics-integrity-qa-2026-09-20.md`. These are local results, not a new CI run.

### Required UI integration (owned by the other lane)

1. Wire dispatcher edits to the child-run endpoint, show validation and infeasible
   outcomes, and display modeled child-minus-parent comparisons without changing
   the parent. The API does not provide arbitrary geographic rerouting.
2. Remove the wall-clock money accumulator described below. Plans change only
   when model inputs/results change; ledger dollars are estimates, not cash spent.
3. Consume `passenger_delay_complete`, assumed passenger-count metadata and omitted
   detail counts. Unknown recovery times are not zero-delay savings.
4. Replace DOT261/legal-entitlement text in legacy passenger/recovery components.
   `dot261_cash_usd` remains a deprecated alias for `modeled_cash_allowance_usd`
   solely for compatibility; never add both. Cancellation ledger no longer emits
   the unused `dot261_compensation_usd` alias. Hotel allowances are explicit.
5. Explain panels show ledger-only decision flips (`feasibility_checked: false`);
   only a constrained what-if re-solve can assess the alternative's feasibility.
6. Passenger impact for a canceled flight now returns `delay_minutes: null`,
   `delay_status: recovery_time_unknown`, and null interval bounds. Render
   "Recovery time unknown", not zero minutes; do not chart a confidence range.
   This contract must be integrated by the UI owner before a combined release.
7. Aircraft-model resolution and financial-cause classification are now shared.
   Mixed causes disclose an unknown financial basis rather than arbitrarily using
   the first/last event. Monetary totals may legitimately change from old runs.

Official applicability references: [Part 117](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-117),
[DOT cancellation/delay dashboard](https://www.transportation.gov/airconsumer/airline-cancellation-delay-dashboard),
and [denied boarding](https://www.transportation.gov/individuals/aviation-consumer-protection/bumping-oversales).
Modeled goodwill allowances are not statutory denied-boarding entitlements.

## Ownership and release boundary

The other lane owns website UI. This audit lane must not edit frontend source,
stage the shared worktree, or deploy its unreviewed snapshot. Existing dirty
files and untracked workspace/account/run features predate this audit.

This lane changed only:

- `apps/api/src/simulator/engine.py`: reject unusable plan statuses before apply
  can restore snapshots or mutate state. Shared by public and private apply.
- `apps/api/src/optimizer/milp.py`: honor disabled fallback; cancel grounded
  flights when fallback has no spare.
- `apps/api/tests/test_plan_apply_guard.py`: eight apply/revert/status cases.
- `apps/api/tests/test_optimizer_fallback_guards.py`: two public-solve cases.
- `apps/web/scripts/check-cost-honesty.cjs`: standalone, intentionally RED
  regression for UI owner. No frontend implementation changes were made.

No commit, push, deployment, or resume-file edit performed. These guards do not
make an optimal/heuristic plan operationally feasible or FAR-compliant.

## Confirmed defects still open, in priority order

1. **Compound disruptions lose earlier constraints.** Engine trigger predicts
   and solves the newest event alone, while retaining all active events and old
   flight-state damage. Private run worker invokes this sequentially. Two-event
   reproduction retains both delays but only the second event in final plans.
   Fix joint event prediction/constraint construction and cancellation/recompute
   together; do not merely concatenate stale state.
2. **Invalid spare aircraft.** `optimizer/milp.py` defines spares by exclusion
   from directly disrupted flights, not schedule/location/turnaround feasibility.
   Reproduction assigns N002NB to NB101 while it is already operating NB103.
3. **Crew checks are not solver constraints.** Violations are counted after solve
   using synthesized history/rest fields. An `optimal` plan can have a crew
   violation. Missing pairings do not establish legality. Crew-overbooking can
   report full coverage with a captain but no first officer.
4. **Regulatory model needs explicit scope and corrected inputs.** Current
   hour-only FDP table omits segment count; rest is calculated since rest END
   instead of qualifying rest duration; the 60-hour/168-hour limit is categorized
   as flight time rather than flight-duty period. Do not display certification.
   Official references: https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-117
   and sections 117.23 / 117.25, including Tables A/B. Version rule fixtures and
   test boundaries before claiming supported-rule compliance.
5. **Cost/carbon estimates need provenance.** Fixed carbon price, generic stage
   duration and 65% airborne-delay assumptions are modeling choices, not live
   observations. Cancellation contributes zero passenger delay in the displayed
   total. CP-SAT Green objective and reported net-carbon ledger differ; fallback
   has another cancellation rule. Separate baseline, candidate outcome, and
   estimated savings; align scoring before comparing plans.
6. **Compensation labels are unsupported.** `DOT_261` constants are modeled
   allowances, not proof of statutory entitlements. Rename/disclose assumptions
   after checking all economic/explanation consumers; do not substitute a new
   regulation number without modeling its applicability.

## Frontend handoff: confirmed deployed wall-clock counter

Read-only retrieval of `https://olus.sh/simulator` on September 20 found bundle
`/_next/static/chunks/7145-2ca92ebb0211b3a2.js` calculating
`rate * (Date.now() - earliestTriggeredAt) / 60000` and labeling it `burned`.
This matches `lib/use-live-cost.ts` and the legacy nav/top-bar consumers.
Actual-hook reproduction: unchanged simulation increases $0 -> $145.50 after
60 browser seconds; loading a four-day-old event shows $838,225.50.

Current local workspace no longer mounts those legacy callers. Public
`/app/overview` returned 404 while public `/simulator` served the older bundle.
Reconcile deployment revision before declaring the latest workspace live.

UI owner should keep API plan totals static until model inputs/results change,
label any hypothetical rate as modeled exposure, and remove browser-time dollar
accrual / `burned` claims. Do not invent a simulation clock to sustain a ticker.

Run the red regression from `apps/web`:

```powershell
node scripts/check-cost-honesty.cjs
```

This script also proposes removal of the `accrued` contract; coordinate the
actual chosen contract across callers rather than treating the test as a UI spec.

## Existing functionality vs next work

Already in source: custom flight-network playtest, airport Monte Carlo stress
tests, four objective-specific action portfolios, per-flight cancellation/delay/
swap details, modeled cost/passenger-minutes/CO2, uncertain-duration scenarios,
decision-flip scoring, apply/revert, replay, and before/after aircraft timelines.
Local uncommitted workspace also has editable saved scenarios, isolated solver
processes, progress/cancel, input hashes and persisted owner-scoped run history.
Source presence and passing targeted tests do not establish deployed readiness.

Four plans are four strategy choices, each with many flight actions. The missing
workflow is dispatcher edits/locks -> validated re-solve -> compare deltas, not
arbitrarily more cards. Existing explain output does not re-solve constraints and
must not be described as feasible subplans. Scenario edit-and-rerun already exists;
reuse that path before adding an independent editor/optimizer workflow.

Independent Claude audit was cross-checked: its claim that private-run apply has
no caller is false in current `workspace/overview.tsx`; no change made for it.

## Resume boundary

Use existing tested implementation and user-confirmed deployment facts only.
Do not claim full FAR enforcement, manual optimized rerouting, globally optimal
hindsight regret, measured financial savings, or unbuilt fixes as completed work.
Describe custom simulation, explicit action plans and modeled tradeoff analysis.
