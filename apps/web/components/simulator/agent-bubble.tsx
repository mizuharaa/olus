"use client"
/**
 * AgentBubble — "Ask Olus", the grounded OCC copilot.
 *
 * A floating pill in the dashboard's bottom-right that expands into a chat
 * panel. Every question is answered by the backend /agent/ask route, which
 * snapshots the live engine state (events, cascade, plans, fleet) and asks
 * Gemini to answer grounded in those exact numbers — so answers cite the
 * console's own figures instead of hallucinating.
 *
 * Rate limit: the backend allows ~10 questions/min per IP; a 429 shows as a
 * quiet inline notice, not an error wall.
 */

import { useEffect, useRef, useState } from "react"
import { CornerDownLeft, X } from "lucide-react"
import { OlusMark } from "@/components/ds/logo"
import { apiClient } from "@/lib/api"

const INK = "#183136"
const BONE = "#F7F5F1"
const AMBER = "#ADC8BE"

const EXAMPLES = [
  "What's the state of the network right now?",
  "Compare the recovery plans by passenger impact",
  "Which flights are hit worst, and why?",
]

type Msg = { role: "user" | "model"; text: string; error?: boolean }

export function AgentBubble() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDialogElement>(null)

  // keep the newest message in view
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })
  }, [msgs, busy])

  useEffect(() => {
    if (open) { panelRef.current?.showModal(); inputRef.current?.focus() }
  }, [open])

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    setInput("")
    setBusy(true)
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }))
    setMsgs((m) => [...m, { role: "user", text: question }])
    try {
      const res = await apiClient.post<{ answer: string }>("/agent/ask", { question, history })
      setMsgs((m) => [...m, { role: "model", text: res.data.answer }])
    } catch (e) {
      const text = e instanceof Error ? e.message : "Copilot unavailable"
      setMsgs((m) => [...m, { role: "model", text, error: true }])
    } finally {
      setBusy(false)
    }
  }

  return (
    // Anchored to the nav, not floating over the workspace. As a fixed
    // bottom-right pill it overlapped the cascade timeline's bottom-right
    // corner in EVERY panel state and at every width (measured 129.6 x 41.5 =
    // 5,377px over the >=21:00 end of the 18-hour axis), and the Recovery panel
    // reserved 96px of dead padding just to dodge it. The workspace now
    // allocates all of its height to tracks, so the nav is the only region with
    // free space — which is also where a global tool belongs.
    <div style={{ position: "relative", zIndex: 46 }}>
        {open && (
          <dialog
            ref={panelRef}
            aria-label="Olus copilot"
            onClose={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: "auto 20px 48px auto",
              margin: 0,
              padding: 0,
              maxHeight: "calc(100dvh - 80px)",
              width: "min(390px, calc(100vw - 40px))",
              borderRadius: 14,
              background: INK,
              color: BONE,
              border: 0,
              boxShadow: "0 24px 64px rgba(10,6,26,0.4)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "12px 14px",
                borderBottom: "1px solid rgba(240,235,223,0.12)",
                flexShrink: 0,
              }}
            >
              <OlusMark size={17} style={{ color: BONE }} accent={AMBER} />
              <span style={{ fontFamily: "var(--ae-font-display)", fontWeight: 650, fontSize: 16 }}>
                Olus copilot
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--ae-font-body)",
                  fontSize: 12,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "rgba(240,235,223,0.55)",
                }}
              >
                Grounded · live state
              </span>
              <button
                onClick={() => panelRef.current?.close()}
                aria-label="Close copilot panel"
                style={{ background: "none", border: "none", color: BONE, cursor: "pointer", display: "inline-flex", padding: 2, minHeight: 44, minWidth: 44 }}
              >
                <X style={{ width: 14, height: 14 }} strokeWidth={2} />
              </button>
            </div>

            {/* conversation */}
            <div
              ref={scrollRef}
              className="ae-scroll-smooth"
              style={{
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                overflowY: "auto",
                maxHeight: "min(46vh, 420px)",
                minHeight: 120,
              }}
            >
              {msgs.length === 0 && (
                <>
                  <span style={{ fontSize: 12, color: "rgba(240,235,223,0.66)", lineHeight: 1.5 }}>
                    Ask about the live network — events, cascades, recovery plans,
                    costs. Answers cite the console&apos;s own numbers.
                  </span>
                  {EXAMPLES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => ask(e)}
                      style={{
                        fontFamily: "var(--ae-font-body)",
                        fontSize: 14,
                        lineHeight: 1.45,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(240,235,223,0.14)",
                        color: "rgba(240,235,223,0.85)",
                        background: "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "border-color 150ms ease, background 150ms ease",
                      }}
                      onMouseEnter={(ev) => { (ev.currentTarget.style.borderColor = "rgba(240,235,223,0.4)") }}
                      onMouseLeave={(ev) => { (ev.currentTarget.style.borderColor = "rgba(240,235,223,0.14)") }}
                    >
                      {e}
                    </button>
                  ))}
                </>
              )}

              {msgs.map((m, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "88%",
                    padding: "8px 11px",
                    borderRadius: m.role === "user" ? "11px 11px 3px 11px" : "11px 11px 11px 3px",
                    background: m.role === "user" ? "rgba(240,235,223,0.12)" : "rgba(240,235,223,0.05)",
                    border: `1px solid ${m.error ? "rgba(193,58,107,0.5)" : "rgba(240,235,223,0.10)"}`,
                    fontSize: 14,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    color: m.error ? "#E8A2BC" : BONE,
                  }}
                >
                  {m.text}
                </div>
              ))}

              {busy && (
                <div
                  aria-label="Copilot is thinking"
                  style={{
                    alignSelf: "flex-start",
                    padding: "8px 12px",
                    borderRadius: "11px 11px 11px 3px",
                    background: "rgba(240,235,223,0.05)",
                    border: "1px solid rgba(240,235,223,0.10)",
                    fontFamily: "var(--ae-font-body)",
                    fontSize: 11,
                    color: "rgba(240,235,223,0.6)",
                  }}
                >
                  <span className="ab-dots">reading the ops state</span>
                </div>
              )}
            </div>

            {/* input */}
            <form
              onSubmit={(e) => { e.preventDefault(); ask(input) }}
              style={{ padding: "0 14px 14px", flexShrink: 0 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 10,
                  border: "1px solid rgba(240,235,223,0.18)",
                  padding: "9px 11px",
                }}
              >
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={busy}
                  placeholder={busy ? "Thinking…" : "Ask about events, plans, costs…"}
                  aria-label="Ask the Olus copilot"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "none",
                    border: "none",
                    outline: "none",
                    fontSize: 14,
                    color: BONE,
                    fontFamily: "var(--ae-font-body)",
                    opacity: busy ? 0.6 : 1,
                  }}
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  aria-label="Send"
                  style={{
                    background: "none", border: "none", cursor: busy || !input.trim() ? "default" : "pointer",
                    display: "inline-flex", padding: 2,
                    color: input.trim() && !busy ? AMBER : "rgba(240,235,223,0.4)",
                  }}
                >
                  <CornerDownLeft style={{ width: 14, height: 14 }} strokeWidth={2} />
                </button>
              </div>
            </form>

            <style jsx>{`
              .ab-dots::after { content: "…"; animation: ab-blink 1.2s steps(4) infinite; }
              @keyframes ab-blink { 0% { opacity: 0.2; } 50% { opacity: 1; } 100% { opacity: 0.2; } }
            `}</style>
          </dialog>
        )}

      {/* An ink-filled pill with the cyclone mark inside it made this the
          heaviest object on a 44px bar — visual weight follows CONSEQUENCE
          (design.md), and opening a chat panel is the least consequential act
          available up here, well below Reset or Commit. It now wears the same
          hairline treatment as every other bar control, and the mark is gone
          with the rest of the OlusMark removals. A sparkle glyph would just
          be the same mistake in a different costume, so the affordance is the
          word. */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ae-bar-btn"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 30,
          padding: "0 10px",
          borderRadius: 4,
          background: open ? "var(--ae-teal-bg)" : "transparent",
          color: open ? "var(--ae-teal-ink)" : "var(--ae-text-2)",
          border: `1px solid ${open ? "var(--ae-teal)" : "var(--ae-line)"}`,
          cursor: "pointer",
          fontFamily: "var(--ae-font-body)",
          fontSize: 12,
          fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        Ask Olus
      </button>
    </div>
  )
}
