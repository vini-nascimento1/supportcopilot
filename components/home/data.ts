import "server-only"

import { headers } from "next/headers"

import { buildBriefing, markHomeSeen as markSeen } from "@/lib/briefing/build"
import type { Briefing } from "@/lib/briefing/types"

// The seam between Home (app/page.tsx) and the briefing builder. Home only ever
// sees the Briefing contract in lib/briefing/types.ts.

function emptyBriefing(): Briefing {
  const now = Date.now()
  return {
    generatedAt: new Date(now).toISOString(),
    since: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    narrative: "I couldn't tell who you are, so there's nothing to brief you on yet.",
    narrativeSource: "fallback",
    counts: { now: 0, drafted: 0, researched: 0, locked: 0 },
    items: [],
    sources: [
      { source: "intercom", state: "error", message: "No signed-in agent." },
      { source: "slack", state: "error", message: "No signed-in agent." },
      { source: "gmail", state: "error", message: "No signed-in agent." },
      { source: "calendar", state: "error", message: "No signed-in agent." },
    ],
  }
}

// The request origin is what the Notion MCP token exchange needs during
// research; without it the Notion arm of grounding is skipped silently.
async function requestOrigin(): Promise<string | undefined> {
  try {
    const h = await headers()
    const host = h.get("x-forwarded-host") ?? h.get("host")
    if (!host) return undefined
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
    return `${proto}://${host}`
  } catch {
    return undefined
  }
}

export async function getBriefing(email: string | null): Promise<Briefing> {
  if (!email) return emptyBriefing()
  const origin = await requestOrigin()
  return buildBriefing(email, { origin })
}

export async function markHomeSeen(email: string | null): Promise<void> {
  if (email) await markSeen(email)
}
