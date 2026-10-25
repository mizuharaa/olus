// Run from apps/web: node scripts/check-operations-clarity.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('components/simulator/flight-map.tsx', 'utf8');
const ast = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(ast);
function evaluate(code, context) {
  return vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
const focus = nodes.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'FocusFlight');
const focused = { current: null };
let moves = 0;
const context = {
  useMap: () => ({ flyTo() { moves++; }, flyToBounds() { moves++; } }),
  useRef: () => focused, useEffect: effect => effect(),
  NIMBUS_AIRPORTS: { A: { lat: 1, lon: 1 }, B: { lat: 2, lon: 2 } },
  L: { latLngBounds: () => ({ pad: () => [] }) },
};
evaluate(focus.getText(ast) + '\nthis.focus = FocusFlight;', context);
context.focus({ target: { icao24: 'a', lat: 1, lon: 1 } });
context.focus({ target: { icao24: 'a', lat: 2, lon: 2 } });
assert.equal(moves, 1, 'A refreshed contact must not steal the user zoom');
context.focus({ target: { icao24: 'b', lat: 2, lon: 2 } });
context.focus({ target: null });
context.focus({ target: { icao24: 'b', lat: 3, lon: 3 } });
assert.equal(moves, 3, 'New selection and reselection must still focus');
context.focus({ target: { id: 'scheduled', origin: 'A', destination: 'B' } });
context.focus({ target: { id: 'scheduled', origin: 'A', destination: 'B' } });
assert.equal(moves, 4, 'Scheduled snapshot refresh must also preserve zoom');

const routes = nodes.find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === '{ impactRoutes, impactIds }');
assert.ok(routes, 'Find the production route calculation');
const calculate = routes.initializer.arguments[0].getText(ast);
const routeContext = {
  schedule: ['swap', 'delay', 'cancel', 'cascade', 'normal'].map(id => ({ id, origin: 'A', destination: 'B' })),
  flightStates: { cascade: { cascade_order: 1 } },
  applied: { swap: new Set(['swap', 'cancel']), delayed: new Set(['delay']) },
  visuallyCancelled: new Set(['cancel']), selectedFlight: null,
  NIMBUS_AIRPORTS: context.NIMBUS_AIRPORTS,
  MAP_COLORS: { planCancelledInk: '#555', planSwap: '#080', planDelayed: '#a50' },
  cascColor: () => '#a50',
};
const result = evaluate(`(${calculate})()`, routeContext);
assert.deepEqual(Array.from(result.impactRoutes, r => [r.id, r.kind]), [
  ['swap', 'swap'], ['delay', 'delayed'], ['cancel', 'cancelled'], ['cascade', 'cascade'],
], 'Plan actions render without a flight-state record; cancellation takes precedence');
assert.equal(result.impactIds.has('normal'), false);
const cancellations = nodes.find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'visuallyCancelled');
const cancellationContext = {
  applied: { cancelled: new Set(['cut']), delayed: new Map([['recovered', 20]]), swap: new Set(['swapped']) },
  visualPlanId: 'B',
  flightStates: {
    recovered: { status: 'cancelled' }, swapped: { status: 'cancelled' },
    untouched: { status: 'cancelled' }, oldPlan: { status: 'cancelled', applied_plan_id: 'A' },
  },
};
assert.deepEqual(Array.from(evaluate(`(${cancellations.initializer.arguments[0].getText(ast)})()`, cancellationContext)),
  ['cut', 'swapped', 'untouched'], 'Explicit delay recovers baseline cancellations; swaps alone do not; stale plan cancellations are excluded');

// Exercise the actual canvas effect without a browser or an animation timer.
const traffic = nodes.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'LiveTrafficLayer');
const effects = [], handlers = new Map(), canvas = { style: {}, setAttribute() {}, remove() {}, getContext: () => ({}) };
let frameCount = 0;
const map = {
  getContainer: () => ({ appendChild() {} }),
  on(events, fn) { for (const event of events.split(' ')) handlers.set(event, fn); },
  off(events) { for (const event of events.split(' ')) handlers.delete(event); },
};
const line = () => ({ addTo() { return this; }, remove() {}, setLatLngs() {} });
const trafficContext = {
  useMap: () => map, useRef: current => ({ current }), useEffect: effect => effects.push(effect),
  document: { hidden: false, createElement: () => canvas, addEventListener() {}, removeEventListener() {} },
  window: { setInterval: () => 1 }, clearInterval() {},
  requestAnimationFrame: () => ++frameCount, cancelAnimationFrame() {},
  getComputedStyle: () => ({ getPropertyValue: () => '#123456' }),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  Path2D: function () {}, AIRFRAME_PATH: '', L: { polyline: line },
};
evaluate(traffic.getText(ast) + '\nLiveTrafficLayer({planes:[],selected:null,onSelect:()=>{}});', trafficContext);
const cleanup = effects.map(effect => effect()).filter(Boolean);
handlers.get('zoomstart')();
assert.equal(canvas.style.visibility, 'hidden');
handlers.get('moveend')(); // A drag interrupted flyTo; Leaflet need not send zoomend.
assert.equal(canvas.style.visibility, 'visible');
assert.ok(frameCount >= 2, 'Interrupted zoom schedules a fresh canvas frame');
cleanup.forEach(fn => fn());
assert.equal(handlers.size, 0, 'Unmount removes the map listeners');
console.log('PASS: plan-only routes, preview recovery, zoom focus, interrupted zoom and listener cleanup');
