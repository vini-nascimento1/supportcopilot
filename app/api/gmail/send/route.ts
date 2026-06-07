import { NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { sendGmailMessage } from "@/lib/gmail-client"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const tokens = await getAgentTokens()
  if (!tokens.googleToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json()) as {
    to: string
    subject: string
    body: string
    threadId?: string
    inReplyTo?: string
    references?: string
  }

  if (!body.to || !body.subject || !body.body) {
    return NextResponse.json({ error: "Missing required fields: to, subject, body" }, { status: 400 })
  }

  const result = await sendGmailMessage(tokens.googleToken, tokens.email, {
    to: body.to,
    subject: body.subject,
    body: body.body,
    threadId: body.threadId,
    inReplyTo: body.inReplyTo,
    references: body.references,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  return NextResponse.json({ messageId: result.messageId })
}
