// Notion retrieval — pure mapper for the hosted-MCP `notion-search` (ai_search
// mode) response. No `server-only`, no top-level I/O: fully unit-testable
// (mirrors lib/automation/engine.ts and lib/playbook-gate.ts). The live MCP
// call lands in a later commit; this module only shapes its output.
// See FanvueSupport/Engineering/Plan - Notion AI retrieval for drafting.md (D10).

export type NotionSnippet = {
  id: string
  title: string
  url: string
  /** The highlight excerpt — grounding text. Empty string when absent. */
  text: string
  /** The raw result `type`: "page" | "google-drive" | "slack" | "linear" | ... */
  source: string
  /** true for connector/external sources (anything other than a Notion "page"). */
  isInternalSource: boolean
  timestamp: string | null
}

export type RetrievalResult = {
  snippets: NotionSnippet[]
  backend: "ai_search" | "workspace" | "none"
  error: string | null
}

export type NotionSnippetUse = "customerSafe" | "internalOnly" | "transientExpired"

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const OUTAGE_MAX_AGE_MS = ONE_DAY_MS
const BUG_MAX_AGE_MS = 14 * ONE_DAY_MS

const OUTAGE_TERMS = [
  "outage",
  "incident",
  "downtime",
  "degraded",
  "service disruption",
  "system disruption",
  "temporarily unavailable",
  "currently unavailable",
  "not operational",
  "não está operante",
  "nao esta operante",
]

const BUG_TERMS = [
  "known issue",
  "known bug",
  "bug",
  "regression",
  "workaround",
]

// A Notion "page" is first-class support knowledge we can paraphrase from.
// Everything else (google-drive, slack, linear, github, jira, teams,
// sharepoint, onedrive...) is connector/external content — flagged internal so
// the draft layer never quotes it to the customer (firewall, spec D10).
export function isInternalSource(type: string): boolean {
  return type !== "page"
}

function includesAny(value: string, terms: string[]): boolean {
  const lower = value.toLowerCase()
  return terms.some((term) => lower.includes(term))
}

function parseSnippetTimestampMs(timestamp: string | null): number | null {
  if (!timestamp) return null

  const isoDate = timestamp.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
  const parsed = Date.parse(isoDate ?? timestamp)
  return Number.isFinite(parsed) ? parsed : null
}

function transientMaxAgeMs(snippet: NotionSnippet): number | null {
  const searchable = `${snippet.title}\n${snippet.text}`
  if (includesAny(searchable, OUTAGE_TERMS)) return OUTAGE_MAX_AGE_MS
  if (includesAny(searchable, BUG_TERMS)) return BUG_MAX_AGE_MS
  return null
}

export function classifyNotionSnippetUse(
  snippet: NotionSnippet,
  nowMs: number = Date.now()
): NotionSnippetUse {
  const maxAgeMs = transientMaxAgeMs(snippet)
  if (maxAgeMs != null) {
    const timestampMs = parseSnippetTimestampMs(snippet.timestamp)
    if (timestampMs == null || nowMs - timestampMs > maxAgeMs) {
      return "transientExpired"
    }
  }

  return snippet.isInternalSource ? "internalOnly" : "customerSafe"
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}

// Maps a raw notion-search response into snippets, capped at `limit`.
// Defensive: tolerates missing/!=object input, missing fields, non-array
// results → returns [].
//
// Skip rule: an entry is dropped unless it is an object with non-empty string
// `id`, `title` AND `url`. These three are required to render and link a
// snippet; anything missing one is unusable for grounding, so we skip it rather
// than emit a half-formed snippet. A missing `type` defaults to "" → treated as
// internal (not a Notion page), keeping the firewall fail-safe.
export function mapAiSearchResults(raw: unknown, limit: number): NotionSnippet[] {
  if (!isRecord(raw)) return []
  const results = raw.results
  if (!Array.isArray(results)) return []
  if (!Number.isFinite(limit) || limit <= 0) return []

  const snippets: NotionSnippet[] = []
  for (const entry of results) {
    if (snippets.length >= limit) break
    if (!isRecord(entry)) continue

    const { id, title, url, type, highlight, timestamp } = entry
    if (typeof id !== "string" || id === "") continue
    if (typeof title !== "string" || title === "") continue
    if (typeof url !== "string" || url === "") continue

    const source = typeof type === "string" ? type : ""
    snippets.push({
      id,
      title,
      url,
      text: typeof highlight === "string" ? highlight : "",
      source,
      isInternalSource: isInternalSource(source),
      timestamp: typeof timestamp === "string" ? timestamp : null,
    })
  }

  return snippets
}

// Normalise a raw hosted-MCP `tools/call` result into the object
// mapAiSearchResults wants (something with a `results` array). The hosted MCP
// may return the search payload either as:
//   - result.structuredContent: { results: [...] }
//   - result.content[i].text: a JSON string '{"results":[...]}'
// Pure + unit-tested (lives here, not in the server-only client module, so it's
// testable without Next's bundler). Returns null when no parseable payload is
// found.
export function extractSearchPayload(result: unknown): unknown {
  if (!isRecord(result)) return null

  // 1. structuredContent (preferred — already an object).
  const structured = result.structuredContent
  if (isRecord(structured) && Array.isArray(structured.results)) {
    return structured
  }

  // 2. text content blocks — parse the first that yields an object with results.
  const content = result.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue
      const text = block.text
      if (typeof text !== "string") continue
      try {
        const parsed: unknown = JSON.parse(text)
        if (isRecord(parsed) && Array.isArray(parsed.results)) return parsed
      } catch {
        // not JSON — skip
      }
    }
  }

  return null
}
