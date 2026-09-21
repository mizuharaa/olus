# Backend release check — 2026-09-21

Scoped integration on top of `origin/main` at `f1d1160`; the older development checkout and separate UI lane are untouched. Preserves main's ADS-B provider selection, AWS infrastructure and frontend. No production deployment requested or performed.

## Included

- Recovery/crew/economics correctness fixes and regression tests documented in the September 20 audits.
- Private accounts, scenario drafts and persisted worker runs required by authenticated what-if child runs.
- Local-only k6 harness and six original measurement summaries, including failed saturation runs.
- CI formatting/import cleanup; strict decision validation continues to reject boolean delays.

## Local checks

- Ruff lint: passed.
- Ruff format check: 94 files unchanged after formatting.
- Mypy: passed across 70 source files.
- Pytest: 273 passed, one skipped, 22.28 seconds on the final local run.
- Git whitespace check: passed.

Local pytest did not collect coverage because the installed environment lacks pytest-cov. GitHub CI installs the declared development dependencies and runs coverage, frontend type checking and the frontend production build. Its result must be reported separately; local success is not a remote CI result.

## Release limits

This branch is for review, not an automatic production rollout. The UI integration obligations in `solver-integrity-audit-2026-09-20.md` remain with the other lane. In particular, unknown passenger recovery times require corresponding frontend handling. Worker capacity rejects excess submissions rather than queueing; the k6 report retains all rejection evidence. Crew coverage is a supported subset, not full regulatory certification.
