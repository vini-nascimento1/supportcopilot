import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export type DraftForConversation = {
  version: number
  replyBody: string
}

export async function getDraftForConversation(
  conversationId: string
): Promise<DraftForConversation | null> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return null

  const { data: caseRow } = await supabase
    .from("cases")
    .select("id")
    .eq("intercom_conversation_id", conversationId)
    .maybeSingle()

  if (!caseRow) return null

  const { data } = await supabase
    .from("drafts")
    .select("version, reply_body")
    .eq("case_id", caseRow.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  return { version: data.version, replyBody: data.reply_body }
}

export type SavedDraft = {
  id: string
  version: number
  replyBody: string
  nextSteps: string | null
  sources: string | null
  createdAt: string
  caseId: string
  intercomConversationId: string | null
  customerName: string | null
  caseStatus: string
}

export async function getSavedDrafts(): Promise<SavedDraft[]> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return []

  const { data } = await supabase
    .from("drafts")
    .select(
      `id, version, reply_body, next_steps, sources, created_at, case_id,
       cases ( intercom_conversation_id, customer_name, status )`
    )
    .order("created_at", { ascending: false })
    .limit(50)

  return (data ?? []).map((row) => {
    const c = Array.isArray(row.cases) ? row.cases[0] : row.cases
    return {
      id: row.id,
      version: row.version,
      replyBody: row.reply_body,
      nextSteps: row.next_steps,
      sources: row.sources,
      createdAt: row.created_at,
      caseId: row.case_id,
      intercomConversationId: c?.intercom_conversation_id ?? null,
      customerName: c?.customer_name ?? null,
      caseStatus: c?.status ?? "open",
    }
  })
}
