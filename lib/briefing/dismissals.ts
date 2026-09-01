import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

// Per-agent "I have already handled this" state for the Home briefing.
//
// The briefing itself is rebuilt from live sources every 5 minutes, so a
// mention the agent already answered would keep coming back forever. A
// dismissal is the only piece of per-item state Home keeps: an (agent, item id)
// pair, no title, no body, no counterparty. It is applied at READ time (see
// lib/briefing/build.ts::applyDismissals) so it takes effect on the very next
// load, without waiting for the cache to expire.
//
// Service-role only, exactly like the rest of lib/briefing — RLS is on and no
// browser client ever touches this table. Logs carry the agent id and counts,
// never an item id's payload.

/** Rows older than this are pruned; item ids stop matching long before then. */
export const DISMISSAL_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

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

/**
 * Validate a request body's `ids`. Pure, so the route stays a thin shell and
 * the rules are testable: an array of 1..200 prefixed strings, deduplicated.
 */
export function parseItemIds(input: unknown): ParsedIds {
  const ids = (input as { ids?: unknown } | null | undefined)?.ids
  if (!Array.isArray(ids)) return { ok: false, error: "Expected an array of item ids." }
  if (ids.length === 0) return { ok: false, error: "No item ids given." }
  if (ids.length > MAX_DISMISS_IDS) {
    return { ok: false, error: `At most ${MAX_DISMISS_IDS} item ids per request.` }
  }
  if (!ids.every(isValidItemId)) return { ok: false, error: "One or more item ids are invalid." }
  return { ok: true, ids: [...new Set(ids as string[])] }
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
 * Every item id this agent has already dismissed or acted on. Never throws:
 * with no database the caller simply sees an unfiltered briefing.
 */
export async function getDismissedIds(agentId: string, nowMs = Date.now()): Promise<Set<string>> {
  const db = getSupabaseAdminClient()
  if (!db) return new Set()

  try {
    const [, read] = await Promise.all([
      pruneOldDismissals(db, agentId, nowMs).catch(() => {}),
      db.from("briefing_dismissals").select("item_id").eq("agent_id", agentId),
    ])
    if (read.error) {
      console.warn(`[briefing] dismissal read failed agent=${agentId}`)
      return new Set()
    }
    const rows = (read.data ?? []) as Array<{ item_id?: string | null }>
    return new Set(rows.map((r) => r.item_id ?? "").filter(Boolean))
  } catch {
    return new Set()
  }
}

/** Mark items handled. Idempotent — re-dismissing an id is a no-op upsert. */
export async function dismissItems(agentId: string, ids: string[]): Promise<number> {
  const db = getSupabaseAdminClient()
  if (!db || ids.length === 0) return 0

  const rows = ids.map((item_id) => ({
    agent_id: agentId,
    item_id,
    dismissed_at: new Date().toISOString(),
  }))
  const { error } = await db
    .from("briefing_dismissals")
    .upsert(rows, { onConflict: "agent_id,item_id" })
  if (error) {
    console.warn(`[briefing] dismiss write failed agent=${agentId} count=${ids.length}`)
    throw new Error("dismiss_failed")
  }
  console.log(`[briefing] dismissed agent=${agentId} count=${ids.length}`)
  return ids.length
}

/** Undo: bring the rows back into the next briefing. */
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
