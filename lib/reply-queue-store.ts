import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import type { RiskBand } from "@/lib/reply-queue"

// Persistence for the autonomous non-read reply queue (table `suggested_replies`,
// migration 0025/0026). The pipeline writes via the service role (no user session);
// the queue route reads via the service role too, filtered by owner. The route is
// the authority on which rows to show — it reconciles these cached suggestions
// against the live Intercom non-read set (see /api/reply-queue). Draft-only:
// nothing is sent/assigned here without a human click in the API routes that call
// these helpers. See FanvueSupport/Engineering/Plan - Autonomous non-read reply queue.md.

export type SuggestionSource = { title?: string; url?: string; kind?: string }

export type PersistSuggestionInput = {
  intercomConversationId: string
  ownerId: string | null // null = unassigned pool (cheap precompute)
  customerName: string | null
  subject: string | null
  body: string
  justification: string
  sources: SuggestionSource[]
  confidence: number | null
  gateReason: string | null
  riskBand: RiskBand
  // True = generated on demand by the agent from the Inbox ("Generate" /
  // "Generate all"). On-request drafts are durable — the non-read reconciliation
  // never stales them. Defaults to false (the always-on pipeline path).
  onRequest?: boolean
}

// Replace the live suggestion for a conversation: supersede any existing pending
// row, then insert the fresh one. The partial unique index
// (suggested_replies_one_pending_per_conversation) guarantees a single pending
// row per conversation; on a lost race the second insert simply fails and the
// other process's suggestion wins. Service-role write.
export async function upsertPendingSuggestion(
  input: PersistSuggestionInput
): Promise<{ id: string } | null> {
  const db = getSupabaseAdminClient()
  if (!db) return null

  const { data: existing } = await db
    .from("suggested_replies")
    .select("id")
    .eq("intercom_conversation_id", input.intercomConversationId)
    .eq("status", "pending")
    .maybeSingle()

  if (existing) {
    await db.from("suggested_replies").update({ status: "superseded" }).eq("id", existing.id)
  }

  const { data: inserted, error } = await db
    .from("suggested_replies")
    .insert({
      intercom_conversation_id: input.intercomConversationId,
      owner_id: input.ownerId,
      customer_name: input.customerName,
      subject: input.subject,
      body: input.body,
      justification: input.justification,
      sources: input.sources,
      confidence: input.confidence,
      gate_reason: input.gateReason,
      risk_band: input.riskBand,
      on_request: input.onRequest ?? false,
      status: "pending",
      supersedes: existing?.id ?? null,
    })
    .select("id")
    .maybeSingle()

  if (error) return null
  return inserted ?? null
}

// An agent answered the conversation, so its suggestion leaves the queue.
// 'approved' = sent via our flow; 'stale' = the thread moved on otherwise.
export async function resolveSuggestionOnReply(
  conversationId: string,
  outcome: "approved" | "stale" = "stale"
): Promise<void> {
  const db = getSupabaseAdminClient()
  if (!db) return
  await db
    .from("suggested_replies")
    .update({ status: outcome })
    .eq("intercom_conversation_id", conversationId)
    .eq("status", "pending")
}

// Claim an unassigned conversation's live suggestion for an agent. The caller
// (the assign endpoint) has already performed the human-gated Intercom
// assignment write and resolved the agent id. Only flips a row that is still
// unassigned (owner_id is null), so two agents can't both claim it.
export async function assignSuggestion(
  conversationId: string,
  ownerId: string
): Promise<{ id: string } | null> {
  const db = getSupabaseAdminClient()
  if (!db) return null
  const { data } = await db
    .from("suggested_replies")
    .update({ owner_id: ownerId })
    .eq("intercom_conversation_id", conversationId)
    .eq("status", "pending")
    .is("owner_id", null)
    .select("id")
    .maybeSingle()
  return data ?? null
}

export type QueueItem = {
  id: string
  intercomConversationId: string
  ownerId: string | null
  customerName: string | null
  subject: string | null
  body: string
  justification: string
  sources: SuggestionSource[]
  confidence: number | null
  riskBand: RiskBand
  onRequest: boolean
  createdAt: string
}

// The signed-in agent's pending suggestions (owner-scoped). This is the cached
// draft layer; the route filters these against the live Intercom non-read set
// before showing them, so a conversation the agent has already answered drops
// out even if its row wasn't resolved by a webhook. Newest first.
export async function getPendingSuggestionsForAgent(agentId: string): Promise<QueueItem[]> {
  const db = getSupabaseAdminClient()
  if (!db) return []

  const { data } = await db
    .from("suggested_replies")
    .select(
      "id, intercom_conversation_id, owner_id, customer_name, subject, body, justification, sources, confidence, risk_band, on_request, created_at"
    )
    .eq("status", "pending")
    .eq("owner_id", agentId)
    .order("created_at", { ascending: false })
    .limit(200)

  return (data ?? []).map((r) => ({
    id: r.id as string,
    intercomConversationId: r.intercom_conversation_id as string,
    ownerId: (r.owner_id as string | null) ?? null,
    customerName: (r.customer_name as string | null) ?? null,
    subject: (r.subject as string | null) ?? null,
    body: (r.body as string) ?? "",
    justification: (r.justification as string) ?? "",
    sources: (r.sources as SuggestionSource[] | null) ?? [],
    confidence: (r.confidence as number | null) ?? null,
    riskBand: r.risk_band as RiskBand,
    onRequest: (r.on_request as boolean | null) ?? false,
    createdAt: r.created_at as string,
  }))
}

export type PendingSuggestionForConversation = {
  id: string
  body: string
  justification: string
  sources: SuggestionSource[]
  riskBand: RiskBand
}

// The pending suggestion for a single conversation, owner-scoped to the signed-in
// agent (same scoping as getPendingSuggestionsForAgent). Used by the unified
// conversation card to prefill the composer from the queued draft. Returns null
// when there is no pending row for this agent + conversation. Service role.
export async function getPendingSuggestionForConversation(
  conversationId: string,
  agentId: string
): Promise<PendingSuggestionForConversation | null> {
  const db = getSupabaseAdminClient()
  if (!db) return null

  const { data } = await db
    .from("suggested_replies")
    .select("id, body, justification, sources, risk_band")
    .eq("intercom_conversation_id", conversationId)
    .eq("status", "pending")
    .eq("owner_id", agentId)
    .maybeSingle()

  if (!data) return null

  return {
    id: data.id as string,
    body: (data.body as string) ?? "",
    justification: (data.justification as string) ?? "",
    sources: (data.sources as SuggestionSource[] | null) ?? [],
    riskBand: data.risk_band as RiskBand,
  }
}

// Resolve the agent's pending suggestions for conversations that are no longer
// non-read (the agent replied / it closed): flip them to 'stale' so they leave
// the queue and the table stays honest. Idempotent; owner-scoped. Service role.
export async function markSuggestionsStaleByConversations(
  agentId: string,
  conversationIds: string[]
): Promise<void> {
  if (conversationIds.length === 0) return
  const db = getSupabaseAdminClient()
  if (!db) return
  await db
    .from("suggested_replies")
    .update({ status: "stale" })
    .eq("status", "pending")
    .eq("owner_id", agentId)
    .in("intercom_conversation_id", conversationIds)
}

// Conversation ids (from the given set) that already have ANY suggestion row
// created at/after `sinceIso`, regardless of status. The backfill uses this to
// avoid recomputing a draft for a conversation we attempted recently — bounding
// repeated LLM work to once per window even if generation keeps yielding nothing.
export async function getRecentlyTouchedConversationIds(
  conversationIds: string[],
  sinceIso: string
): Promise<Set<string>> {
  if (conversationIds.length === 0) return new Set()
  const db = getSupabaseAdminClient()
  if (!db) return new Set()
  const { data } = await db
    .from("suggested_replies")
    .select("intercom_conversation_id")
    .in("intercom_conversation_id", conversationIds)
    .gte("created_at", sinceIso)
  return new Set((data ?? []).map((r) => r.intercom_conversation_id as string))
}

export type ReplyQueueAction = "approve" | "reject" | "edit"

export type ReplyQueueMetrics = {
  approved: number
  edited: number
  rejected: number
}

export async function getReplyQueueMetrics(args: {
  agentId: string
  startIso: string
  endIso: string
}): Promise<ReplyQueueMetrics> {
  const db = getSupabaseAdminClient()
  if (!db) return { approved: 0, edited: 0, rejected: 0 }

  const { data: rows } = await db
    .from("suggested_replies")
    .select("status")
    .eq("owner_id", args.agentId)
    .gte("updated_at", args.startIso)
    .lte("updated_at", args.endIso)

  if (!rows) return { approved: 0, edited: 0, rejected: 0 }

  return {
    approved: rows.filter((r) => r.status === "approved").length,
    edited: rows.filter((r) => r.status === "superseded").length,
    rejected: rows.filter((r) => r.status === "stale").length,
  }
}

export async function logReplyQueueEvent(input: {
  action: ReplyQueueAction
  agentId: string
  suggestionId?: string
  conversationId: string
  bodyChanged?: boolean
}): Promise<void> {
  // Insert into a metrics / audit table. Currently a no-op placeholder — the
  // Phase 6 tracker writes to a separate table when that table is created.
  // See docs/superpowers/plans/2026-06-20-autonomous-non-read-reply-queue.md §6.
  void input // placeholder
}
