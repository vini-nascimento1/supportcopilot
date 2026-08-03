import "server-only"

// Triage keyword expansion — one model call, triggered only when the agent
// saves triage_prefs with expand=true and their keywords changed (see
// app/api/triage/prefs/route.ts, which caches the result in
// triage_prefs.expandedTerms/expandedFor so this never runs on a normal
// /api/triage read). Mirrors lib/automation/prestage.ts's `generate()`
// pattern: non-streaming, throttled through the shared-key gate
// (lib/ai-throttle). NEVER throws — every caller treats [] as "expansion
// unavailable" and falls back to the literal keywords only
// (lib/triage/match.ts filterAndRank already gates expandedTerms on `expand`).

import { withAiSlot, openaiFetch, openaiApiKey } from "@/lib/ai-throttle"
import { getAuxDraftModel } from "@/lib/draft-ai"

const MAX_TERMS = 40
const MAX_TERM_LENGTH = 40

const SYSTEM_PROMPT = `You expand support-ticket search keywords for a triage tool. Given a short list of keywords, produce up to ${MAX_TERMS} closely-related terms a customer might actually type when describing the same issue — synonyms, common misspellings, and everyday phrasing — across English, Portuguese and Spanish (Fanvue customers write in all three). Every term must be lowercase.`

// Structured output replaces the old `temperature: 0` + "output STRICT JSON"
// prompt instruction (gpt-5.x rejects temperature). The response is an object
// rather than a bare array because strict json_schema requires an object root;
// extractJsonArray below still runs as the defensive fallback.
const EXPANSION_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "keyword_expansion",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["terms"],
      properties: {
        terms: {
          type: "array",
          items: { type: "string" },
          description: `Up to ${MAX_TERMS} lowercase related search terms.`,
        },
      },
    },
  },
}

// Pull the term list out of a model response. Prefers the structured
// { "terms": [...] } object; falls back to the first [...] block anywhere in the
// text so an older/degraded response shape still works. Returns null on any
// parse failure (missing brackets, invalid JSON, not an array).
function extractJsonArray(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text.trim()) as unknown
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { terms?: unknown }).terms)) {
      return (parsed as { terms: unknown[] }).terms
    }
  } catch {
    // fall through to the bracket scan
  }
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
 * non-streaming call on the shared key (aux model, no reasoning, structured
 * output). Defensive end to end — any missing config, network failure, non-2xx
 * response, or unparseable output returns [] rather than throwing, so the caller
 * can persist "expansion unavailable" and keep filtering on the literal keywords.
 */
export async function expandKeywords(keywords: string[]): Promise<string[]> {
  if (!openaiApiKey() || keywords.length === 0) return []

  try {
    const content = await withAiSlot(async () => {
      const res = await openaiFetch("chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: getAuxDraftModel(),
          reasoning_effort: "none",
          max_completion_tokens: 1024,
          response_format: EXPANSION_SCHEMA,
          stream: false,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: keywords.join(", ") },
          ],
        }),
      })
      if (!res.ok) throw new Error(`AI API error (${res.status})`)
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
