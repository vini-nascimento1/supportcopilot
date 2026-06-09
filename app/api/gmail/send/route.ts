import { NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { sendGmailMessage, type SendAttachment } from "@/lib/gmail-client"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const tokens = await getAgentTokens()
  if (!tokens.googleToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const contentType = request.headers.get("content-type") ?? ""

  // Support both JSON (backwards compat) and FormData (with attachments)
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    return handleFormData(request, tokens.googleToken, tokens.email)
  }

  return handleJson(request, tokens.googleToken, tokens.email)
}

async function handleJson(
  request: Request,
  token: string,
  email: string | null
): Promise<Response> {
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

  const result = await sendGmailMessage(token, email, {
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

  return NextResponse.json({ messageId: result.messageId, threadId: result.threadId })
}

async function handleFormData(
  request: Request,
  token: string,
  email: string | null
): Promise<Response> {
  try {
    const formData = await request.formData()

    const to = formData.get("to") as string | null
    const subject = formData.get("subject") as string | null
    const body = formData.get("body") as string | null
    const threadId = formData.get("threadId") as string | null
    const inReplyTo = formData.get("inReplyTo") as string | null
    const references = formData.get("references") as string | null

    if (!to || !subject || !body) {
      return NextResponse.json({ error: "Missing required fields: to, subject, body" }, { status: 400 })
    }

    // Collect uploaded files
    const attachments: SendAttachment[] = []
    const fileEntries = formData.getAll("attachments") as File[]
    for (const file of fileEntries) {
      if (file.size > 0) {
        const arrayBuffer = await file.arrayBuffer()
        attachments.push({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          content: Buffer.from(arrayBuffer),
        })
      }
    }

    const result = await sendGmailMessage(
      token,
      email,
      { to, subject, body, threadId: threadId ?? undefined, inReplyTo: inReplyTo ?? undefined, references: references ?? undefined },
      attachments.length > 0 ? attachments : undefined
    )

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 })
    }

    return NextResponse.json({ messageId: result.messageId, threadId: result.threadId })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to process form data" },
      { status: 400 }
    )
  }
}
