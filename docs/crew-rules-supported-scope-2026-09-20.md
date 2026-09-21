# Supported crew-rule model

Source checked September 20, 2026: [official eCFR Part 117](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-117), Tables A/B and sections 117.11, 117.13, 117.23, 117.25(b/e). This is a planning simulator, not an operational dispatch or compliance certificate.

## Implemented

- Table B uses report time in the acclimated theater and total scheduled FDP segments. Table A distinguishes its day/night limits. There is no invented WOCL half-hour deduction.
- Cumulative flight time and flight-duty time have separate history inputs. The obsolete 60-hour seven-day **flight-time** check is removed; this is a duty-time limit.
- Rest uses the actual declared rest interval or duration ending at report, never elapsed time since rest ended. Missing history produces unknown checks, not a legal pass.
- Audit and optimizer share `assess_plan_crew`. Canonically equivalent report timestamps share a duty/segment count. Both pilot roles, exact supplied aircraft qualifications, location continuity and turn intervals are checked. A 30-minute turn is an operational model assumption, not a Part 117 rule.
- Crew reassignment requires both captain and first officer; neither may cover more than one reassigned leg. Unknown regulatory evidence is disclosed for simulation candidates. The legacy `far117_legal` flag is always false because the implementation does not certify the whole regulation.
- Cancellation does not automatically imply denied-boarding cash compensation. Assistance fields are illustrative carrier-policy assumptions, not statutory entitlements.

## Input migration

Use timezone-aware `current_fdp_start`/pairing `duty_start`, `last_rest_start` and `last_rest_end` (or `last_rest_duration_hours` plus end), `sleep_opportunity_minutes`, and `consecutive_duty_free_168h_minutes`.

Explicitly provide `acclimated: true`, `operation_type: unaugmented`, and `acclimated_timezone_offset_hours`. `home_timezone_offset_hours` is used only with `acclimated_at_home: true`.

`flight_time_28d_minutes`, `flight_time_365d_minutes`, `fdp_time_7d_minutes`, and `fdp_time_28d_minutes` are historical totals **before the current FDP**, excluding it. `current_fdp_flight_minutes` contains completed legs not already present in the assessed schedule. Do not send fabricated zero histories for real rosters. Legacy flight-hours inputs are not duty-hours inputs.

`LegalityResult.status` is `fail` for known violations, `unknown` for incomplete evidence, and `pass` only for complete supported checks. `is_legal` means this bounded subset passed, not that all Part 117 requirements passed. Callers must not treat `not is_legal` as a proven violation. Missing rest shortfall is `null`, not zero.

## Deliberate limits

Multi-FDP assessments cannot derive rolling-window expiry or subsequent rest from a single historical snapshot: affected cumulative/rest rows remain unknown. A definite under-ten-hour gap between planned duties is still rejected. Timestamped per-duty history is needed for complete multi-day evaluation.

Reserve, split/augmented duty, approved extensions, fitness declarations, travel recovery, consecutive nighttime operations and regulatory exceptions are outside this model. Cross-type qualifications and crew deadheading are not inferred. No frontend edits or deployment were part of this lane.

## Validation

`apps/api/tests/test_crew_rules_integrity.py` covers table boundaries, fractional offsets, rest semantics, distinct cumulative limits, unknown inputs, two-pilot coverage, qualifications and reproduced Claude QA findings. Existing crew fixtures now use correct rest-start/end and duty-time semantics; the old audit assertion for a seven-day flight-time rule was migrated.

Actual Claude CLI read-only QA was run. Its first five findings were independently reproduced/checked and regression-tested before fixes. Source/test formatting and lint were checked with the repository's existing Ruff installation.

A second actual Claude pass identified a missing-first-report sentinel defect, reassignment segment/overlap assumptions, and missing-location matching. These were crosschecked and fixed with explicit regressions. Final focused run: 59 passing tests across crew rules, migrated crew tests, private run manager and the new reference scenario. Other lanes' later changes may alter the aggregate count.
