# Economics and passenger-data integrity

Local backend implementation, not a production deployment or financial/legal certification.

## Reproduced and fixed

- Delay carbon defaults to ground/APU burn; explicit airborne fractions are validated.
- Cancellation carbon uses scheduled timezone-aware block time, with a disclosed
  assumed duration only when that evidence is absent.
- Carbon totals expose net change against scheduled operations. The fixed carbon
  price is a scenario assumption; negative deltas do not earn modeled cash credits.
- Cost ledgers separate passenger time from modeled goodwill. Cancelled passengers
  without recovery times cannot produce a misleading complete passenger-delay total.
- Missing passenger loads use one consistent, disclosed aircraft-capacity assumption
  across cost and time ledgers. Zero passengers remain zero; invalid counts fail.
- Unknown event kinds no longer silently become airline-caused events. Passenger
  policy output reports unknown classification, not a legal force-majeure conclusion.
- Rebooking reads current scenario data, skips invalid timezone/date records,
  excludes canceled/full flights, sorts before selecting two options, and exposes
  scenario capacity minus bookings or unknown availability. It is not live inventory.
- Hotel allowances are itemized. The unused cancellation-cost DOT261 alias was
  removed; the legacy passenger-response alias remains explicitly deprecated to
  avoid breaking the separate frontend lane.
- Decision-flip explanations score every candidate before selecting the largest
  changes. They explicitly do not check alternative feasibility; the new constrained
  what-if API performs that work. Full rescoring has a documented quadratic ceiling.

## QA

Actual read-only Claude CLI review identified rebooking order, incorrect available
seat arithmetic, hidden/aliased amounts, inconsistent unknown-event classification,
inconsistent missing passenger counts and prematurely truncated counterfactuals.
Each accepted finding was checked against its caller and covered by regression tests.

Second actual Claude review confirmed those fixes. Additional findings were
cross-checked and resolved: seed-fleet aircraft aliases now map to their actual
models; the Boeing 757 category was independently checked against Boeing and
corrected to narrowbody (the review's widebody assumption was rejected); all
shared/private solver and explanation paths now use one modeled economic cause;
labor-action policy aliases agree; missing passenger loads use the aircraft map;
cancelled-flight delay is null instead of a fabricated zero-minute confidence band;
the policy no longer promises unimplemented overnight hotel allowances.

The reviewer called a difference of zero-floored carbon charges an arithmetic bug.
That interpretation was rejected: the scenario intentionally issues no negative
carbon credit. The floor and delta basis are now explicit response metadata.
Seat suggestions are candidate availability, not a reservation or allocation engine.

`tests/test_economic_integrity.py`: 17 passed after the fixes.
The merged backend suite passed **261 tests**. Scoped mypy passed on **18 source files**.
No claim is made that the separate frontend regression is green; its wall-clock
money accumulator and legacy legal labels are explicitly handed off in
`docs/solver-integrity-audit-2026-09-20.md`.
