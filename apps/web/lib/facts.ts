/** Product facts verified against the repository, not performance claims.
 * Run `node scripts/check-product-facts.mjs` when changing the source model. */
export const facts = {
  verifiedAt: "2026-09-16",
  solver: "OR-Tools CP-SAT",
  disruptionTypes: 22,
  recoveryObjectives: 4,
  replayWorkers: 1,
  sources: {
    events: "apps/api/src/events/catalog.py · EVENT_DEFAULTS",
    optimizer: "apps/api/src/optimizer/milp.py · PLAN_WEIGHTS / RecoveryOptimizer",
    crew: "apps/api/src/crew/far117.py · CrewLegalityEngine",
  },
} as const
