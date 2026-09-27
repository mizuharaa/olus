/**
 * Server-side proxy for all /api/v1/* requests.
 *
 * The browser always calls same-origin /api/v1/... — no CORS, no baked-in URL.
 * This route reads API_URL at request time rather than build time.
 *
 * Vercel's API_URL points to the AWS API. WebSockets discover WS_URL/API_URL
 * separately through /api/ws-config.
 */
import { NextRequest, NextResponse } from "next/server"
import { getBackendUrl } from "@/lib/backend-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function proxyTimeoutMs(): number {
  const configured = Number(process.env.API_PROXY_TIMEOUT_MS || 55_000)
  if (!Number.isFinite(configured)) return 55_000
  return Math.min(55_000, Math.max(1_000, configured))
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method)
  const origin = req.headers.get("origin")
  if (unsafe && origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ detail: "Cross-origin state changes are not allowed." }, { status: 403 })
  }
  const backend = getBackendUrl()
  if (!backend) {
    return NextResponse.json(
      {
        detail:
          "API backend is not configured. Set API_URL to the FastAPI service URL.",
      },
      { status: 503 }
    )
  }

  const encodedPath = path.map((part) => encodeURIComponent(part)).join("/")
  const url = `${backend}/api/v1/${encodedPath}${req.nextUrl.search}`

  const headers = new Headers()
  // The same-origin check above owns browser mutations, including preview hosts.
  for (const name of ["content-type", "cookie", "authorization", "x-csrf-token"]) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }
  const init: RequestInit = { method: req.method, headers, cache: "no-store" }

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer()
  }

  // Recovery solves can legitimately take longer than a cold container startup.
  // Keep this just under maxDuration so the proxy can return a structured 504.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), proxyTimeoutMs())

  try {
    const upstream = await fetch(url, { ...init, signal: controller.signal })
    const body = await upstream.arrayBuffer()
    const responseHeaders = new Headers({
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    })
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append("set-cookie", cookie)
    return new NextResponse(body, { status: upstream.status, headers: responseHeaders })
  } catch (e) {
    const isTimeout = e instanceof Error && e.name === "AbortError"
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      {
        detail: isTimeout
          ? "The API did not respond before the proxy timeout. Check service logs and health."
          : `Unable to reach the API backend: ${message}`,
      },
      { status: isTimeout ? 504 : 502 }
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxy(req, (await params).path)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxy(req, (await params).path)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxy(req, (await params).path)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await params).path)
}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await params).path)
}
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {

      "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, x-csrf-token, authorization",
    },
  })
}
