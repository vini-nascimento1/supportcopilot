import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { normalizeTriagePrefs } from "@/lib/triage/match"
import { getTriagePrefs, saveTriagePrefs } from "@/lib/triage/store"
import { expandKeywords } from "@/lib/triage/expand"

// Save the signed-in agent's triage filter prefs (keywords, audiences,
// priorityOnly, expand). Expansion is opt-in and cached: a Verboo call to
// widen `keywords` only fires when expand=true AND the normalized keyword
// set actually changed since the cached expandedFor — every other save
// (toggling priorityOnly, flipping expand back on with unchanged keywords,
// etc) is a plain DB write, no LLM call.
export async function POST(req: Request) {
  const { agentId, email } = await getAgentContext()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  if (!agentId) {
    return NextResponse.json({ error: "No agent record for this account" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const input = (body ?? {}) as Record<string, unknown>

  // Carry the EXISTING cached expandedTerms/expandedFor through normalization
  // for now — they're only replaced below once we've decided a fresh
  // expansion is actually needed, so a save that doesn't touch keywords never
  // drops the cache.
  const existing = await getTriagePrefs(agentId)
  const next = normalizeTriagePrefs({
    keywords: input.keywords,
    expand: input.expand,
    audiences: input.audiences,
    priorityOnly: input.priorityOnly,
    expandedTerms: existing.expandedTerms,
    expandedFor: existing.expandedFor,
  })

  let warning: string | undefined
  if (next.expand) {
    const normalizedKeywordsKey = next.keywords.join(",")
    if (normalizedKeywordsKey !== existing.expandedFor) {
      const expanded = await expandKeywords(next.keywords)
      next.expandedTerms = expanded
      next.expandedFor = normalizedKeywordsKey
      // Expansion failed/unavailable (Verboo down, no API key, bad output) —
      // still persist so we don't re-attempt on every future read; the
      // filter just falls back to the literal keywords until the agent saves
      // again. Surface it so the UI can say so.
      if (expanded.length === 0) warning = "expansion unavailable"
    }
  }
  // expand === false: leave the cached expandedTerms/expandedFor untouched.
  // filterAndRank already ignores expandedTerms while expand is off, so
  // there's nothing to clear or recompute here.

  const saved = await saveTriagePrefs(agentId, next)
  if (!saved) {
    return NextResponse.json({ ok: false, error: "Failed to save preferences" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, prefs: next, ...(warning ? { warning } : {}) })
}
