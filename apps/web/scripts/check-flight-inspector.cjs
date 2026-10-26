const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
let state = { status: 'delayed', delay_minutes: 30, cascade_order: 0 }
let previewMounts = 0
const modules = {
  './flight-detail.module.css': { default: new Proxy({}, { get: (_, key) => key }) },
  '@/lib/design-tokens': { c: new Proxy({}, { get: () => 'currentColor' }), ff: { body: 'Inter', mono: 'monospace' }, r: { sm: 4, md: 8 }, sp: { sm: 12, xs: 4 } },
  '@/stores/simulation': { useSimulationStore: () => ({ flightStates: { test: state }, fleet: [] }) },
  '@/lib/use-watchlist': { useWatchlist: () => ({ has: () => false, toggle() {} }) },
  '@/components/simulator/airports': { NIMBUS_AIRPORTS: {} },
  '@/lib/flight-derive': {},
}
const context = { exports: {}, require: name => modules[name] ?? require(name) }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/simulator/flight-detail.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, context)
const flight = { id: 'test', flight_number: 'NB202', origin: 'KORD', destination: 'KDEN', scheduled_departure: '2026-10-26T09:00:00Z', scheduled_arrival: '2026-10-26T11:00:00Z', passengers: 137 }
function Preview() { previewMounts++; return React.createElement('canvas') }
const render = () => renderToStaticMarkup(React.createElement(context.exports.FlightDetailPanel, { scheduled: flight, onClose() {}, preview: React.createElement(Preview) }))
let html = render()
assert.match(html, /Departure and arrival times/)
assert.match(html, /09:00Z/)
assert.match(html, /09:30Z/)
assert.match(html, /11:30Z/)
assert.match(html, /Delayed 30 min/)
assert.match(html, /137/)
assert.equal(previewMounts, 0, 'closed aircraft disclosure must not mount WebGL preview')
state = { ...state, status: 'cancelled' }
html = render()
assert.match(html, /Cancelled/)
assert.doesNotMatch(html, /09:30Z|11:30Z/, 'cancelled flights must not advertise revised operating times')
assert.match(html, /09:00Z/, 'retain original schedule on cancellation')
console.log('PASS: scheduled/revised UTC times, cancellation, recorded fields and idle closed aircraft preview')
