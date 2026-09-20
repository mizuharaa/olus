// Current outcome-based checks replace selectors from the retired split dashboard.
// Sequential: these tests intentionally mutate and reset the LOCAL simulator.
await import('./check-event-catalog.mjs');
await import('./check-operations-parity.mjs');
await import('./check-original-operations.mjs');
await import('./check-workspace-reset.mjs');
await import('./check-workspace-tools.mjs');
await import('./check-operations-accessibility.mjs');
