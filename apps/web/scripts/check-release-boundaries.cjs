const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest } = require('next/server');

function load(file, fetch, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] || require(name), fetch, Headers, Response, AbortController, setTimeout, clearTimeout, console, process: { env: {} } });
  return exports;
}

(async () => {
  let forwarded = 0;
  const proxy = load('app/api/v1/[...path]/route.ts', async (url, options) => {
    forwarded++;
    assert.equal(options.headers.get('origin'), null, 'Preview origin is checked locally, not forwarded');
    assert.equal(options.headers.get('x-csrf-token'), 'csrf-test');
    assert.equal(options.headers.get('cookie'), 'olus_session=test');
    return new Response('{}', { headers: { 'set-cookie': 'olus_session=new-test; HttpOnly; Secure; SameSite=Lax' } });
  }, { '@/lib/backend-config': { getBackendUrl: () => 'https://backend.invalid' } });
  const context = { params: Promise.resolve({ path: ['account', 'profile'] }) };
  const request = origin => new NextRequest('https://preview.example/api/v1/account/profile', { method: 'POST', headers: { origin, cookie: 'olus_session=test', 'x-csrf-token': 'csrf-test' }, body: '{}' });
  assert.equal((await proxy.POST(request('https://evil.example'), context)).status, 403);
  assert.equal(forwarded, 0);
  const response = await proxy.POST(request('https://preview.example'), context);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(response.headers.get('cache-control'), 'no-store');

  let sessions = 0, mutations = 0;
  const { apiClient } = load('lib/api.ts', async (url, options) => {
    if (url.endsWith('/account/session')) {
      sessions++;
      return Response.json({ csrf_token: 'fresh' }, { status: sessions === 1 ? 503 : 200 });
    }
    mutations++;
    if (mutations === 1) return Response.json({ detail: 'Refresh your session and retry' }, { status: 403 });
    assert.equal(options.headers.get('x-csrf-token'), 'fresh');
    return Response.json({ saved: true });
  });
  assert.equal((await apiClient.patch('/account/profile', { name: 'Test' })).data.saved, true);
  assert.equal(sessions, 2);
  assert.equal(mutations, 2);

  const feed = load('app/api/flights-live/route.ts', async () => new Response('', { status: 503 }));
  const unavailable = await feed.GET();
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');
  assert.ok((await unavailable.json()).error);
  console.log('PASS: preview same-origin/CSRF boundary, cookie relay, session recovery and honest feed failure. No servers started.');
})().catch(error => { console.error(error); process.exitCode = 1; });
