# Dispatcher what-if and joint-disruption backend

Local backend implementation; this does not claim a deployed frontend or live dispatch certification.

## Private child runs

`POST /runs/{parent_run_id}/what-if` uses the existing account authentication (session + CSRF, or API key), owner checks, worker capacity and persisted progress/history. Only a completed owned run may be forked. The response is a new queued run (`202`); poll `GET /runs/{child_id}` as for ordinary runs.

```json
{"decision_locks":[{"flight_id":"F1","cancel":true},{"flight_id":"F2","cancel":false,"delay_minutes":30,"aircraft_id":"T2"}]}
```

- Supported: cancel/keep, minimum departure-delay floor in integer minutes (0–10080), exact aircraft assignment. Aircraft assignment requires the flight to operate.
- Locks replace the complete lock set on the parent; include every decision to retain when branching from another child.
- Unsupported routing/airport changes, duplicate flight locks, unknown identifiers, malformed values, and cancel+delay/aircraft conflicts return `422`. An owned but unfinished parent or exhausted worker capacity returns `409`; another owner's/missing run returns `404`.
- A syntactically valid but impossible request completes with infeasible plans and no executable actions. It is not silently relaxed.
- Frozen schedule, events, crew, weather and constraints are copied into the child. Parent inputs, hash and results are not modified. Child metadata includes `parent_run_id`, `parent_input_hash`, its own `input_hash` and timestamps. Existing run event history records worker progress.
- `comparison.basis = modeled_child_minus_parent`; each comparable feasible strategy has cost and CO2 deltas, explicitly estimates. Passenger delay delta is null unless both plans have complete passenger recovery-time accounting. These are not observed money savings.
- `POST /runs/{child_id}/apply` applies only within that private run. It never changes the shared demo engine or parent.

## Shared simulator

Active event constraints are solved jointly, with affected-flight predictions combined using maximum delay, maximum disruption probability and earliest cascade order. `cascade_summary.composition = simultaneous_max_delay` exposes this simplifying model; it is not serial event-time propagation. Long predicted delays remain delays until an applied plan actually cancels a flight.

Single-event uncertain horizons retain sampled cost/regret evaluation. Multiple active events fall back to deterministic joint predictions, disclose `uncertainty_evaluation = not_evaluated_joint_events`, and do not publish fabricated sampled cost bands. Weather is frozen at solve, identified by `weather_snapshot_hash`; refreshing live weather does not retroactively change a saved forecast. Run `input_hash` covers the actual frozen event identifiers/timestamps and weather, not just the unstamped scenario template.

Canceling an event recomputes remaining constraints/predictions/plans; canceling the last event clears all disruption state. `POST /recovery/solve` uses the same engine path and updates stored plans. A supplied event list must equal the complete active set; partial safety-constraint exclusion returns `422`.

Applying unknown plans returns `404`, infeasible/failed modeled validation returns `422`, and stale input contexts return `409` without state mutation. New events, cancellation, reset and reseeding invalidate/recompute prior plans. Unknown crew inputs remain visibly unknown and are not legal certification.

No full route-path optimizer, automatic legal certification, live airline execution, or frontend implementation is claimed by this API.
