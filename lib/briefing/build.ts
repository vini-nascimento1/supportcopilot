import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getAgentTokens } from "@/lib/auth"
import { collectIntercomItems } from "@/lib/briefing/sources/intercom"
import { collectCalendarItems } from "@/lib/briefing/sources/calendar"
import { collectGmailItems } from "@/lib/briefing/sources/gmail"
import { collectSlackItems, type SlackItemContext } from "@/lib/briefing/sources/slack"
import { researchSlackItems } from "@/lib/briefing/research"
import { generateNarrative } from "@/lib/briefing/narrative"
import {
  countBriefing,
  type AttentionItem,
  type AttentionSource,
  type Briefing,
  type SourceStatus,
} from "@/lib/briefing/types"

// Orchestrator for the Home briefing.
//
// Shape of a request: read the agent row → run the four sources in parallel,
// each in its own try/catch so one dead integration cannot empty the page →
// research at most three Slack questions → rank → narrate → cache.
//
// Deliberately NOT here:
//   • no cron. The cache is populated only by a signed-in request, so no server
//     process ever holds a user session outside a request (security checklist).
//   • no raw provider payload is persisted. Only normalized AttentionItems
//     reach `agents.briefing_cache`.
//   • no write to `agents.last_seen_at`. The Home page owns that clock and
//     calls markHomeSeen() below; if the build moved it, the first render would
//     consume its own window and every later digest would come back empty.

/** How long a cached briefing is served before it is rebuilt. */
export const BRIEFING_TTL_MS = 5 * 60 * 1000

/** Window a briefing covers when the agent has never been seen before. */
export const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * The window never shrinks below this, however recently Home was opened. A
 * mention from two hours ago that nobody handled is still "missed"; without a
 * floor, every visit would stamp last_seen_at and the very next build would
 * cover an empty window.
 */
export const MIN_LOOKBACK_MS = 8 * 60 * 60 * 1000

type AgentRow = {
  id: string
  intercom_admin_id: string | null
  slack_token: string | null
  slack_user_id: string | null
  timezone: string | null
  last_seen_at: string | null
  briefing_cache: unknown
  briefing_cached_at: string | null
}

/**
 * The digest window: since the agent last opened Home, floored at 8h and
 * capped at 24h. A first-ever visit or a bad timestamp gets the full 24h.
 */
export function computeSince(lastSeenAt: string | null, nowMs: number): string {
  const parsed = lastSeenAt ? Date.parse(lastSeenAt) : NaN
  if (!Number.isFinite(parsed) || parsed > nowMs) {
    return new Date(nowMs - DEFAULT_LOOKBACK_MS).toISOString()
  }
  // Never look back further than the default window — an agent returning from
  // two weeks off should get a briefing, not an archive — and never less than
  // the floor.
  const floored = Math.min(parsed, nowMs - MIN_LOOKBACK_MS)
  return new Date(Math.max(floored, nowMs - DEFAULT_LOOKBACK_MS)).toISOString()
}

const URGENCY_RANK: Record<AttentionItem["urgency"], number> = { now: 0, today: 1, later: 2 }

/**
 * Ranking: "now" first, then whatever is due or happened soonest. Pure and
 * stable, so the same briefing always renders in the same order.
 */
export function rankItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const urgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    if (urgency !== 0) return urgency

    const aKey = Date.parse(a.dueAt ?? a.occurredAt)
    const bKey = Date.parse(b.dueAt ?? b.occurredAt)
    const aValid = Number.isFinite(aKey)
    const bValid = Number.isFinite(bKey)
    if (aValid && bValid && aKey !== bKey) return aKey - bKey
    if (aValid !== bValid) return aValid ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function errorStatus(source: AttentionSource, message: string): SourceStatus {
  return { source, state: "error", message }
}

async function readAgentRow(email: string): Promise<AgentRow | null> {
  const db = getSupabaseAdminClient()
  if (!db) return null
  const { data } = await db
    .from("agents")
    .select(
      "id, intercom_admin_id, slack_token, slack_user_id, timezone, last_seen_at, briefing_cache, briefing_cached_at"
    )
    .eq("email", email)
    .maybeSingle()
  return (data as AgentRow | null) ?? null
}

function readCache(row: AgentRow, nowMs: number): Briefing | null {
  if (!row.briefing_cache || !row.briefing_cached_at) return null
  const cachedAt = Date.parse(row.briefing_cached_at)
  if (!Number.isFinite(cachedAt) || nowMs - cachedAt > BRIEFING_TTL_MS) return null
  const cached = row.briefing_cache as Partial<Briefing>
  if (!cached || !Array.isArray(cached.items) || typeof cached.narrative !== "string") return null
  return cached as Briefing
}

async function writeCache(email: string, briefing: Briefing): Promise<void> {
  const db = getSupabaseAdminClient()
  if (!db) return
  const { error } = await db
    .from("agents")
    .update({ briefing_cache: briefing, briefing_cached_at: briefing.generatedAt })
    .eq("email", email)
  if (error) console.warn(`[briefing] cache write failed: ${error.message}`)
}

/**
 * Stamp `agents.last_seen_at`. Called by the Home page on load (workstream C),
 * never by buildBriefing — see the note at the top of this file.
 */
export async function markHomeSeen(email: string): Promise<void> {
  const db = getSupabaseAdminClient()
  if (!db) return
  const { error } = await db
    .from("agents")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("email", email)
  if (error) console.warn(`[briefing] last_seen_at write failed: ${error.message}`)
}

export type BuildBriefingOptions = {
  /** Skip the cache read (POST /api/briefing/refresh). */
  force?: boolean
  /** Request origin — the Notion MCP token exchange needs it. */
  origin?: string
  /** Injectable for tests. */
  now?: number
}

export async function buildBriefing(
  email: string,
  opts: BuildBriefingOptions = {}
): Promise<Briefing> {
  const nowMs = opts.now ?? Date.now()
  const generatedAt = new Date(nowMs).toISOString()

  const row = await readAgentRow(email)
  if (!row) {
    return {
      generatedAt,
      since: computeSince(null, nowMs),
      narrative: "I couldn't load your profile, so there's nothing to brief you on yet.",
      narrativeSource: "fallback",
      counts: { now: 0, drafted: 0, researched: 0, locked: 0 },
      items: [],
      sources: [
        errorStatus("intercom", "No agent record found."),
        errorStatus("slack", "No agent record found."),
        errorStatus("gmail", "No agent record found."),
        errorStatus("calendar", "No agent record found."),
      ],
    }
  }

  if (!opts.force) {
    const cached = readCache(row, nowMs)
    if (cached) {
      console.log(`[briefing] cache hit agent=${row.id} items=${cached.items.length}`)
      return cached
    }
  }

  const since = computeSince(row.last_seen_at, nowMs)
  const sinceMs = Date.parse(since)
  const tokens = await getAgentTokens()
  const adminId = row.intercom_admin_id ?? process.env.INTERCOM_ADMIN_ID ?? null

  // Four independent network fan-outs; one failing must never take the page
  // down, so each resolves to its own SourceStatus instead of throwing.
  const [intercom, slack, gmail, calendar] = await Promise.all([
    collectIntercomItems({ agentId: row.id, adminId, nowMs }).catch(() => ({
      items: [] as AttentionItem[],
      status: errorStatus("intercom", "Couldn't load your ticket queue."),
    })),
    collectSlackItems({
      email,
      slackToken: row.slack_token,
      storedUserId: row.slack_user_id,
      sinceMs,
      nowMs,
    }).catch(() => ({
      items: [] as AttentionItem[],
      contexts: new Map<string, SlackItemContext>(),
      status: errorStatus("slack", "Couldn't read Slack."),
    })),
    collectGmailItems({
      googleToken: tokens.googleToken,
      email,
      sinceMs,
      nowMs,
    }).catch(() => ({
      items: [] as AttentionItem[],
      status: errorStatus("gmail", "Couldn't read your inbox."),
    })),
    collectCalendarItems({
      googleToken: tokens.googleToken,
      email,
      nowMs,
      timeZone: row.timezone,
    }).catch(() => ({
      items: [] as AttentionItem[],
      status: errorStatus("calendar", "Couldn't read your calendar."),
    })),
  ])

  // Research runs only over the Slack contexts, and only for messages that read
  // as a question to this agent (capped at 3 inside researchSlackItems).
  let prepared = new Map<string, AttentionItem["prepared"]>()
  try {
    prepared = await researchSlackItems({
      contexts: slack.contexts,
      email,
      origin: opts.origin ?? "",
    })
  } catch {
    // A failed research pass costs prepared answers, not the briefing.
  }

  const merged = [
    ...intercom.items,
    ...slack.items.map((item) => {
      const answer = prepared.get(item.id)
      return answer ? { ...item, prepared: answer } : item
    }),
    ...gmail.items,
    ...calendar.items,
  ]

  const items = rankItems(merged)
  const counts = countBriefing(items)
  const { narrative, narrativeSource } = await generateNarrative(items, counts).then((r) => ({
    narrative: r.narrative,
    narrativeSource: r.source,
  }))

  const briefing: Briefing = {
    generatedAt,
    since,
    narrative,
    narrativeSource,
    counts,
    items,
    sources: [intercom.status, slack.status, gmail.status, calendar.status],
  }

  // IDs and counts only — never a title, a body or a customer name.
  console.log(
    `[briefing] built agent=${row.id} items=${items.length} now=${counts.now} drafted=${counts.drafted} researched=${counts.researched} locked=${counts.locked} narrative=${narrativeSource}`
  )

  await writeCache(email, briefing).catch(() => {})
  return briefing
}
