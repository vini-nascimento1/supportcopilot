import "server-only"

import { googleFetch } from "@/lib/auth"

export type GmailResult =
  | { connected: true; unreadCount: number; inboxLink: string }
  | { connected: false }

export type GmailThreadSummary = {
  id: string
  snippet: string
  subject: string
  from: string
  fromName: string
  date: string
  isUnread: boolean
  messageCount: number
}

export type GmailAttachment = {
  filename: string
  mimeType: string
  attachmentId: string
  size: number
  /** Populated when the attachment data has been fetched (download). */
  data?: string
}

export type GmailMessage = {
  id: string
  threadId: string
  from: string
  fromName: string
  to: string
  subject: string
  date: string
  messageId: string
  inReplyTo: string | null
  references: string | null
  bodyPlain: string
  bodyHtml: string
  isUnread: boolean
  attachments: GmailAttachment[]
}

export type GmailThreadDetail = {
  id: string
  subject: string
  messages: GmailMessage[]
}

export type GmailInboxResult =
  | { connected: true; threads: GmailThreadSummary[]; nextPageToken: string | null; resultSizeEstimate: number }
  | { connected: false }

type GmailHeader = { name: string; value: string }

type GmailPayload = {
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: GmailPayload[]
}

type GmailApiMessage = {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  payload?: GmailPayload
  internalDate?: string
}

function getHeader(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
}

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
  return Buffer.from(padded, "base64").toString("utf-8")
}

function extractBody(payload: GmailPayload): { plain: string; html: string } {
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data)
    if (payload.mimeType === "text/html") return { plain: "", html: decoded }
    if (payload.mimeType === "text/plain") return { plain: decoded, html: "" }
  }

  let plain = ""
  let html = ""
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      plain = decodeBase64Url(part.body.data)
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html = decodeBase64Url(part.body.data)
    } else if (part.mimeType?.startsWith("multipart/") && part.parts) {
      const sub = extractBody(part)
      if (sub.plain) plain = sub.plain
      if (sub.html) html = sub.html
    }
  }
  return { plain, html }
}

function extractAttachments(payload: GmailPayload): GmailAttachment[] {
  const attachments: GmailAttachment[] = []

  function walk(part: GmailPayload) {
    // Parts with a filename and attachmentId are attachments
    if (
      part.filename &&
      part.body?.attachmentId &&
      part.mimeType &&
      part.mimeType !== "text/plain" &&
      part.mimeType !== "text/html"
    ) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        attachmentId: part.body.attachmentId,
        size: part.body.size ?? 0,
      })
    }
    for (const sub of part.parts ?? []) {
      walk(sub)
    }
  }

  walk(payload)
  return attachments
}

function parseFrom(from: string): { name: string; address: string } {
  const match = from.match(/^(.*?)\s*<([^>]+)>$/)
  if (match) return { name: match[1]?.trim() ?? "", address: match[2]?.trim() ?? from }
  return { name: "", address: from.trim() }
}

function apiMessageToGmailMessage(msg: GmailApiMessage): GmailMessage {
  const headers = msg.payload?.headers ?? []
  const from = getHeader(headers, "From")
  const { name: fromName } = parseFrom(from)
  const body = extractBody(msg.payload ?? {})
  const dateHeader = getHeader(headers, "Date")

  return {
    id: msg.id,
    threadId: msg.threadId,
    from,
    fromName: fromName || from,
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    date: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : (dateHeader || ""),
    messageId: getHeader(headers, "Message-ID"),
    inReplyTo: getHeader(headers, "In-Reply-To") || null,
    references: getHeader(headers, "References") || null,
    bodyPlain: body.plain,
    bodyHtml: body.html,
    isUnread: (msg.labelIds ?? []).includes("UNREAD"),
    attachments: extractAttachments(msg.payload ?? {}),
  }
}

// ── Dashboard summary ────────────────────────────────────────────────────────

export async function getGmailUnreadCount(
  token: string | null,
  email?: string | null
): Promise<GmailResult> {
  if (!token) return { connected: false }

  try {
    const res = await googleFetch(
      email ?? null,
      token,
      "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX"
    )
    if (!res || !res.ok) return { connected: false }

    const data = (await res.json()) as { messagesUnread?: number }
    return {
      connected: true,
      unreadCount: data.messagesUnread ?? 0,
      inboxLink: "https://mail.google.com",
    }
  } catch {
    return { connected: false }
  }
}

// ── Inbox thread list ────────────────────────────────────────────────────────

export async function getInboxThreads(
  token: string | null,
  email?: string | null,
  pageToken?: string | null,
  query = "in:inbox"
): Promise<GmailInboxResult> {
  if (!token) return { connected: false }

  try {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads")
    url.searchParams.set("q", query)
    url.searchParams.set("maxResults", "20")
    if (pageToken) url.searchParams.set("pageToken", pageToken)

    const listRes = await googleFetch(email ?? null, token, url.toString())
    if (!listRes || !listRes.ok) return { connected: false }

    const listData = (await listRes.json()) as {
      threads?: Array<{ id: string; snippet: string }>
      nextPageToken?: string
      resultSizeEstimate?: number
    }

    const rawThreads = listData.threads ?? []
    if (rawThreads.length === 0) {
      return {
        connected: true,
        threads: [],
        nextPageToken: listData.nextPageToken ?? null,
        resultSizeEstimate: listData.resultSizeEstimate ?? 0,
      }
    }

    // Batch-fetch the first message of each thread for subject/from/date/labels
    const threads = await Promise.all(
      rawThreads.map(async (t): Promise<GmailThreadSummary> => {
        try {
          const tRes = await googleFetch(
            email ?? null,
            token,
            `https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
          )
          if (!tRes || !tRes.ok) throw new Error("failed")
          const tData = (await tRes.json()) as {
            id: string
            messages?: GmailApiMessage[]
          }
          const msgs = tData.messages ?? []
          const first = msgs[0]
          const last = msgs[msgs.length - 1] ?? first
          const headers = first?.payload?.headers ?? []
          const allLabels = msgs.flatMap((m) => m.labelIds ?? [])

          const from = getHeader(headers, "From")
          const { name: fromName } = parseFrom(from)
          const dateHeader = getHeader(last?.payload?.headers ?? [], "Date")

          return {
            id: t.id,
            snippet: t.snippet,
            subject: getHeader(headers, "Subject") || "(No subject)",
            from,
            fromName: fromName || from,
            date: last?.internalDate
              ? new Date(Number(last.internalDate)).toISOString()
              : (dateHeader || new Date().toISOString()),
            isUnread: allLabels.includes("UNREAD"),
            messageCount: msgs.length,
          }
        } catch {
          return {
            id: t.id,
            snippet: t.snippet,
            subject: "(No subject)",
            from: "",
            fromName: "",
            date: new Date().toISOString(),
            isUnread: false,
            messageCount: 1,
          }
        }
      })
    )

    return {
      connected: true,
      threads,
      nextPageToken: listData.nextPageToken ?? null,
      resultSizeEstimate: listData.resultSizeEstimate ?? threads.length,
    }
  } catch {
    return { connected: false }
  }
}

// ── Thread detail ────────────────────────────────────────────────────────────

export async function getGmailThread(
  token: string | null,
  threadId: string,
  email?: string | null
): Promise<GmailThreadDetail | null> {
  if (!token) return null

  try {
    const res = await googleFetch(
      email ?? null,
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`
    )
    if (!res || !res.ok) return null

    const data = (await res.json()) as {
      id: string
      messages?: GmailApiMessage[]
    }

    const messages = (data.messages ?? []).map(apiMessageToGmailMessage)
    const subject = messages[0]?.subject || "(No subject)"

    return { id: data.id, subject, messages }
  } catch {
    return null
  }
}

// ── Send / reply ─────────────────────────────────────────────────────────────

type SendParams = {
  to: string
  cc?: string
  subject: string
  body: string
  threadId?: string
  inReplyTo?: string
  references?: string
}

export type SendAttachment = {
  filename: string
  mimeType: string
  content: Buffer
}

function buildRawMessage(params: SendParams, attachments?: SendAttachment[]): string {
  const hasAttachments = attachments && attachments.length > 0

  if (!hasAttachments) {
    const lines = [
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
    ]
    if (params.cc) lines.push(`Cc: ${params.cc}`)
    if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`)
    if (params.references) lines.push(`References: ${params.references}`)
    lines.push("", params.body)
    return Buffer.from(lines.join("\r\n")).toString("base64url")
  }

  // Build multipart/mixed MIME message with attachments
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const parts: string[] = []

  // Text part
  parts.push(
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    params.body
  )

  // Attachment parts
  for (const att of attachments) {
    const base64 = att.content.toString("base64")
    // Strip any quotes from filename to prevent MIME header injection
    const safeFilename = att.filename.replace(/"/g, "")
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${safeFilename}"`,
      `Content-Disposition: attachment; filename="${safeFilename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64
    )
  }

  parts.push(`--${boundary}--`, "")

  const headers = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]
  if (params.cc) headers.push(`Cc: ${params.cc}`)
  if (params.inReplyTo) headers.push(`In-Reply-To: ${params.inReplyTo}`)
  if (params.references) headers.push(`References: ${params.references}`)

  const raw = [...headers, "", ...parts].join("\r\n")
  return Buffer.from(raw).toString("base64url")
}

export async function sendGmailMessage(
  token: string,
  email: string | null,
  params: SendParams,
  attachments?: SendAttachment[]
): Promise<{ ok: true; messageId: string; threadId: string } | { ok: false; error: string }> {
  try {
    const body: Record<string, string> = { raw: buildRawMessage(params, attachments) }
    if (params.threadId) body.threadId = params.threadId

    const res = await googleFetch(
      email,
      token,
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    )

    if (!res) return { ok: false, error: "No token or refresh failed" }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      return { ok: false, error: err.error?.message ?? `HTTP ${res.status}` }
    }

    const data = (await res.json()) as { id: string; threadId: string }
    return { ok: true, messageId: data.id, threadId: data.threadId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

// ── Mark as read ─────────────────────────────────────────────────────────────

export async function markThreadRead(
  token: string,
  email: string | null,
  threadId: string
): Promise<void> {
  await googleFetch(
    email,
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    }
  )
}

// ── Attachment download ─────────────────────────────────────────────────────

export async function getAttachmentData(
  token: string,
  email: string | null,
  messageId: string,
  attachmentId: string
): Promise<{ data: string; size: number } | null> {
  try {
    const res = await googleFetch(
      email,
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`
    )
    if (!res || !res.ok) return null
    return (await res.json()) as { data: string; size: number }
  } catch {
    return null
  }
}

// ── Bulk operations ──────────────────────────────────────────────────────────

export async function trashThreads(
  token: string,
  email: string | null,
  threadIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await googleFetch(
      email,
      token,
      "https://gmail.googleapis.com/gmail/v1/users/me/threads/batchModify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: threadIds, addLabelIds: ["TRASH"] }),
      }
    )
    if (!res) return { ok: false, error: "No token or refresh failed" }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      return { ok: false, error: err.error?.message ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}
