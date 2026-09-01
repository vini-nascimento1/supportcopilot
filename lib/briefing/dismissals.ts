import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

// Per-agent "I have already handled this" state for the Home briefing.
//
// The briefing itself is rebuilt from live sources every 5 minutes, so a
// mention the agent already answered would keep coming back forever. A
// dismissal is the only piece of per-item state Home keeps: an (agent, item id)
// pair plus why and, for a snooze, until when — no title, no body, no
// counterparty. It is applied at READ time (see
// lib/briefing/build.ts::applyDismissals) so it takes effect on the very next
// load, without waiting for the cache to expire.
//
// Four reasons, and the difference matters:
//   • manual — the agent hit Dismiss. Permanent until they undo it.
//   • acted  — the agent replied/sent from Home, so the item is done.
//   • read   — lib/briefing/read-signals.ts saw the agent read it in Slack or
//              Gmail itself. Written by the server, never accepted from a client.
//   • snooze — hidden only until `snoozed_until`, then it comes back on its own.
//
// Service-role only, exactly like the rest of lib/briefing — RLS is on and no
// browser client ever touches this table. Logs carry the agent id, a count and
// the reason, never an item id's payload.

/** Rows older than this are pruned; item ids stop matching long before then. */
export const DISMISSAL_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

/** Furthest ahead a snooze may reach — beyond this it is really a dismissal. */
export const MAX_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

/** Why an item is hidden. Mirrors the `reason` check constraint on the table. */
export type DismissReason = "manual" | "acted" | "read" | "snooze"

/** The reasons a client is allowed to ask for. "read" is server-only; "snooze" is implied by `until`. */
const CLIENT_REASONS: readonly DismissReason[] = ["manual", "acted"]

/** Most ids one request may dismiss or restore. */
export const MAX_DISMISS_IDS = 200

/** Longest accepted item id. AttentionItem ids are far shorter than this. */
export const MAX_ITEM_ID_CHARS = 200

/** Item ids are minted by lib/briefing/sources/*, and always carry a prefix. */
export const ITEM_ID_PREFIX = /^(intercom|slack|gmail|calendar):/

export function isValidItemId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ITEM_ID_CHARS &&
    ITEM_ID_PREFIX.test(value)
  )
}

export type ParsedIds = { ok: true; ids: string[] } | { ok: false; error: string }

export type ParsedDismiss =
  | { ok: true; ids: string[]; reason: DismissReason; until?: string }
  | { ok: false; error: string }

/**
 * Validate a dismiss request body. Pure, so the route stays a thin shell and
 * the rules are testable:
 *
 *   ids    — an array of 1..200 prefixed strings, deduplicated.
 *   reason — optional, and only "manual" or "acted". "read" is written by the
 *            server from a real Slack/Gmail signal and "snooze" follows from
 *            `until`, so neither is ever taken on a client's word.
 *   until  — optional ISO timestamp, strictly in the future and at most 14 days
 *            out, normalised to ISO. Its presence makes the reason "snooze".
 */
export function parseDismissBody(input: unknown, nowMs: number): ParsedDismiss {
  const body = (input ?? {}) as { ids?: unknown; reason?: unknown; until?: unknown }

  const ids = body.ids
  if (!Array.isArray(ids)) return { ok: false, error: "Expected an array of item ids." }
  if (ids.length === 0) return { ok: false, error: "No item ids given." }
  if (ids.length > MAX_DISMISS_IDS) {
    return { ok: false, error: `At most ${MAX_DISMISS_IDS} item ids per request.` }
  }
  if (!ids.every(isValidItemId)) return { ok: false, error: "One or more item ids are invalid." }
  const unique = [...new Set(ids as string[])]

  let reason: DismissReason = "manual"
  if (body.reason !== undefined) {
    if (
      typeof body.reason !== "string" ||
      !CLIENT_REASONS.includes(body.reason as DismissReason)
    ) {
      return { ok: false, error: "Unknown dismiss reason." }
    }
    reason = body.reason as DismissReason
  }

  if (body.until === undefined) return { ok: true, ids: unique, reason }

  if (typeof body.until !== "string") {
    return { ok: false, error: "Snooze time must be an ISO timestamp." }
  }
  const untilMs = Date.parse(body.until)
  if (!Number.isFinite(untilMs)) {
    return { ok: false, error: "Snooze time must be an ISO timestamp." }
  }
  if (untilMs <= nowMs) return { ok: false, error: "Snooze time must be in the future." }
  if (untilMs > nowMs + MAX_SNOOZE_MS) {
    return { ok: false, error: "Snooze time is too far ahead." }
  }
  return { ok: true, ids: unique, reason: "snooze", until: new Date(untilMs).toISOString() }
}

/**
 * The `ids`-only view of the same rules, for callers (DELETE, older code) that
 * neither send nor care about a reason.
 */
export function parseItemIds(input: unknown): ParsedIds {
  const parsed = parseDismissBody(input, Date.now())
  return parsed.ok ? { ok: true, ids: parsed.ids } : parsed
}

/** The signed-in agent's row id, resolved from the session email only. */
export async function resolveAgentId(email: string): Promise<string | null> {
  const db = getSupabaseAdminClient()
  if (!db) return null
  const { data } = await db.from("agents").select("id").eq("email", email).maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

/**
 * Drop rows past the retention window. Best effort in every sense: it shares
 * the round trip with the read below and a failure is swallowed, because a
 * missed prune costs a few dead rows and a thrown prune would cost the agent
 * their whole briefing.
 */
async function pruneOldDismissals(
  db: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  agentId: string,
  nowMs: number
): Promise<void> {
  const cutoff = new Date(nowMs - DISMISSAL_RETENTION_MS).toISOString()
  const { error } = await db
    .from("briefing_dismissals")
    .delete()
    .eq("agent_id", agentId)
    .lt("dismissed_at", cutoff)
  if (error) console.warn(`[briefing] dismissal prune failed agent=${agentId}`)
}

/**
 * Every item id this agent has hidden and that is still hidden right now.
 *
 * A snoozed row stops counting the moment `snoozed_until` passes — that is the
 * whole point of a snooze, so the item returns on its own without anyone
 * deleting the row. Never throws: with no database the caller simply sees an
 * unfiltered briefing.
 */
export async function getDismissedIds(agentId: string, nowMs = Date.now()): Promise<Set<string>> {
  const db = getSupabaseAdminClient()
  if (!db) return new Set()

  try {
    const [, read] = await Promise.all([
      pruneOldDismissals(db, agentId, nowMs).catch(() => {}),
      db.from("briefing_dismissals").select("item_id, snoozed_until").eq("agent_id", agentId),
    ])
    if (read.error) {
      console.warn(`[briefing] dismissal read failed agent=${agentId}`)
      return new Set()
    }
    const rows = (read.data ?? []) as Array<{
      item_id?: string | null
      snoozed_until?: string | null
    }>
    const live = new Set<string>()
    for (const row of rows) {
      if (!row.item_id) continue
      if (row.snoozed_until) {
        const untilMs = Date.parse(row.snoozed_until)
        // An unparseable timestamp is treated as "still hidden": a broken row
        // must not resurrect an item the agent explicitly put away.
        if (Number.isFinite(untilMs) && untilMs <= nowMs) continue
      }
      live.add(row.item_id)
    }
    return live
  } catch {
    return new Set()
  }
}

/**
 * Mark items handled. Idempotent — re-dismissing an id is a no-op upsert.
 *
 * `snoozed_until` is always written, never omitted: dismissing an item that was
 * previously snoozed has to clear the old wake-up time, otherwise the item
 * would come back after a dismissal the agent meant to be final.
 */
export async function dismissItems(
  agentId: string,
  ids: string[],
  opts: { reason?: DismissReason; until?: string } = {}
): Promise<number> {
  const db = getSupabaseAdminClient()
  if (!db || ids.length === 0) return 0

  const snoozedUntil = opts.until ?? null
  const reason: DismissReason = snoozedUntil ? "snooze" : (opts.reason ?? "manual")
  const rows = ids.map((item_id) => ({
    agent_id: agentId,
    item_id,
    dismissed_at: new Date().toISOString(),
    reason,
    snoozed_until: snoozedUntil,
  }))
  const { error } = await db
    .from("briefing_dismissals")
    .upsert(rows, { onConflict: "agent_id,item_id" })
  if (error) {
    console.warn(
      `[briefing] dismiss write failed agent=${agentId} count=${ids.length} reason=${reason}`
    )
    throw new Error("dismiss_failed")
  }
  console.log(`[briefing] dismissed agent=${agentId} count=${ids.length} reason=${reason}`)
  return ids.length
}

/** Undo: bring the rows back into the next briefing, whatever hid them. */
export async function undismissItems(agentId: string, ids: string[]): Promise<number> {
  const db = getSupabaseAdminClient()
  if (!db || ids.length === 0) return 0

  const { error } = await db
    .from("briefing_dismissals")
    .delete()
    .eq("agent_id", agentId)
    .in("item_id", ids)
  if (error) {
    console.warn(`[briefing] undismiss failed agent=${agentId} count=${ids.length}`)
    throw new Error("undismiss_failed")
  }
  console.log(`[briefing] undismissed agent=${agentId} count=${ids.length}`)
  return ids.length
}
