import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Next.js 16 uses Turbopack by default; declaring it explicitly silences
  // the "webpack config present but no turbopack config" build error.
  turbopack: {},
}

export default nextConfig
