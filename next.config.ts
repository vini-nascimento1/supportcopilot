import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === "edge") {
      // next/dist/compiled/@opentelemetry/api is ncc-compiled and references
      // __dirname. Polyfill it to "/" for the Edge Runtime (matches dev behavior).
      config.node = { ...config.node, __dirname: "mock" }
    }
    return config
  },
}

export default nextConfig
