import { NextResponse } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getAgentTokens } from "@/lib/auth"
import { isGmailTemplateUser } from "@/lib/gmail-templates-auth"
import { sendGmailMessage } from "@/lib/gmail-client"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const tokens = await getAgentTokens()
  if (!isGmailTemplateUser(tokens.email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }
  if (!tokens.googleToken) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 401 })
  }

  const body = (await request.json()) as {
    templateId: string
    templateName: string
    recipient: string
    cc?: string
    userEmail: string
    subject: string
    body: string
    visibility: string
  }

  if (!body.recipient || !body.subject || !body.body) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  // Send via Gmail API
  const result = await sendGmailMessage(tokens.googleToken, tokens.email, {
    to: body.recipient,
    cc: body.cc || undefined,
    subject: body.subject,
    body: body.body,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  // Save tracking record (best-effort — email already sent successfully)
  const admin = getSupabaseAdminClient()
  if (admin) {
    try {
      await admin.from("gmail_sent_emails").insert({
        template_id: body.templateId || null,
        template_name: body.templateName,
        recipient: body.recipient,
        cc: body.cc || null,
        user_email: body.userEmail || null,
        subject: body.subject,
        body: body.body,
        gmail_message_id: result.messageId,
        gmail_thread_id: result.threadId,
        sent_by: tokens.email,
        visibility: body.visibility || "private",
      })
    } catch {
      console.error("Failed to save sent tracking record")
    }
  }

  return NextResponse.json({
    messageId: result.messageId,
    threadId: result.threadId,
  })
}
