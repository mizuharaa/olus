import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Isolated browser fixtures: never mutate the local or production simulator.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/ws/**', socket => socket.close());
  let release; const delayed = new Promise(resolve => { release = resolve; });
  let pending = 0, auditCalls = 0, applied = null;
  const flight = { id: 'PRIVATE1', origin: 'KORD', destination: 'KJFK', scheduled_departure: '2026-07-04T12:00:00Z', scheduled_arrival: '2026-07-04T14:00:00Z', aircraft_id: 'NTEST', tail_number: 'NTEST', passengers: 100 };
  const plan = { plan_id: 'A', objective_label: 'Test fixture', status: 'optimal', total_cost_usd: 100, total_passenger_delay_minutes: 100, cancelled_flights: [], delayed_flights: [{ flight_id: flight.id, delay_minutes: 1 }], aircraft_swaps: [], crew_violations: 0, solve_time_ms: 100 };
  const result = () => ({ schedule: [flight], aircraft: [], active_events: [], flight_states: {}, recovery_plans: [plan], applied_plan_id: applied, cascade_summary: {} });
  const run = () => ({ id: 'private-fixture', scenario_id: 'scenario-fixture', scenario_name: 'Private fixture', status: 'completed', result: result() });
  await page.route('**/api/flights-live', route => route.fulfill({ json: { flights: [] } }));
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (['/api/v1/simulator/schedule', '/api/v1/aircraft', '/api/v1/simulator/state'].includes(path)) {
      pending++; await delayed;
      const json = path.endsWith('/schedule') ? [{ ...flight, id: 'PUBLIC-STALE' }] : path.endsWith('/aircraft') ? { aircraft: [] } : { active_events: [{ id: 'old', kind: 'weather_closure', params: {} }], recovery_plans: [], flight_states: {}, applied_plan_id: null };
      return route.fulfill({ json }).catch(() => {});
    }
    if (path.endsWith('/account/session')) return route.fulfill({ json: { user: { id: 'fixture' }, csrf_token: 'fixture' } });
    if (path.endsWith('/private-fixture/apply')) { applied = route.request().postDataJSON().plan_id; return route.fulfill({ json: run() }); }
    if (path.endsWith('/private-fixture/crew-audit')) { auditCalls++; return route.fulfill({ json: { scope: `Audit ${applied || 'baseline'}`, limitations: [], rows: [] } }); }
    if (path.endsWith('/runs/private-fixture')) return route.fulfill({ json: run() });
    return route.fulfill({ json: { airports: [], programs: [], alerts: [] } });
  });
  await page.goto(`${process.env.BASE_URL || 'http://localhost:3001'}/app/overview`);
  await page.waitForFunction(() => document.body.innerText.includes('Operations'), null, { timeout: 90000 });
  await assert.doesNotReject(async () => { for (let n = 0; n < 100 && pending < 3; n++) await page.waitForTimeout(100); assert.equal(pending, 3); });
  await page.evaluate(() => history.pushState(null, '', '/app/overview?run=private-fixture'));
  await page.getByRole('button', { name: 'Back to demo', exact: true }).waitFor();
  release(); await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Events 0', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Recovery 1', exact: true }).waitFor();
  await page.getByText('Analysis tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Crew coverage & duty margins', exact: true }).click();
  await page.getByText('Inspect crew rule computations', { exact: true }).click();
  await page.getByText('Audit baseline', { exact: true }).waitFor();
  // Keep the audit mounted: reopening would refetch naturally and hide a missing invalidation.
  // Invoke handlers directly because the modeless analysis panel overlaps the recovery controls.
  await page.getByRole('button', { name: 'Recovery 1', exact: true }).evaluate(button => button.click());
  await page.getByRole('button', { name: /Commit plan A/ }).evaluate(button => button.click());
  await page.getByRole('button', { name: /Confirm.*commit plan A/i }).evaluate(button => button.click());
  await page.getByText('Audit A', { exact: true }).waitFor();
  assert.ok(auditCalls >= 2); assert.deepEqual(errors, []);
  console.log('PASS: delayed public feeds cannot overwrite private result; committed plan refreshes crew audit');
} finally { await browser.close(); }
