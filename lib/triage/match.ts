// Pure filtering/ranking logic for the triage sweep pool. No I/O and no
// `server-only` (mirrors lib/reply-queue.ts) so it is unit-tested directly.
// The I/O — sweeping Intercom into `triage_items`, reading/writing
// `agents.triage_prefs` — lives in lib/triage/sweep.ts and lib/triage/store.ts.

export type TriageItem = {
  conversationId: string
  subject: string | null
  customerName: string | null
  /** Plain-text first customer message, HTML stripped, truncated (see lib/triage/sweep.ts). */
  snippet: string
  tags: string[]
  /** Intercom's native priority flag (source: `priority === "priority"`). */
  priority: boolean
  /** Intercom's native SLA status ("active" | "hit" | "missed" | "cancelled" | "none"), or null. */
  slaStatus: string | null
  /** ISO timestamp the SLA clock started waiting; null when nobody is waiting. */
  waitingSince: string | null
  conversationCreatedAt: string | null
  matchedPlaybookId: string | null
  matchedPlaybookName: string | null
  matchScore: number | null
  capabilityGap: boolean
}

// Canonical shape of agents.triage_prefs (jsonb). `expandedFor` records the
// normalized (comma-joined) keywords the cached `expandedTerms` were computed
// from, so a caller can tell a stale cache from a fresh one without re-calling
// the LLM (see lib/triage/expand.ts + app/api/triage/prefs/route.ts).
export type TriagePrefs = {
  keywords: string[]
  expand: boolean
  expandedTerms: string[]
  expandedFor: string
  audiences: string[]
  priorityOnly: boolean
}

export const EMPTY_TRIAGE_PREFS: TriagePrefs = {
  keywords: [],
  expand: false,
  expandedTerms: [],
  expandedFor: "",
  audiences: [],
  priorityOnly: false,
}

const MAX_KEYWORDS = 20
const MAX_EXPANDED_TERMS = 60

// Trim/lowercase every string in `value`, drop empties, cap the result at
// `cap` entries. Non-array or non-string entries are dropped rather than
// throwing — this is the defensive parser for untrusted jsonb.
function toTrimmedLowerStrings(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (out.length >= cap) break
    if (typeof entry !== "string") continue
    const trimmed = entry.trim().toLowerCase()
    if (trimmed) out.push(trimmed)
  }
  return out
}

// Fixed audience -> tag-substring map. Real Intercom tag vocabulary is
// SHOUTY_SNAKE ("CREATOR_TAG", "KYC_TAG", ...); normalizeForMatch lowercases
// both sides so a substring check ("creator" in "creator_tag") is enough.
export const AUDIENCES: Record<string, string[]> = {
  creator: ["creator"],
  fan: ["fan"],
  agency: ["agency"],
}
const AUDIENCE_KEYS = new Set(Object.keys(AUDIENCES))

/**
 * Defensive parse of the `agents.triage_prefs` jsonb column. Never throws —
 * garbage, missing fields, or wrong types all fall back to EMPTY_TRIAGE_PREFS
 * defaults for that field. Keywords capped at 20, expandedTerms at 60 (a
 * runaway LLM expansion or a hand-edited row shouldn't blow up match cost).
 * `audiences` is filtered down to known AUDIENCES keys so a stale/garbage
 * value can't silently zero out every result (see matchesAudience).
 */
export function normalizeTriagePrefs(raw: unknown): TriagePrefs {
  if (!raw || typeof raw !== "object") return { ...EMPTY_TRIAGE_PREFS }
  const r = raw as Record<string, unknown>

  const audiences = toTrimmedLowerStrings(r.audiences, MAX_KEYWORDS).filter((a) => AUDIENCE_KEYS.has(a))

  return {
    keywords: toTrimmedLowerStrings(r.keywords, MAX_KEYWORDS),
    expand: r.expand === true,
    expandedTerms: toTrimmedLowerStrings(r.expandedTerms, MAX_EXPANDED_TERMS),
    expandedFor: typeof r.expandedFor === "string" ? r.expandedFor : "",
    audiences,
    priorityOnly: r.priorityOnly === true,
  }
}

// Lowercase + Unicode-normalize (NFD) + strip combining marks, so accented
// input matches its plain form either direction: "saqué" <-> "saque". Fanvue's
// customer base writes in English, Portuguese and Spanish — accents are common
// and a strict-diacritics match would silently miss half the hits.
const COMBINING_MARKS_RE = new RegExp("[\\u0300-\\u036f]", "g")

export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase()
}

/**
 * Which of `terms` appear (as a substring, after normalizeForMatch) anywhere
 * in the item's subject + snippet + tags. Empty `terms` means "no keyword
 * filter is active" — treated as match-all, so it returns [] (nothing to
 * report, not "zero hits"). Callers distinguish the two cases by checking
 * `terms.length` themselves (see filterAndRank).
 */
export function matchesKeywords(item: TriageItem, terms: string[]): string[] {
  if (terms.length === 0) return []
  const haystack = normalizeForMatch(
    [item.subject ?? "", item.snippet, item.tags.join(" ")].join(" ")
  )
  return terms.filter((term) => haystack.includes(normalizeForMatch(term)))
}

/**
 * True when `tags` belongs to any of the selected `audiences`. No audiences
 * selected = no filter = always true. Tag matching is substring-on-normalized
 * so "CREATOR_TAG" matches the "creator" audience.
 */
export function matchesAudience(tags: readonly string[] | null | undefined, audiences: string[]): boolean {
  if (audiences.length === 0) return true
  if (!tags || tags.length === 0) return false
  const normalizedTags = tags.map((t) => normalizeForMatch(t))
  return audiences.some((audience) => {
    const needles = AUDIENCES[audience] ?? []
    return needles.some((needle) => normalizedTags.some((tag) => tag.includes(needle)))
  })
}

// Cap on how much "still waiting" contributes to urgency, in minutes. Beyond
// this a ticket is already maximally stale for ranking purposes — a 4-day
// wait shouldn't outrank a 4-hour one by an ever-growing margin.
const WAITING_MINUTES_CAP = 240

/**
 * Deterministic urgency score, higher = more urgent. Formula:
 *   +3  sla_status is "missed" (breached — the strongest signal)
 *   +2  sla_status is "active" (clock still running, not yet breached)
 *   +2  Intercom's native priority flag is set
 *   +0..2  waiting time, linear up to WAITING_MINUTES_CAP (240 min) then flat
 *          — (min(waitingMinutes, 240) / 240) * 2; null waitingSince -> 0
 * Max score is 3 + 2 + 2 = 7 (missed SLA, priority, maxed-out wait).
 */
export function urgencyScore(item: TriageItem, nowMs: number): number {
  let score = 0
  if (item.slaStatus === "missed") score += 3
  else if (item.slaStatus === "active") score += 2
  if (item.priority) score += 2

  if (item.waitingSince) {
    const waitingMinutes = Math.max(0, (nowMs - Date.parse(item.waitingSince)) / 60_000)
    score += (Math.min(waitingMinutes, WAITING_MINUTES_CAP) / WAITING_MINUTES_CAP) * 2
  }

  return score
}

export type RankedTriageItem = {
  item: TriageItem
  matchedTerms: string[]
  urgency: number
}

// A missing timestamp sorts last within its tiebreak — treat it as "infinitely
// far away" rather than epoch-0, so nulls fall to the bottom of the ranking
// instead of jumping to the top.
function parseOrInfinity(iso: string | null): number {
  return iso ? Date.parse(iso) : Number.POSITIVE_INFINITY
}

// Ascending 3-way compare. Subtracting two Infinity values (both timestamps
// null) yields NaN, not 0 — a plain `a - b` comparator would return NaN and
// hand the sort an inconsistent tiebreak. Comparing directly sidesteps that.
function compareAsc(a: number, b: number): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Apply the agent's triage_prefs to the swept pool and rank what's left.
 * Filters (all AND'd together): priorityOnly, audience, keywords. Keywords
 * combine the literal `keywords` with the cached `expandedTerms` ONLY when
 * `expand` is true — a saved expansion sitting unused while `expand` is off
 * must not silently widen the filter.
 * Sort: urgency desc, then waitingSince asc (nulls last), then
 * conversationCreatedAt asc (nulls last) — most urgent and longest-waiting
 * first, oldest ticket breaking remaining ties.
 */
export function filterAndRank(
  items: TriageItem[],
  prefs: TriagePrefs,
  nowMs: number
): RankedTriageItem[] {
  const effectiveTerms = prefs.expand
    ? Array.from(new Set([...prefs.keywords, ...prefs.expandedTerms]))
    : prefs.keywords

  const ranked: RankedTriageItem[] = []
  for (const item of items) {
    if (prefs.priorityOnly && !item.priority) continue
    if (!matchesAudience(item.tags, prefs.audiences)) continue

    const matchedTerms = matchesKeywords(item, effectiveTerms)
    if (effectiveTerms.length > 0 && matchedTerms.length === 0) continue

    ranked.push({ item, matchedTerms, urgency: urgencyScore(item, nowMs) })
  }

  ranked.sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency
    const waitDiff = compareAsc(parseOrInfinity(a.item.waitingSince), parseOrInfinity(b.item.waitingSince))
    if (waitDiff !== 0) return waitDiff
    return compareAsc(
      parseOrInfinity(a.item.conversationCreatedAt),
      parseOrInfinity(b.item.conversationCreatedAt)
    )
  })

  return ranked
}
