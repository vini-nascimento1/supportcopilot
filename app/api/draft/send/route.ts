import { type NextRequest, NextResponse } from "next/server"

import { getSignedInEmail, resolveIntercomAdminId } from "@/lib/auth"
import { mdToHtml } from "@/lib/md-to-html"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getPendingSuggestionForConversation } from "@/lib/reply-queue-store"
import { sendIntercomReply } from "./intercom-reply"
import { buildIntercomReplyPayload } from "./payload"

const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN

export const dynamic = "force-dynamic"
export const maxDuration = 30

type SendDraftPayload = {
  conversationId?: string
  body?: string
  /** When true, body is already HTML (e.g. an Intercom macro), so send as-is. */
  html?: boolean
  attachmentFiles?: { name: string; contentType: string; data: string }[]
  // Set once the agent has clicked through the "needs your check" two-step
  // confirm (queue-panel.tsx QueueRow / use-reply-composer.ts). Required below
  // when the conversation has a pending needs_check suggestion — see the gate.
  needsCheckConfirmed?: boolean
}

export async function POST(req: NextRequest) {
  const email = await getSignedInEmail()
  if (!email) {
    return errorResponse("Unauthorized", 401)
  }

  let payload: SendDraftPayload
  try {
    payload = (await req.json()) as SendDraftPayload
  } catch {
    return errorResponse("Invalid JSON", 400)
  }

  const { conversationId, body = "", html, attachmentFiles } = payload
  if (!conversationId || (!body && !(attachmentFiles && attachmentFiles.length))) {
    return errorResponse("Missing conversationId or body", 400)
  }

  const supabase = getSupabaseAdminClient()
  if (!supabase || !INTERCOM_TOKEN) {
    return errorResponse("Server misconfigured", 500)
  }

  const adminId = await resolveIntercomAdminId(email)
  if (!adminId) {
    return errorResponse("No Intercom admin ID found for your account", 400)
  }

  // Server-side mirror of the client's "needs your check" lock: a pending
  // suggestion flagged needs_check must not go out until the agent has
  // confirmed the fadmin check, no matter which UI sends it — the client-only
  // gate was bypassable (e.g. the "On request" bulk send skipped it entirely).
  // Conversations with no pending needs_check suggestion for this agent (a
  // freehand reply, a macro, an already-resolved draft) are unaffected.
  const { data: agentRow } = await supabase
    .from("agents")
    .select("id")
    .eq("email", email)
    .maybeSingle()
  const agentId = (agentRow?.id as string | undefined) ?? null
  if (agentId) {
    const pending = await getPendingSuggestionForConversation(conversationId, agentId)
    if (pending?.riskBand === "needs_check" && !payload.needsCheckConfirmed) {
      return errorResponse(
        "Locked pending a fadmin check (payout/KYC/media). Open the draft and confirm to send.",
        409
      )
    }
  }

  const htmlBody = html ? body : mdToHtml(body)
  const replyPayload = buildIntercomReplyPayload({
    adminId,
    htmlBody,
    attachmentFiles,
  })

  const result = await sendIntercomReply({
    token: INTERCOM_TOKEN,
    conversationId,
    payload: replyPayload,
  })

  if (!result.ok) {
    console.error("Intercom reply failed:", {
      conversationId,
      status: result.status,
      attempts: result.attempts,
      error: result.error,
    })
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        intercomStatus: result.status,
        attempts: result.attempts,
      },
      { status: result.clientStatus }
    )
  }

  return NextResponse.json({
    ok: true,
    intercomStatus: result.status,
    attempts: result.attempts,
    confirmedBy: result.confirmedBy,
  })
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status })
}
