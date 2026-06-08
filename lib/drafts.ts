import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

// ── Persistence for explicit draft saving ──────────────────────────────────

export async function persistDraft(
  conversationId: string,
  customerName: string,
  playbookId: string | null,
  replyBody: string,
  email?: string | null,
): Promise<{ id: string; version: number } | null> {
  const supabase = getSupabaseAdminClient()
  if (!supabase || !replyBody.trim()) return null

  // Resolve agent id from email so RLS policies can enforce case ownership
  let ownerId: string | undefined
  if (email) {
    const { data: agent } = await supabase
      .from("agents")
      .select("id")
      .eq("email", email)
      .maybeSingle()
    if (agent) ownerId = agent.id
  }

  const { data: caseRow } = await supabase
    .from("cases")
    .upsert(
      {
        intercom_conversation_id: conversationId,
        customer_name: customerName,
        playbook_id: playbookId,
        owner_id: ownerId,
      },
      { onConflict: "intercom_conversation_id" },
    )
    .select("id")
    .single()

  if (!caseRow) return null

  const { data: latestVersion } = await supabase
    .from("drafts")
    .select("version")
    .eq("case_id", caseRow.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()

  const version = (latestVersion?.version ?? 0) + 1

  const { data: inserted } = await supabase
    .from("drafts")
    .insert({
      case_id: caseRow.id,
      version,
      reply_body: replyBody,
    })
    .select("id, version")
    .single()

  return inserted ?? null
}

async function getAuthClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll() { /* read-only */ },
      },
    }
  )
}

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
}

export async function getSavedDrafts(): Promise<SavedDraft[]> {
  const supabase = await getAuthClient()

  const { data } = await supabase
    .from("drafts")
    .select(
      `id, version, reply_body, next_steps, sources, created_at, case_id,
       cases ( intercom_conversation_id, customer_name )`
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
    }
  })
}
