import assert from 'node:assert/strict';

const [web, api, revision] = process.argv.slice(2);
assert.ok(web && api && revision, 'Usage: node scripts/check-release.mjs WEB_URL API_URL EXPECTED_REVISION');
const get = (origin, path) => fetch(new URL(path, origin), { cache: 'no-store', signal: AbortSignal.timeout(30000) });
for (const [origin, path, service] of [[web, '/api/version', 'olus-web'], [api, '/health', 'olus-api']]) {
  const response = await get(origin, path);
  assert.equal(response.status, 200, path);
  const body = await response.json();
  assert.equal(body.service, service);
  assert.equal(body.revision, revision, `${service} is serving another revision`);
}
for (const path of ['/', '/docs', '/app/account', '/app/overview', '/app/scenarios', '/app/benchmarks', '/app/runs/release-check']) {
  assert.equal((await get(web, path)).status, 200, `Missing web route ${path}`);
}
for (const origin of [api, web]) {
  for (const path of ['/api/v1/account/session', '/api/v1/scenario-workspaces', '/api/v1/runs/release-check', '/api/v1/benchmarks']) {
    assert.equal((await get(origin, path)).status, 401, `Private route missing or unprotected: ${origin}${path}`);
  }
}
console.log(`PASS: both services serve ${revision}; workspace pages exist and private APIs require sign-in through both origins.`);
