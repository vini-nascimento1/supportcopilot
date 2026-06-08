import { type NextRequest } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getSignedInEmail } from "@/lib/auth"
import { getConversationDetail } from "@/lib/intercom"

export async function POST(req: NextRequest) {
  let body: { conversationId?: string; playbookId?: string; reason?: string }
  try {
    body = (await req.json()) as { conversationId?: string; playbookId?: string; reason?: string }
  } catch {
    return new Response("Invalid JSON body", { status: 400 })
  }

  const { conversationId, playbookId, reason } = body
  if (!conversationId || !playbookId) {
    return new Response("conversationId and playbookId are required", { status: 400 })
  }

  const email = await getSignedInEmail()
  if (!email) {
    return new Response("Authentication required", { status: 401 })
  }

  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    return new Response("Server configuration error", { status: 500 })
  }

  // Resolve case_id from conversation_id
  const { data: caseRow } = await supabase
    .from("cases")
    .select("id")
    .eq("intercom_conversation_id", conversationId)
    .maybeSingle()

  if (!caseRow) {
    return new Response("Case not found for this conversation", { status: 404 })
  }

  // Upsert: one dismissal per (case, playbook) — re-dismissing updates reason
  const { data: inserted, error } = await supabase
    .from("playbook_dismissals")
    .upsert(
      {
        case_id: caseRow.id,
        playbook_id: playbookId,
        reason: reason?.trim() ?? "",
      },
      {
        onConflict: "case_id,playbook_id",
        ignoreDuplicates: false,
      },
    )
    .select("id")
    .single()

  if (error) {
    console.error("Failed to save playbook dismissal:", error)
    return new Response("Failed to save", { status: 500 })
  }

  return Response.json({ id: inserted!.id })
}
