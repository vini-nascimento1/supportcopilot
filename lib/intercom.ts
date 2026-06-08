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

/** Fetch wrapper with a 15-second timeout to prevent stalled handlers. */
function fetchIntercom(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

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

  const response = await fetchIntercom(`https://api.intercom.io/conversations/${id}`, {
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

    const response = await fetchIntercom("https://api.intercom.io/conversations/search", {
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

// ── Live conversation feed for the automation engine ──────────────────────
// Returns the raw fields the eval context needs. Distinct from getOpenCasesQueue,
// which shapes data for the UI. Multi-page; honours Intercom's pagination cursor.
// After the search, we enrich each conversation with the contact's custom_attributes
// (Intercom's search endpoint does NOT embed those, so is_creator / is_ai_creator
// would otherwise always be null — see Fix #1 in the live-Intercom refactor review).

type IntercomSearchConversation = {
  id?: string | number
  state?: string | null
  open?: boolean | null
  updated_at?: number | null
  created_at?: number | null
  title?: string | null
  priority?: string | null
  admin_assignee_id?: number | string | null
  source?: {
    subject?: string | null
    body?: string | null
    author?: { name?: string | null; email?: string | null } | null
  } | null
  contacts?: {
    contacts?: Array<{
      id?: string
      name?: string | null
      email?: string | null
      custom_attributes?: Record<string, unknown> | null
    }>
  } | null
  tags?: { tags?: Array<{ name?: string | null }> } | null
}

export type SweepConversation = {
  id: string
  intercomState: string
  subject: string | null
  tags: string[]
  customerName: string | null
  isCreator: boolean | null
  isAiCreator: boolean | null
  priority: string | null
  createdAt: string | null
  updatedAt: string | null
  adminAssigneeId: string | null
}

export function coerceCustomBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const v = value.toLowerCase()
    if (v === "true" || v === "yes" || v === "1") return true
    if (v === "false" || v === "no" || v === "0") return false
  }
  return null
}

/** Read creator flags from a contact's custom_attributes — keys are deliberately loose
 * because Intercom admins use varied spellings ("Is Creator" / "is_creator" / "Creator"). */
export function readCreatorFlags(attrs: Record<string, unknown> | null | undefined): {
  isCreator: boolean | null
  isAiCreator: boolean | null
} {
  const a = attrs ?? {}
  return {
    isCreator: coerceCustomBool(a.is_creator ?? a.IsCreator ?? a["Is Creator"] ?? a.Creator),
    isAiCreator: coerceCustomBool(
      a.is_ai_creator ?? a.IsAICreator ?? a["Is AI Creator"] ?? a["AI Creator"]
    ),
  }
}

function toSweepConversation(c: IntercomSearchConversation): {
  conv: SweepConversation
  contactId: string | null
} {
  const contact = c.contacts?.contacts?.[0]
  const flags = readCreatorFlags(contact?.custom_attributes)
  return {
    conv: {
      id: String(c.id ?? ""),
      intercomState: c.state ?? (c.open ? "open" : "closed"),
      subject: stripHtml(c.source?.subject ?? c.source?.body ?? c.title) || null,
      tags: (c.tags?.tags ?? []).map((t) => t.name ?? "").filter(Boolean),
      customerName:
        contact?.name ?? contact?.email ?? c.source?.author?.name ?? c.source?.author?.email ?? null,
      isCreator: flags.isCreator,
      isAiCreator: flags.isAiCreator,
      priority: c.priority ?? null,
      createdAt: toDate(c.created_at),
      updatedAt: toDate(c.updated_at),
      adminAssigneeId: c.admin_assignee_id != null ? String(c.admin_assignee_id) : null,
    },
    contactId: contact?.id ?? null,
  }
}

async function fetchContactAttributes(contactId: string): Promise<Record<string, unknown> | null> {
  if (!intercomToken) return null
  const res = await fetchIntercom(`https://api.intercom.io/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${intercomToken}`,
      "Intercom-Version": "2.11",
    },
    cache: "no-store",
  })
  if (!res.ok) return null
  const data = (await res.json()) as { custom_attributes?: Record<string, unknown> }
  return data.custom_attributes ?? {}
}

async function enrichCreatorFlags(
  convs: SweepConversation[],
  contactIds: (string | null)[]
): Promise<void> {
  const unique = Array.from(new Set(contactIds.filter((id): id is string => !!id)))
  if (unique.length === 0) return

  // Bounded-concurrency fan-out (Intercom limit ~1000 req/min; sweeps are infrequent).
  const attrsByContact = new Map<string, Record<string, unknown>>()
  const BATCH = 8
  for (let i = 0; i < unique.length; i += BATCH) {
    const slice = unique.slice(i, i + BATCH)
    const results = await Promise.all(
      slice.map(async (id) => [id, await fetchContactAttributes(id)] as const)
    )
    for (const [id, attrs] of results) if (attrs) attrsByContact.set(id, attrs)
  }

  for (let i = 0; i < convs.length; i++) {
    const cid = contactIds[i]
    if (!cid) continue
    const attrs = attrsByContact.get(cid)
    if (!attrs) continue
    const flags = readCreatorFlags(attrs)
    convs[i].isCreator = flags.isCreator
    convs[i].isAiCreator = flags.isAiCreator
  }
}

/**
 * Live-fetch the agent's open Intercom queue, with contact custom_attributes enriched.
 * @param adminId numeric Intercom admin id (string is accepted but coerced to number for the API).
 * @throws if INTERCOM_ACCESS_TOKEN is unset or the search request fails — the sweep
 *   runner catches and surfaces the error, so a missing token is loud, not silent.
 */
export async function searchOpenConversationsForAdmin(adminId?: string): Promise<SweepConversation[]> {
  if (!intercomToken) throw new Error("INTERCOM_ACCESS_TOKEN is not set")

  const out: SweepConversation[] = []
  const contactIds: (string | null)[] = []
  let startingAfter: string | undefined

  do {
    // When adminId is provided, scope to that agent's queue. When omitted,
    // fetch ALL open conversations (used by global rule tests).
    const queryFilters: Array<Record<string, unknown>> = [
      { field: "open", operator: "=", value: true },
    ]
    if (adminId) {
      const adminIdNum = Number(adminId)
      if (!Number.isFinite(adminIdNum)) throw new Error(`Invalid intercom_admin_id: ${adminId}`)
      queryFilters.push({ field: "admin_assignee_id", operator: "=", value: adminIdNum })
    }

    const body: Record<string, unknown> = {
      query: {
        operator: "AND",
        value: queryFilters,
      },
      pagination: { per_page: 150, ...(startingAfter ? { starting_after: startingAfter } : {}) },
    }

    const response = await fetchIntercom("https://api.intercom.io/conversations/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${intercomToken}`,
        "Content-Type": "application/json",
        "Intercom-Version": "2.11",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    if (!response.ok) throw new Error(`Intercom search ${response.status}`)

    const payload = (await response.json()) as {
      conversations?: IntercomSearchConversation[]
      data?: IntercomSearchConversation[]
      pages?: { next?: { starting_after: string } | null }
    }

    for (const c of payload.conversations ?? payload.data ?? []) {
      const { conv, contactId } = toSweepConversation(c)
      out.push(conv)
      contactIds.push(contactId)
    }
    startingAfter = payload.pages?.next?.starting_after
  } while (startingAfter)

  await enrichCreatorFlags(out, contactIds)
  return out
}

// ── Intercom Admin listing ──────────────────────────────────────────────────

export type IntercomAdmin = {
  id: string
  name: string
  email: string | null
}

export async function listIntercomAdmins(): Promise<IntercomAdmin[]> {
  if (!intercomToken) return []
  try {
    const res = await fetchIntercom("https://api.intercom.io/admins", {
      headers: { Authorization: `Bearer ${intercomToken}` },
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { admins?: Array<{ id: string; name: string; email: string | null }> }
    return (data.admins ?? []).map((a) => ({ id: a.id, name: a.name, email: a.email }))
  } catch {
    return []
  }
}
