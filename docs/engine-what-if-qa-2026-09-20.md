# Engine / what-if backend QA

Local work only: no commit, deployment, or frontend modifications in this lane.

## Implemented and checked

- All active disruption constraints and predictions enter one solve. Cancel recomputes the remaining event set and clears obsolete actions.
- Long forecasts remain delayed, not automatically canceled. Applying a plan is the operation that creates cancellations.
- Apply refuses infeasible/known-invalid plans and stale schedule/fleet/crew/event/lock contexts before changing state. New solves invalidate prior applied markers.
- Public re-solve and explanation use the same joint snapshot as event-driven solve, not the first or last event alone.
- Private what-if runs fork frozen parent inputs, enforce owner access, constrain actual optimizer decisions, preserve the parent, and expose modeled parent/child deltas.
- Private workers pass crew roster and decision locks through solve and restored apply. Shared engine construction also receives crew roster.
- Recorded cancellation operations replay with their matching frozen weather snapshots; canceled events do not reappear during replay.

## Actual Claude read-only review

Invoked local Claude CLI with plan permissions and Read/Glob/Grep tools. No Claude writes or shell execution. Findings were checked against current code before changes:

1. Wrong sickout percentage key and ignored labor-action alias: reproduced through HTTP with 0%/100% fixtures; fixed canonical keys/alias. Available first officers are retained in the reassignment pool.
2. Explain and crew-overbooking used only the first event: independently fixed by persisting joint predictions; Claude read the earlier version during concurrent work.
3. Apply dropped composition disclosure: reproduced by apply after joint solve; fixed summary preservation.
4. Joint uncertainty scaled unrelated events: reproduced; single-event sampling remains, multi-event uncertainty is explicitly not evaluated and no sampled bands are emitted.
5. Run hash preceded event stamping: reproduced by hashing actual persisted inputs; fixed ordering.
6. Missing private plan reported missing run: explicit invalid-plan error now returns 422.
7. Weather refresh not in stale hash: intentional frozen-forecast semantics retained, with frozen-at-solve basis and snapshot hash disclosed. No live-refresh validity claim.

## Checks

43 tests passed in the focused set:

`tests/test_joint_recovery_engine.py tests/test_what_if_runs.py tests/test_run_manager.py tests/test_golden_replay.py tests/test_drone_incursion.py tests/test_plan_apply_guard.py`

Ruff passed on the owned source files and the two new regression files; diff whitespace check passed. Real child processes and real OR-Tools solves are exercised. API tests cover unauthenticated refusal, wrong-owner hiding, malformed/unsupported decisions, and accepted child creation.

## Explicit limits

- Joint predictions use simultaneous maximum delay, not serial simulation of interacting events.
- Multi-event uncertainty evaluation is deferred instead of presenting misleading confidence/cost bands.
- Dispatcher controls cover cancel/keep, minimum delay, and aircraft assignment—not full route-path optimization.
- Crew overbooking uses a disclosed deterministic absence approximation (first N captains), not identified live absences.
- Missing crew inputs remain unknown; this simulator does not certify legal flight dispatch.
- The legacy large fixture has inconsistent crew/rotation data; tests use a schedulable subset for successful apply, not weakened validation.
- Other UI work, production rollout, and regulatory completeness are outside this lane.
