// Always use same-origin paths so requests go through the server-side proxy
// at app/api/v1/[...path]/route.ts — that route reads API_URL (server-side)
// and forwards to the configured backend. This keeps its URL off the browser and
// removes any CORS dependency for REST calls.
// Note: NEXT_PUBLIC_API_URL is still used by websocket.ts for WS URL derivation.
const API_URL = ""
let csrfToken: string | null | undefined
let sessionRequest: Promise<void> | undefined
async function prepareCsrf() {
  if (csrfToken) return
  if (!sessionRequest) sessionRequest = fetch("/api/v1/account/session", { cache: "no-store", credentials: "same-origin" })
    .then(async response => { csrfToken = response.ok ? (await response.json()).csrf_token : null })
    .catch(() => { csrfToken = null })
    .finally(() => { sessionRequest = undefined })
  await sessionRequest
}

async function request<T>(path: string, init?: RequestInit, csrfRetried = false): Promise<{ data: T }> {
  const url = `${API_URL}/api/v1${path.startsWith("/") ? path : `/${path}`}`
  let res: Response
  const method = init?.method ?? "GET"
  const headers = new Headers(init?.headers)
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && path !== "/account/login") {
    await prepareCsrf()
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken)
  }

  try {
    res = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init, headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to reach the Olus API (${message})`)
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { detail?: unknown } | null
    const detail = payload?.detail
    if (!csrfRetried && res.status === 403 && detail === "Refresh your session and retry") {
      csrfToken = undefined
      return request<T>(path, init, true)
    }
    const message = typeof detail === "string" ? detail : Array.isArray(detail)
      ? detail.map(item => typeof item?.msg === "string" ? `${Array.isArray(item.loc) ? item.loc.filter((part: unknown) => part !== "body").join(".") + ": " : ""}${item.msg}` : "Invalid request value").join("; ")
      : `API request failed with status ${res.status}`
    throw new Error(message)
  }

  if (res.status === 204) return { data: undefined as T }
  const data = await res.json()
  if (path === "/account/login" || path === "/account/session") csrfToken = data.csrf_token
  if (path === "/account/logout") csrfToken = null
  return { data: data as T }
}

export const apiClient = {
  async get<T = unknown>(path: string): Promise<{ data: T }> {
    return request<T>(path)
  },

  async post<T = unknown>(path: string, body?: unknown): Promise<{ data: T }> {
    return request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  },

  async patch<T = unknown>(path: string, body: unknown): Promise<{ data: T }> {
    return request<T>(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  },

  async del<T = unknown>(path: string): Promise<{ data: T }> {
    return request<T>(path, {
      method: "DELETE",
    })
  },
}
