"use client"
import { useEffect, useState } from "react"
import { useSimulationStore } from "@/stores/simulation"
import { toWebSocketUrl } from "@/lib/backend-url"

/**
 * Resolve the WebSocket base URL in priority order:
 *  1. NEXT_PUBLIC_WS_URL — explicit baked-in override
 *  2. NEXT_PUBLIC_API_URL — baked in, http→ws conversion
 *  3. /api/ws-config     — server-side runtime lookup (reads API_URL env var);
 *                          works even when no NEXT_PUBLIC_* was set at build time
 *  4. ws://localhost:8000 — local dev fallback
 */
async function resolveWsUrl(): Promise<string | null> {
  const explicit = process.env.NEXT_PUBLIC_WS_URL
  if (explicit) return toWebSocketUrl(explicit)
  const api = process.env.NEXT_PUBLIC_API_URL
  if (api) return toWebSocketUrl(api)

  try {
    const res = await fetch("/api/ws-config", { cache: "no-store" })
    if (res.ok) {
      const { wsUrl } = (await res.json()) as { wsUrl: string | null }
      if (wsUrl) return toWebSocketUrl(wsUrl)
    }
  } catch {}

  return process.env.NODE_ENV === "development" ? "ws://localhost:8000" : null
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false)
  useEffect(() => {
    // Each mount owns its URL lookup. A shared mounted ref can reactivate an
    // earlier StrictMode lookup and create a second socket after remount.
    let active = true
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined
    const connect = (url: string) => {
      if (!active) return
      try {
        const current = new WebSocket(`${url}/ws/simulation`)
        socket = current
        current.onopen = () => {
          if (!active) return
          setIsConnected(true)
          ping = setInterval(() => {
            if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: "ping" }))
          }, 25000)
        }
        current.onmessage = (event) => {
          if (!active) return
          try {
            const message = JSON.parse(event.data as string)
            if (message.type !== "pong" && message.type !== "ping") useSimulationStore.getState().setUpdate(message)
          } catch (error) { console.warn("[WS] Invalid simulation message", error) }
        }
        current.onclose = () => {
          clearInterval(ping)
          if (!active) return
          setIsConnected(false)
          retry = setTimeout(() => connect(url), 3000)
        }
        current.onerror = () => current.close()
      } catch {
        if (active) { setIsConnected(false); retry = setTimeout(() => connect(url), 5000) }
      }
    }
    resolveWsUrl().then(url => { if (active && url) connect(url) })
    return () => {
      active = false
      clearTimeout(retry)
      clearInterval(ping)
      if (socket) { socket.onclose = null; socket.onmessage = null; socket.close() }
    }
  }, [])
  return { isConnected }
}
