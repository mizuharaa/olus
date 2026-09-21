# Optimizer feasibility changes — local verification, 2026-09-20

No deployment, frontend modification, regulatory certification, or production traffic claim is made here.

## Implemented

- Public `RecoveryOptimizer.solve` accepts `decision_locks` and the real `crew_members` roster. Supported locks: `flight_id`, `cancel` (boolean), `delay_minutes` (integer minimum, 0–10080), and `aircraft_id`. Unknown IDs/fields, duplicate flight locks and cancel/action conflicts raise `ValueError`; contradictory valid actions return infeasible plans without executable actions.
- CP-SAT and its deterministic fallback share aircraft eligibility: known exact type, capacity, origin, scheduled windows, predecessor/successor location and minimum turn. Explicit tail locks are evaluated even when the aircraft has an earlier disrupted rotation.
- Shared post-validation checks final affected rotations after delays, cancellations and assignments, detecting overlaps and aircraft stranded by removed legs. Duplicate assignments are rejected. Plan C no longer double-assigns a flight in its fallback.
- Known supported crew failures constrain cancellation; the final plan is assessed using the supplied roster and actual decisions. Missing inputs remain `unknown`. `checked_flights=0` makes an all-cancel result distinguishable from an operated schedule checked against crew rules.
- A grounded aircraft without a usable spare is cancelled in fallback. `use_fallback=False`, CP-SAT INFEASIBLE, and MODEL_INVALID never silently invoke a heuristic.
- Uncertainty evaluation forwards locks and roster, preserves delay floors, revalidates each candidate under each sampled duration and after median rebuild, and excludes infeasible candidates from cost/regret comparisons. Positive delays that rounded to zero in a short scenario are restored when pricing longer scenarios.
- Green fallback uses the same delay-carbon/service-penalty policy as CP-SAT. The objective is not described as globally minimizing the separately reported net-CO2 ledger.

## Verification

Command (from `apps/api`, existing environment packages on `PYTHONPATH`):

```text
py -3.11 -m pytest tests/test_optimizer_dispatcher.py tests/test_optimizer_fallback_guards.py tests/test_optimizer.py tests/test_drone_incursion.py -q -p no:cacheprovider
65 passed in 4.75s
```

New tests observed failing before their fixes cover unavailable spare conditions, CP-SAT and fallback lock enforcement, invalid locks, known/unknown crew results, retained-tail rotation conflicts, duplicate Plan C swaps, available disrupted-tail locks, and uncertainty delay preservation. Legacy positive-path fixtures were made physically coherent; the invalid original-rotation case remains a rejection regression.

An actual Claude CLI read-only audit was run with `--permission-mode plan --tools Read,Glob,Grep`. Accepted concrete findings were independently reproduced with failing tests before fixes. Its solver/validator scope-mismatch finding remains a conservative limitation: known failures outside the decision set reject the schedule, requiring valid inputs or a broader solve rather than a false feasibility claim.

## Conservative limits

- Exact-type substitutions only; no ferry construction, airport-slot model, maintenance scheduling or global fleet reassignment. One use per spare in a recovery, with 20 ordinary candidate tails plus explicitly locked tails if needed.
- Other scheduled spare legs remain reserved even if another decision cancels them. This can reject a feasible combination but never fabricates a positioning leg.
- Final validation may reject all four candidates instead of searching a second, repaired combination. Baseline known crew failures outside the decision set also reject the schedule. The existing Nimbus fixture contains such conflicts.
- Delay is a supplied forecast or dispatcher floor, not a freely optimized decision variable. Unknown data is not operational approval; `optimal` denotes the bounded CP-SAT objective only, subject to final validation.
- Uncertainty is five sampled durations and a mean-nearest committed candidate, not a full two-stage stochastic program or a globally optimal hindsight benchmark. Any sampled infeasibility rejects that committed plan instead of reporting an invented finite cost.
- Crew coverage is the explicitly implemented supported subset, not complete FAR Part 117 compliance. Root/crew audit records hold the rule-source review and input requirements.
