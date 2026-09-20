import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.OLUS_NEXT_DIST_DIR || ".next",
  reactStrictMode: false,
  typedRoutes: true,
}

export default nextConfig
