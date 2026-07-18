import "server-only"

// Service-role persistence for the triage pool (`triage_items`) and per-agent
// filter prefs (`agents.triage_prefs`). Style mirrors lib/reply-queue-store.ts:
// every function opens its own admin client and degrades to an empty/false
// result when Supabase isn't configured, rather than throwing. Read Intercom,
// write only our own tables — nothing here ever touches Intercom (ADR-0003/0007/0011).

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { normalizeTriagePrefs, type TriageItem, type TriagePrefs } from "./match"

// Shape of one row written by the sweep (lib/triage/sweep.ts), snake_case to
// match the `triage_items` columns directly — this is an upsert payload, not
// a read model (see TriageItem / listTriageItems for the read side).
export type TriageItemRow = {
  intercom_conversation_id: string
  subject: string | null
  customer_name: string | null
  snippet: string
  tags: string[]
  priority: boolean
  sla_status: string | null
  waiting_since: string | null
  conversation_created_at: string | null
  admin_assignee_id: string | null
  matched_playbook_id: string | null
  matched_playbook_name: string | null
  match_score: number | null
  capability_gap: boolean
  swept_at: string
}

type TriageItemDbRow = TriageItemRow

function rowToTriageItem(row: TriageItemDbRow): TriageItem {
  return {
    conversationId: row.intercom_conversation_id,
    subject: row.subject,
    customerName: row.customer_name,
    snippet: row.snippet ?? "",
    tags: row.tags ?? [],
    priority: row.priority ?? false,
    slaStatus: row.sla_status,
    waitingSince: row.waiting_since,
    conversationCreatedAt: row.conversation_created_at,
    matchedPlaybookId: row.matched_playbook_id,
    matchedPlaybookName: row.matched_playbook_name,
    matchScore: row.match_score,
    capabilityGap: row.capability_gap ?? false,
  }
}

export type ReplacePoolResult = { ok: boolean; error: string | null }

/**
 * Full-replace refresh of the triage pool for one sweep run: upsert every row
 * the sweep produced (onConflict intercom_conversation_id — a conversation
 * already in the pool just gets its fields refreshed), then delete any row
 * whose swept_at predates this sweep's start — i.e. it wasn't touched by the
 * upsert above, because it fell out of the pool (a human picked it up, it
 * closed, etc).
 *
 * The delete only runs if the upsert succeeds (or there was nothing to
 * upsert). If we deleted unconditionally, a failed/partial upsert would still
 * wipe out the previous sweep's rows, leaving the UI with a truncated or
 * empty pool instead of the last known-good one — so a bad run aborts before
 * the delete and the existing pool is left intact.
 */
export async function replaceTriagePool(
  rows: TriageItemRow[],
  sweepStartedIso: string
): Promise<ReplacePoolResult> {
  const db = getSupabaseAdminClient()
  if (!db) return { ok: false, error: "no admin client" }

  if (rows.length > 0) {
    const { error } = await db
      .from("triage_items")
      .upsert(rows, { onConflict: "intercom_conversation_id" })
    if (error) return { ok: false, error: error.message }
  }

  const { error: deleteError } = await db
    .from("triage_items")
    .delete()
    .lt("swept_at", sweepStartedIso)
  if (deleteError) return { ok: false, error: deleteError.message }

  return { ok: true, error: null }
}

/** Every row in the triage pool, mapped to the read model. Unfiltered — the
 *  caller (app/api/triage/route.ts) applies the agent's prefs via filterAndRank. */
export async function listTriageItems(): Promise<TriageItem[]> {
  const db = getSupabaseAdminClient()
  if (!db) return []

  const { data } = await db
    .from("triage_items")
    .select(
      "intercom_conversation_id, subject, customer_name, snippet, tags, priority, sla_status, waiting_since, conversation_created_at, matched_playbook_id, matched_playbook_name, match_score, capability_gap"
    )

  return ((data ?? []) as TriageItemDbRow[]).map(rowToTriageItem)
}

/** Most recent swept_at across the whole pool, or null when the pool is empty.
 *  Used by /api/triage to surface "last swept" and by /api/triage/run to
 *  rate-limit manual sweeps. */
export async function getLatestSweptAt(): Promise<string | null> {
  const db = getSupabaseAdminClient()
  if (!db) return null

  const { data } = await db
    .from("triage_items")
    .select("swept_at")
    .order("swept_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data?.swept_at as string | undefined) ?? null
}

export async function getTriagePrefs(agentId: string): Promise<TriagePrefs> {
  const db = getSupabaseAdminClient()
  if (!db) return normalizeTriagePrefs(null)

  const { data } = await db
    .from("agents")
    .select("triage_prefs")
    .eq("id", agentId)
    .maybeSingle()

  return normalizeTriagePrefs(data?.triage_prefs)
}

export async function saveTriagePrefs(agentId: string, prefs: TriagePrefs): Promise<boolean> {
  const db = getSupabaseAdminClient()
  if (!db) return false

  const { error } = await db
    .from("agents")
    .update({ triage_prefs: prefs })
    .eq("id", agentId)

  return !error
}
