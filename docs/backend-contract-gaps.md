# Backend contract status

Updated 2026-09-16 after explicit API ownership transfer in chat. AWS infrastructure was not changed.

## Implemented

- `/account`: provisioned operator accounts, scrypt password hashes, HttpOnly sessions, CSRF protection, profile/preferences, session revocation, expiring hashed API keys and rotation/revocation. No public self-registration or fabricated login.
- `/scenario-workspaces`: owner-scoped SQLite storage, validated schedule/fleet/crew/disruptions, optimistic revision checks, duplicate/archive. Canned shared demo scenarios remain available separately.
- `/runs`: immutable input snapshot/hash, real CP-SAT incumbent events, worker-process cancellation, persisted results and run history. Private apply/unapply and explanation use that run's own network rather than the shared demo engine.
- `/runs/{id}/crew-audit`: computed modeled limits/slack and input derivations for actual crew assignments. Unknown inputs remain unknown. This is not a complete regulatory compliance certificate.
- `/benchmarks`: recorded run timings and input hashes, with date filters; no fabricated history.
- Frontend: account, six-step setup, run monitor, benchmarks, and private results on the existing full-screen map. Public feed/reset is bypassed on management pages and private run maps.

## Verified so far

- Complete API suite: **146 passed** (`py -3.11 -m pytest tests -q`, apps/api; local Python 3.11 with existing site-packages).
- Dedicated tests cover authentication/CSRF, key/session ownership and revocation, scenario revisions/persistence, genuine solver progress/cancellation, private apply/unapply, and crew input derivations.
- Browser account flow through the Next proxy and six-step scenario-to-private-map flow passed. No shared simulator mutations occurred during that private flow. Final production regression checks remain separate from deployment evidence.

## Remaining external contracts / limits

- Newsletter delivery/opt-in provider is not configured. The footer uses a working engineering-notes link instead of a fake submission success.
- ADS-B position and heading do not establish a destination. Live route enrichment remains dependent on an authoritative provider; the map distinguishes observed history and heading projection.
- Existing crew regulation model is simplified. Missing rest/timezone inputs are exposed as unknown rather than marked legal.
- Public deployment and operator account provisioning are not performed by these local tests. Provision an operator with `python -m src.store.accounts EMAIL` on the API host; its password prompt is interactive. Keep `OLUS_COOKIE_SECURE=true` in production.
