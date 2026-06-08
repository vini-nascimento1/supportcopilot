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

  // Resolve case_id from conversation_id — upsert if missing
  let caseId: string
  const { data: existingCase } = await supabase
    .from("cases")
    .select("id")
    .eq("intercom_conversation_id", conversationId)
    .maybeSingle()

  if (existingCase) {
    caseId = existingCase.id
  } else {
    // Case doesn't exist yet (drafts are no longer auto-saved), fetch from Intercom
    const conversation = await getConversationDetail(conversationId)
    if (!conversation) {
      return new Response("Conversation not found in Intercom", { status: 404 })
    }

    // Resolve agent id from email for owner
    let ownerId: string | undefined
    const { data: agent } = await supabase
      .from("agents")
      .select("id")
      .eq("email", email)
      .maybeSingle()
    if (agent) ownerId = agent.id

    const { data: created } = await supabase
      .from("cases")
      .upsert(
        {
          intercom_conversation_id: conversationId,
          customer_name: conversation.customer,
          playbook_id: playbookId,
          owner_id: ownerId,
        },
        { onConflict: "intercom_conversation_id" },
      )
      .select("id")
      .single()

    if (!created) {
      return new Response("Failed to create case", { status: 500 })
    }
    caseId = created.id
  }

  // Upsert: one dismissal per (case, playbook) — re-dismissing updates reason
  const { data: inserted, error } = await supabase
    .from("playbook_dismissals")
    .upsert(
      {
        case_id: caseId,
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
