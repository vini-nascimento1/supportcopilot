import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import type { RiskBand } from "@/lib/reply-queue"

// Persistence for the autonomous non-read reply queue (table `suggested_replies`,
// migration 0025/0026). The pipeline writes via the service role (no user session);
// the queue UI reads via the RLS-respecting auth client (owner rows + unassigned
// pool, per the table's policies). Draft-only: nothing is sent/assigned here
// without a human click in the API routes that call these helpers.
// See FanvueSupport/Engineering/Plan - Autonomous non-read reply queue.md.

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
  createdAt: string
}

async function getAuthClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll() {
          /* read-only */
        },
      },
    }
  )
}

// The non-read queue is the signed-in agent's PERSONAL worklist: only the
// conversations currently assigned to them in Intercom (owner_id = their agent
// id). RLS alone is too broad here — its "unassigned pool" policy would also
// surface every unassigned conversation in the whole workspace (hundreds of
// rows, the firehose), which buries the agent's own work. So we resolve the
// caller's agent id and filter to it explicitly. Newest first; the UI splits
// into bands and orders by SLA within each.
export async function getPendingQueue(): Promise<QueueItem[]> {
  const supabase = await getAuthClient()

  // RLS on `agents` returns only the caller's own row, so this resolves the
  // signed-in agent's id. No agent row (or no session) → empty queue.
  const { data: agent } = await supabase.from("agents").select("id").maybeSingle()
  const agentId = (agent?.id as string | undefined) ?? null
  if (!agentId) return []

  const { data } = await supabase
    .from("suggested_replies")
    .select(
      "id, intercom_conversation_id, owner_id, customer_name, subject, body, justification, sources, confidence, risk_band, created_at"
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
    createdAt: r.created_at as string,
  }))
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
