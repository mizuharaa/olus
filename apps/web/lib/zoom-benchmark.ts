import type { Map as LeafletMap } from "leaflet"

// Opt-in diagnostics only; bounded local results, no telemetry or network writes.
export function observeZoom(map: LeafletMap) {
  const container = map.getContainer()
  const output = document.createElement("output")
  output.id = "olus-zoom-benchmark"
  output.hidden = true
  container.appendChild(output)
  const samples: object[] = []
  let inputAt = 0, startedAt = 0, endedAt = 0, previous = 0, frame = 0
  let fromZoom = 0, gaps: number[] = [], hidden = false
  const input = (event: Event) => {
    if (frame) return
    if (event.type === "wheel" || (event.target as Element)?.closest(".leaflet-control-zoom a")) inputAt = performance.now()
  }
  const tick = () => {
    const time = performance.now()
    gaps.push(time - previous)
    previous = time
    hidden ||= document.hidden
    if ((endedAt && time >= endedAt + 100) || time - startedAt > 5000) {
      const sorted = [...gaps].sort((a, b) => a - b)
      const canvas = container.querySelector<HTMLCanvasElement>(".olus-traffic-canvas")
      samples.push({ fromZoom, toZoom: map.getZoom(), inputDelayMs: startedAt - inputAt,
        zoomDurationMs: endedAt ? endedAt - startedAt : null, timedOut: !endedAt, frameGapsMs: gaps,
        p95FrameGapMs: sorted[Math.ceil(sorted.length * .95) - 1], maxFrameGapMs: sorted.at(-1),
        framesOver50Ms: gaps.filter(n => n > 50).length, hidden,
        liveContacts: Number(canvas?.dataset.contacts ?? 0), trafficVisible: !!canvas && canvas.style.visibility !== "hidden" })
      if (samples.length > 100) samples.shift()
      output.textContent = JSON.stringify(samples)
      output.dataset.samples = String(samples.length)
      frame = 0; startedAt = 0; inputAt = 0
    } else frame = requestAnimationFrame(tick)
  }
  const start = () => {
    // Ignore programmatic fits and selection flyTo: this benchmark measures user zoom.
    if (!inputAt || performance.now() - inputAt > 1000 || frame) return
    startedAt = performance.now(); previous = startedAt; endedAt = 0
    fromZoom = map.getZoom(); gaps = []; hidden = document.hidden
    frame = requestAnimationFrame(tick)
  }
  const end = () => { if (startedAt && !endedAt) endedAt = performance.now() }
  const visibility = () => { hidden = true }
  container.addEventListener("click", input, true)
  container.addEventListener("wheel", input, { capture: true, passive: true })
  document.addEventListener("visibilitychange", visibility)
  map.on("zoomstart", start)
  map.on("zoomend moveend", end)
  output.textContent = "[]"
  output.dataset.samples = "0"
  return () => {
    cancelAnimationFrame(frame)
    container.removeEventListener("click", input, true)
    container.removeEventListener("wheel", input, true)
    document.removeEventListener("visibilitychange", visibility)
    map.off("zoomstart", start)
    map.off("zoomend moveend", end)
    output.remove()
  }
}
