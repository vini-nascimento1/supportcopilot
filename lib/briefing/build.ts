import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getAgentTokens } from "@/lib/auth"
import { collectIntercomItems } from "@/lib/briefing/sources/intercom"
import { collectCalendarItems } from "@/lib/briefing/sources/calendar"
import { collectGmailItems } from "@/lib/briefing/sources/gmail"
import { collectSlackItems, type SlackItemContext } from "@/lib/briefing/sources/slack"
import { researchSlackItems } from "@/lib/briefing/research"
import { generateNarrative } from "@/lib/briefing/narrative"
import { buildFallbackNarrative } from "@/lib/briefing/narrative-fallback"
import { dismissItems, getDismissedIds } from "@/lib/briefing/dismissals"
import { detectReadItems } from "@/lib/briefing/read-signals"
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
// drop whatever the agent has already read in Slack/Gmail (read signals) →
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

/**
 * The window never shrinks below a full day, however recently Home was opened,
 * and a first-ever visit gets exactly this much.
 *
 * The floor used to be 8h, purely so that stamping last_seen_at on every visit
 * could not empty the next window. Dismissals now carry the "already handled"
 * state (see lib/briefing/dismissals.ts), so re-showing yesterday's mention
 * costs nothing: if the agent dealt with it, it is dismissed and filtered out.
 * That frees the floor to be a full day, which is what an agent coming in on a
 * Monday morning actually wants.
 */
export const MIN_LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * The window never stretches past a week. Home is meant to work as a wrap-up
 * after a weekend or a few days off, so a returning agent gets everything they
 * missed rather than the last day of it; beyond a week it would be an archive,
 * not a briefing, and the Slack/Gmail sources would be paging history.
 */
export const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

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
 * The digest window: since the agent last opened Home, floored at 24h and
 * capped at 7 days. A first-ever visit or a bad timestamp gets 24h.
 */
export function computeSince(lastSeenAt: string | null, nowMs: number): string {
  const parsed = lastSeenAt ? Date.parse(lastSeenAt) : NaN
  if (!Number.isFinite(parsed) || parsed > nowMs) {
    return new Date(nowMs - MIN_LOOKBACK_MS).toISOString()
  }
  // Never less than the floor, and never further back than a week — an agent
  // returning from a fortnight off should get a briefing, not an archive.
  const floored = Math.min(parsed, nowMs - MIN_LOOKBACK_MS)
  return new Date(Math.max(floored, nowMs - MAX_LOOKBACK_MS)).toISOString()
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

/**
 * Remove everything the agent has already handled, and keep the hero honest
 * about what is left.
 *
 * Applied at READ time — after the cache, on both the cache-hit and the
 * freshly-built path — so a dismissal takes effect on the very next load
 * instead of waiting out the 5-minute TTL. The cached copy stays complete,
 * which is what makes Undo work: restoring a row is a delete in
 * briefing_dismissals, no rebuild.
 *
 * Narrative rule: the model narrative describes a set of items. The moment one
 * of them is filtered out it can no longer be trusted to agree with the list or
 * the tiles ("3 replies are drafted" over a list of one), and re-running the
 * model on every load would defeat the cache. So if anything was removed we
 * recompute counts AND swap in the deterministic sentence, which is built from
 * the surviving items alone. If nothing was removed the briefing is returned
 * untouched, model narrative and all.
 */
export function applyDismissals(
  briefing: Briefing,
  dismissed: ReadonlySet<string>
): Briefing {
  if (dismissed.size === 0) return briefing
  const items = briefing.items.filter((item) => !dismissed.has(item.id))
  if (items.length === briefing.items.length) return briefing

  const counts = countBriefing(items)
  return {
    ...briefing,
    items,
    counts,
    narrative: buildFallbackNarrative(items, counts),
    narrativeSource: "fallback",
  }
}

/** Dismissals and read signals hide an item the same way; callers see one set. */
function unionIds(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  const out = new Set(a)
  for (const id of b) out.add(id)
  return out
}

/**
 * Ask Slack and Gmail which of these items the agent has already read outside
 * the app, and record the answer as a dismissal with reason "read".
 *
 * Best effort in every direction: a failed check, a slow check or a failed
 * write all resolve to "nothing was read", which costs a stale row on the page
 * and never the page itself. Counts only in the log — no ids, no titles.
 */
async function markReadItems(
  row: AgentRow,
  email: string,
  candidates: AttentionItem[],
  googleToken: string | null
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set()

  let read: Set<string>
  try {
    read = await detectReadItems(candidates, {
      slackToken: row.slack_token,
      googleToken,
      email,
    })
  } catch {
    return new Set()
  }

  console.log(
    `[briefing] read-signals agent=${row.id} checked=${candidates.length} read=${read.size}`
  )
  if (read.size > 0) {
    await dismissItems(row.id, [...read], { reason: "read" }).catch(() => {})
  }
  return read
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
 * Drop the cached briefing so the next Home load rebuilds it. Called when an
 * integration is connected or disconnected: the cached copy still carries the
 * old SourceStatus ("Connect Slack to see mentions here") for up to
 * BRIEFING_TTL_MS otherwise, which reads as the connection having failed.
 */
export async function invalidateBriefingCache(email: string): Promise<void> {
  const db = getSupabaseAdminClient()
  if (!db) return
  const { error } = await db
    .from("agents")
    .update({ briefing_cache: null, briefing_cached_at: null })
    .eq("email", email)
  if (error) console.warn(`[briefing] cache invalidate failed: ${error.message}`)
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

  // Read once and apply on both paths below: the cache holds the complete
  // briefing, the agent sees it minus whatever they already handled.
  const dismissed = await getDismissedIds(row.id, nowMs).catch(() => new Set<string>())

  if (!opts.force) {
    const cached = readCache(row, nowMs)
    if (cached) {
      // A cache hit still checks read signals: the agent may have answered the
      // mention in Slack itself two minutes ago, and waiting out the TTL to
      // notice would make Home look stale exactly when it matters.
      const candidates = cached.items.filter(
        (item) => !dismissed.has(item.id) && Boolean(item.readSignal)
      )
      let googleToken: string | null = null
      if (candidates.length > 0) {
        try {
          googleToken = (await getAgentTokens()).googleToken
        } catch {
          googleToken = null
        }
      }
      const read = await markReadItems(row, email, candidates, googleToken)
      console.log(
        `[briefing] cache hit agent=${row.id} items=${cached.items.length} dismissed=${dismissed.size}`
      )
      return applyDismissals(cached, unionIds(dismissed, read))
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

  // Anything the agent already read in Slack or Gmail drops out here, BEFORE
  // research, ranking and the narrative: no point researching an answer to a
  // question that has been dealt with, and the model must describe the list the
  // agent will actually see. Unlike a dismissal this is not undoable — the
  // signal came from the source, not from a click — so the cached copy
  // legitimately omits these items too.
  const collected = [...intercom.items, ...slack.items, ...gmail.items, ...calendar.items]
  const readCandidates = collected.filter(
    (item) => !dismissed.has(item.id) && Boolean(item.readSignal)
  )
  const read = await markReadItems(row, email, readCandidates, tokens.googleToken)

  // Research runs only over the Slack contexts, and only for messages that read
  // as a question to this agent (capped at 3 inside researchSlackItems).
  const contexts =
    read.size > 0
      ? new Map([...slack.contexts].filter(([id]) => !read.has(id)))
      : slack.contexts
  let prepared = new Map<string, AttentionItem["prepared"]>()
  try {
    prepared = await researchSlackItems({
      contexts,
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
  ].filter((item) => !read.has(item.id))

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
    `[briefing] built agent=${row.id} items=${items.length} now=${counts.now} drafted=${counts.drafted} researched=${counts.researched} locked=${counts.locked} dismissed=${dismissed.size} narrative=${narrativeSource}`
  )

  // Cache the complete briefing, hand back the filtered one.
  await writeCache(email, briefing).catch(() => {})
  return applyDismissals(briefing, dismissed)
}
