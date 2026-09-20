// A client-navigation handoff only: a real reload deliberately clears it.
let pendingScenario = false
export function preserveLoadedScenario() { pendingScenario = true }
export function consumeLoadedScenario() {
  const pending = pendingScenario
  pendingScenario = false
  return pending
}
