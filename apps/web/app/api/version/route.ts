import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export function GET() {
  return NextResponse.json(
    { service: "olus-web", revision: process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_SHA || "local" },
    { headers: { "Cache-Control": "no-store" } }
  )
}
