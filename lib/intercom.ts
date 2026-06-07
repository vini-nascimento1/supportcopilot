import "server-only"

import { getDraftPlaceholder, getLiveTipForText, type CaseTip } from "@/lib/case-intelligence"
import type { PlaybookListItem } from "@/lib/playbooks"

export type SupportCase = {
  id: string
  customer: string
  email: string | null
  state: string
  updatedAt: string | null
  snippet: string
  intercomUrl: string | null
  tip: CaseTip | null
  draftPlaceholder: string
}

export type CasesQueueData = {
  mode: "live" | "demo" | "error"
  error: string | null
  rows: SupportCase[]
}

type IntercomContact = {
  name?: string | null
  email?: string | null
}

type IntercomConversation = {
  id: string | number
  state?: string | null
  open?: boolean | null
  updated_at?: number | null
  title?: string | null
  conversation_message?: {
    body?: string | null
  } | null
  source?: {
    body?: string | null
    author?: { name?: string | null; email?: string | null } | null
  } | null
  contacts?: {
    contacts?: IntercomContact[]
  } | null
  user?: IntercomContact | null
}

const intercomToken = process.env.INTERCOM_ACCESS_TOKEN
const intercomAdminId = process.env.INTERCOM_ADMIN_ID
const intercomAppId = process.env.INTERCOM_APP_ID

function stripHtml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function toDate(value: unknown) {
  if (typeof value !== "number") {
    return null
  }

  return new Date(value * 1000).toISOString()
}

function getCustomerLabel(conversation: IntercomConversation) {
  const contact = conversation.contacts?.contacts?.[0]
  return (
    contact?.name ??
    contact?.email ??
    conversation.source?.author?.name ??
    conversation.source?.author?.email ??
    conversation.user?.name ??
    conversation.user?.email ??
    "Unknown customer"
  )
}

function getCustomerEmail(conversation: IntercomConversation): string | null {
  const contact = conversation.contacts?.contacts?.[0]
  return (
    contact?.email ??
    conversation.source?.author?.email ??
    conversation.user?.email ??
    null
  )
}

function getSnippet(conversation: IntercomConversation) {
  return (
    stripHtml(conversation.conversation_message?.body) ||
    stripHtml(conversation.source?.body) ||
    stripHtml(conversation.title) ||
    "No message preview available."
  )
}

function getIntercomUrl(conversationId: string) {
  if (!intercomAppId) {
    return null
  }

  return `https://app.intercom.com/a/inbox/${intercomAppId}/inbox/conversation/${conversationId}`
}

function demoCases(playbooks: PlaybookListItem[]): CasesQueueData {
  const rows = [
    {
      id: "demo-otp",
      customer: "Demo creator",
      email: "creator@demo.com",
      state: "open",
      updatedAt: new Date().toISOString(),
      snippet: "I am not receiving the OTP code for my payout confirmation.",
    },
    {
      id: "demo-payout",
      customer: "Demo agency",
      email: "agency@demo.com",
      state: "open",
      updatedAt: new Date().toISOString(),
      snippet: "The payout says under review and asks for more documents.",
    },
  ].map((row) => {
    const tip = getLiveTipForText(row.snippet, playbooks)

    return {
      ...row,
      intercomUrl: null,
      tip,
      draftPlaceholder: getDraftPlaceholder(row.snippet, tip),
    }
  })

  return {
    mode: "demo",
    error: null,
    rows,
  }
}

export type ConversationMessage = {
  role: "customer" | "admin"
  author: string
  body: string
  createdAt: string
}

export type ConversationDetail = {
  id: string
  customer: string
  email: string | null
  state: string
  subject: string | null
  firstMessage: string
  messages: ConversationMessage[]
  intercomUrl: string | null
  tags: string[]
  topic: string | null
  updatedAt: string | null
}

type IntercomConversationFull = {
  id: string | number
  state?: string | null
  open?: boolean | null
  updated_at?: number | null
  title?: string | null
  source?: {
    body?: string | null
    subject?: string | null
    author?: { name?: string | null; email?: string | null; type?: string | null } | null
  } | null
  conversation_parts?: {
    conversation_parts?: Array<{
      part_type?: string | null
      body?: string | null
      created_at?: number | null
      author?: { name?: string | null; type?: string | null } | null
    }>
  } | null
  tags?: { tags?: Array<{ name?: string | null }> } | null
  topics?: { topics?: Array<{ name?: string | null }> } | null
}

export async function getConversationDetail(
  id: string
): Promise<ConversationDetail | null> {
  if (!intercomToken) return null

  const response = await fetch(`https://api.intercom.io/conversations/${id}`, {
    headers: {
      Authorization: `Bearer ${intercomToken}`,
      "Intercom-Version": "2.11",
    },
    cache: "no-store",
  })

  if (!response.ok) return null

  const conv = (await response.json()) as IntercomConversationFull
  const parts = conv.conversation_parts?.conversation_parts ?? []

  const messages: ConversationMessage[] = parts
    .filter((p) => p.part_type === "comment" && p.body)
    .map((p) => ({
      role: p.author?.type === "admin" ? "admin" : "customer",
      author: p.author?.name ?? (p.author?.type === "admin" ? "Agent" : "Customer"),
      body: stripHtml(p.body),
      createdAt: toDate(p.created_at) ?? "",
    }))

  const strippedSubject = stripHtml(conv.source?.subject ?? conv.title)

  return {
    id: String(conv.id),
    customer: conv.source?.author?.name ?? conv.source?.author?.email ?? "Unknown customer",
    email: conv.source?.author?.email ?? null,
    state: conv.state ?? (conv.open ? "open" : "closed"),
    subject: strippedSubject || null,
    firstMessage: stripHtml(conv.source?.body),
    messages,
    intercomUrl: getIntercomUrl(String(conv.id)),
    tags: (conv.tags?.tags ?? []).map((t) => t.name ?? "").filter(Boolean),
    topic: conv.topics?.topics?.[0]?.name ?? null,
    updatedAt: toDate(conv.updated_at),
  }
}

export async function getOpenCasesQueue(
  playbooks: PlaybookListItem[],
  agentAdminId?: string | null
): Promise<CasesQueueData> {
  const adminId = agentAdminId ?? intercomAdminId
  if (!intercomToken || !adminId) {
    return demoCases(playbooks)
  }

  const allConversations: IntercomConversation[] = []
  let startingAfter: string | undefined

  do {
    const body: Record<string, unknown> = {
      query: {
        operator: "AND",
        value: [
          {
            field: "admin_assignee_id",
            operator: "=",
            value: adminId,
          },
          {
            field: "open",
            operator: "=",
            value: true,
          },
        ],
      },
      pagination: {
        per_page: 150,
      },
    }

    if (startingAfter) {
      (body.pagination as Record<string, unknown>).starting_after = startingAfter
    }

    const response = await fetch("https://api.intercom.io/conversations/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${intercomToken}`,
        "Content-Type": "application/json",
        "Intercom-Version": "2.11",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    if (!response.ok) {
      return {
        mode: "error",
        error: `Intercom returned ${response.status}`,
        rows: demoCases(playbooks).rows,
      }
    }

    const payload = (await response.json()) as {
      conversations?: IntercomConversation[]
      data?: IntercomConversation[]
      pages?: {
        next?: { starting_after: string } | null
      }
    }

    const conversations = payload.conversations ?? payload.data ?? []
    allConversations.push(...conversations)

    startingAfter = payload.pages?.next?.starting_after
  } while (startingAfter)

  return {
    mode: "live",
    error: null,
    rows: allConversations.map((conversation) => {
      const id = String(conversation.id)
      const snippet = getSnippet(conversation)
      const tip = getLiveTipForText(snippet, playbooks)

      return {
        id,
        customer: getCustomerLabel(conversation),
        email: getCustomerEmail(conversation),
        state: conversation.state ?? (conversation.open ? "open" : "closed"),
        updatedAt: toDate(conversation.updated_at),
        snippet,
        intercomUrl: getIntercomUrl(id),
        tip,
        draftPlaceholder: getDraftPlaceholder(snippet, tip),
      }
    }),
  }
}
