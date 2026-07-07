import { type NextRequest, NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { mdToHtml } from "@/lib/md-to-html"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
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

  const { data: agent } = await supabase
    .from("agents")
    .select("intercom_admin_id")
    .eq("email", email)
    .maybeSingle()

  const adminId = agent?.intercom_admin_id ?? process.env.INTERCOM_ADMIN_ID
  if (!adminId) {
    return errorResponse("No Intercom admin ID found for your account", 400)
  }

  const htmlBody = html ? body : mdToHtml(body)
  const replyPayload = buildIntercomReplyPayload({
    adminId: String(adminId),
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
