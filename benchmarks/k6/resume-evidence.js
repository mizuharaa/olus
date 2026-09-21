// Local-only real-route benchmark. Read latency is NOT solver completion latency.
import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import readWorkload from './read-load.js';

const base = __ENV.BASE_URL || 'http://127.0.0.1:18761';
if (base !== 'http://127.0.0.1:18761') throw new Error('Use the isolated loopback benchmark server');
const api = `${base}/api/v1`;
const jobs = __ENV.MODE === 'jobs';
const completion = new Trend('solver_completion_ms', true);
const acceptance = new Trend('job_acceptance_ms', true);
const workflowOK = new Rate('workflow_success');
const rejected = new Counter('job_admission_rejections');
const headers = { Authorization: 'Bearer local-k6-only', 'Content-Type': 'application/json' };

export const options = {
  scenarios: jobs
    ? { solver: { executor: 'shared-iterations', vus: Number(__ENV.VUS || 2), iterations: Number(__ENV.ITERATIONS || 30), maxDuration: '5m' } }
    : { reads: { executor: 'constant-vus', vus: Number(__ENV.VUS || 25), duration: __ENV.DURATION || '60s' } },
  thresholds: jobs ? { workflow_success: ['rate==1'], http_req_failed: ['rate==0'] } : { checks: ['rate==1'], http_req_failed: ['rate==0'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'min', 'max'],
};

function waitForRun(id) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const response = http.get(`${api}/runs/${id}`, { headers, tags: { name: 'poll_run' } });
    if (response.status !== 200) return null;
    const run = response.json();
    if (['completed', 'failed', 'timed_out', 'cancelled'].includes(run.status)) return run;
    sleep(0.1);
  }
  return null;
}

export function setup() {
  if (!jobs) return {};
  const size = Number(__ENV.FLIGHTS || 50);
  const scenarios = http.get(`${api}/scenario-workspaces`, { headers }).json('scenarios');
  const scenario = scenarios.find(row => row.name === `Synthetic ${size} flights`);
  if (!scenario) fail('Benchmark scenario missing');
  const response = http.post(`${api}/runs`, JSON.stringify({ scenario_id: scenario.id }), { headers });
  if (response.status !== 202) fail(`Parent start failed: ${response.status}`);
  const parent = waitForRun(response.json('id'));
  if (!parent || parent.status !== 'completed') fail('Parent solve failed');
  return { parent: parent.id, parentHash: parent.input_hash };
}

export default function (data) {
  if (!jobs) return readWorkload();
  const started = Date.now();
  const response = http.post(`${api}/runs/${data.parent}/what-if`, JSON.stringify({ decision_locks: [{ flight_id: 'B002', cancel: false, delay_minutes: 30 }] }), { headers, tags: { name: 'start_child' } });
  acceptance.add(response.timings.duration);
  if (response.status !== 202) {
    rejected.add(1, { status: String(response.status) });
    console.warn(`Job rejected: ${response.status} ${response.body}`);
    workflowOK.add(false);
    sleep(Number(__ENV.THINK_SECONDS || 0));
    return;
  }
  const run = waitForRun(response.json('id'));
  const plans = run && run.result && run.result.recovery_plans;
  const ok = check(run, {
    'completed with four feasible validated strategies': () => run && run.status === 'completed' && plans.length === 4 && plans.every(p => ['optimal', 'feasible', 'heuristic'].includes(p.status) && p.validation.status === 'pass'),
    'dispatcher delay floor preserved': () => plans && plans.every(p => p.delayed_flights.some(d => d.flight_id === 'B002' && d.delay_minutes >= 30)),
    'parent lineage preserved': () => run && run.parent_run_id === data.parent && run.parent_input_hash === data.parentHash,
  });
  workflowOK.add(ok);
  if (ok) completion.add(Date.now() - started);
  sleep(Number(__ENV.THINK_SECONDS || 0));
}
