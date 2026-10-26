const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const callbacks = new Map(), inputs = new Map(), frames = new Map()
let now = 100, next = 0, zoom = 5, removed = false
const output = { dataset: {}, textContent: '', remove() { removed = true } }
const container = {
  appendChild() {},
  addEventListener(name, callback) { inputs.set(name, callback) },
  removeEventListener(name) { inputs.delete(name) },
  querySelector() { return { dataset: { contacts: '6000' }, style: { visibility: 'visible' } } },
}
const map = {
  getContainer: () => container, getZoom: () => zoom,
  on(name, callback) { callbacks.set(name, callback) }, off(name) { callbacks.delete(name) },
}
const document = { hidden: false, createElement: () => output,
  addEventListener(name, callback) { inputs.set(name, callback) },
  removeEventListener(name) { inputs.delete(name) } }
const context = { exports: {}, document, performance: { now: () => now },
  requestAnimationFrame(callback) { frames.set(++next, callback); return next },
  cancelAnimationFrame(id) { frames.delete(id) }, URLSearchParams }
const code = ts.transpileModule(fs.readFileSync('lib/zoom-benchmark.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(code, context)
const stop = context.exports.observeZoom(map)
const advance = ms => {
  now += ms
  const pending = [...frames.values()]; frames.clear()
  pending.forEach(callback => callback(now))
}
callbacks.get('zoomstart')()
assert.equal(frames.size, 0, 'programmatic fits are excluded')
inputs.get('click')({ type: 'click', target: { closest: () => true } })
now += 2; callbacks.get('zoomstart')()
advance(16); advance(80)
zoom = 6; callbacks.get('zoomend moveend')()
advance(100)
const sample = JSON.parse(output.textContent)[0]
assert.equal(sample.inputDelayMs, 2)
assert.equal(sample.zoomDurationMs, 96)
assert.deepEqual(sample.frameGapsMs, [16, 80, 100])
assert.equal(sample.maxFrameGapMs, 100)
assert.equal(sample.framesOver50Ms, 2)
assert.equal(sample.liveContacts, 6000)
assert.equal(sample.trafficVisible, true)
assert.equal(sample.timedOut, false)
inputs.get('wheel')({ type: 'wheel' }); callbacks.get('zoomstart')()
document.hidden = true; inputs.get('visibilitychange')()
advance(5001)
const timedOut = JSON.parse(output.textContent)[1]
assert.equal(timedOut.timedOut, true)
assert.equal(timedOut.hidden, true)
assert.equal(timedOut.zoomDurationMs, null)
assert.equal(frames.size, 0)
stop()
assert.equal(callbacks.size, 0); assert.equal(inputs.size, 0); assert.equal(removed, true)
console.log('PASS: zoom timing, slow frames, hidden-tab invalidation, timeout and cleanup')
