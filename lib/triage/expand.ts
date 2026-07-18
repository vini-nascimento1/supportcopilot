import "server-only"

// Triage keyword expansion — one Verboo call, triggered only when the agent
// saves triage_prefs with expand=true and their keywords changed (see
// app/api/triage/prefs/route.ts, which caches the result in
// triage_prefs.expandedTerms/expandedFor so this never runs on a normal
// /api/triage read). Mirrors lib/automation/prestage.ts's `generate()`
// pattern: non-streaming, throttled through the shared Verboo gate
// (lib/verboo-throttle). NEVER throws — every caller treats [] as "expansion
// unavailable" and falls back to the literal keywords only
// (lib/triage/match.ts filterAndRank already gates expandedTerms on `expand`).

import { withVerbooSlot } from "@/lib/verboo-throttle"

const VERBOO_API_KEY = process.env.VERBOO_API_KEY
const VERBOO_BASE_URL = process.env.VERBOO_BASE_URL ?? "https://code.verboo.ai/router/v1"

const MAX_TERMS = 40
const MAX_TERM_LENGTH = 40

const SYSTEM_PROMPT = `You expand support-ticket search keywords for a triage tool. Given a short list of keywords, produce up to ${MAX_TERMS} closely-related terms a customer might actually type when describing the same issue — synonyms, common misspellings, and everyday phrasing — across English, Portuguese and Spanish (Fanvue customers write in all three). Output STRICT JSON: an array of lowercase strings, and nothing else. No prose, no markdown, no explanation.`

// Find the first [...] block in a possibly noisy model response and parse it.
// Returns null on any parse failure (missing brackets, invalid JSON, not an array).
function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end === -1 || end < start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Expand a short keyword list into a larger set of related terms via one
 * non-streaming Verboo call (deepseek-v4-flash, temperature 0). Defensive
 * end to end — any missing config, network failure, non-2xx response, or
 * unparseable output returns [] rather than throwing, so the caller can
 * persist "expansion unavailable" and keep filtering on the literal keywords.
 */
export async function expandKeywords(keywords: string[]): Promise<string[]> {
  if (!VERBOO_API_KEY || keywords.length === 0) return []

  try {
    const content = await withVerbooSlot(async () => {
      const res = await fetch(`${VERBOO_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${VERBOO_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          temperature: 0,
          max_tokens: 512,
          stream: false,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: keywords.join(", ") },
          ],
        }),
      })
      if (!res.ok) throw new Error(`Verboo error (${res.status})`)
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      return data.choices?.[0]?.message?.content ?? ""
    })

    const parsed = extractJsonArray(content)
    if (!parsed) return []

    const deduped = new Set<string>()
    for (const raw of parsed) {
      if (deduped.size >= MAX_TERMS) break
      if (typeof raw !== "string") continue
      const term = raw.trim().toLowerCase()
      if (!term || term.length > MAX_TERM_LENGTH) continue
      deduped.add(term)
    }
    return Array.from(deduped)
  } catch {
    return []
  }
}
