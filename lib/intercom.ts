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

/** Fetch wrapper with configurable timeout (default 15s) to prevent stalled handlers. */
function fetchIntercom(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const timeout = init?.timeoutMs ?? 15_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
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

type ConversationStatistics = {
  time_to_assignment?: number | null
  time_to_admin_reply?: number | null
  time_to_first_close?: number | null
  time_to_last_close?: number | null
  median_time_to_reply?: number | null
  first_contact_reply_at?: number | null
  first_assignment_at?: number | null
  first_admin_reply_at?: number | null
  first_close_at?: number | null
  last_assignment_at?: number | null
  last_assignment_admin_reply_at?: number | null
  last_contact_reply_at?: number | null
  last_admin_reply_at?: number | null
  last_close_at?: number | null
  last_closed_by_id?: string | null
  count_reopens?: number | null
  count_assignments?: number | null
  count_conversation_parts?: number | null
}

type ConversationRating = {
  score?: number | null
  remark?: string | null
  created_at?: number | null
  replied_at?: number | null
  contact_id?: string | null
  teammate?: { id?: string | null } | null
}

type IntercomSearchConversation = {
  id?: string | number
  state?: string | null
  open?: boolean | null
  updated_at?: number | null
  created_at?: number | null
  title?: string | null
  priority?: string | null
  admin_assignee_id?: number | string | null
  statistics?: ConversationStatistics | null
  conversation_rating?: ConversationRating | null
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
  priority: string | null
  createdAt: string | null
  updatedAt: string | null
  adminAssigneeId: string | null
}

function toSweepConversation(c: IntercomSearchConversation): {
  conv: SweepConversation
} {
  const contact = c.contacts?.contacts?.[0]
  const tags = (c.tags?.tags ?? []).map((t) => t.name ?? "").filter(Boolean)
  return {
    conv: {
      id: String(c.id ?? ""),
      intercomState: c.state ?? (c.open ? "open" : "closed"),
      subject: stripHtml(c.source?.subject ?? c.source?.body ?? c.title) || null,
      tags,
      customerName:
        contact?.name ?? contact?.email ?? c.source?.author?.name ?? c.source?.author?.email ?? null,
      // isCreator is derived from the CREATOR_TAG on the conversation.
      // The Intercom search API does not embed contact custom_attributes,
      // and in practice those fields are not populated on leads anyway.
      isCreator: tags.includes("CREATOR_TAG") || null,
      priority: c.priority ?? null,
      createdAt: toDate(c.created_at),
      updatedAt: toDate(c.updated_at),
      adminAssigneeId: c.admin_assignee_id != null ? String(c.admin_assignee_id) : null,
    },
  }
}

/**
 * Live-fetch open Intercom conversations for the automation engine.
 * @param adminId optional — when provided scopes to that agent's queue;
 *   when omitted fetches ALL open conversations.
 * @throws if INTERCOM_ACCESS_TOKEN is unset or the search request fails.
 */
export async function searchOpenConversationsForAdmin(adminId?: string): Promise<SweepConversation[]> {
  if (!intercomToken) throw new Error("INTERCOM_ACCESS_TOKEN is not set")

  const out: SweepConversation[] = []
  let startingAfter: string | undefined

  do {
    const queryFilters: Array<Record<string, unknown>> = [
      { field: "open", operator: "=", value: true },
    ]
    if (adminId) {
      const adminIdNum = Number(adminId)
      if (!Number.isFinite(adminIdNum)) throw new Error(`Invalid intercom_admin_id: ${adminId}`)
      queryFilters.push({ field: "admin_assignee_id", operator: "=", value: adminIdNum })
    }

    const body: Record<string, unknown> = {
      query: { operator: "AND", value: queryFilters },
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
      const { conv } = toSweepConversation(c)
      out.push(conv)
    }
    startingAfter = payload.pages?.next?.starting_after
  } while (startingAfter)

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

// ── Agent metrics (conversation stats for the Metrics tab) ──────────────────

export type AgentMetrics = {
  /** Number of closed conversations in the period. */
  totalConversations: number
  /** Average first response time in seconds (null if no data). */
  avgFrtSec: number | null
  /** Median first response time in seconds (null if no data). */
  medianFrtSec: number | null
  /** Average time to first close in seconds (null if no data). */
  avgTimeToResolveSec: number | null
  /** Average number of assignments per conversation. */
  avgAssignments: number | null
  /** Average number of reopens per conversation. */
  avgReopens: number | null
  /** Average CSAT score (1-5, null if no ratings). */
  avgCsat: number | null
  /** Number of conversations with a CSAT rating. */
  csatCount: number | null
  /** Period in days. */
  periodDays: number
}

/**
 * Fetch the agent's conversation metrics from Intercom.
 * Searches for conversations assigned to this admin in the time range
 * and computes aggregate KPIs from the statistics.* and conversation_rating
 * fields that come back from the search API.
 *
 * Capped at 50 pages (7,500 conversations) to prevent timeout on wide ranges.
 */
export async function searchMetricsForAdmin(
  adminId: string,
  startTsSec: number,
  endTsSec: number
): Promise<AgentMetrics> {
  if (!intercomToken) throw new Error("INTERCOM_ACCESS_TOKEN is not set")

  const adminIdNum = Number(adminId)
  if (!Number.isFinite(adminIdNum)) throw new Error(`Invalid intercom_admin_id: ${adminId}`)

  const frtValues: number[] = []
  const resolveValues: number[] = []
  const assignmentCounts: number[] = []
  const reopenCounts: number[] = []
  const csatScores: number[] = []
  let total = 0
  let startingAfter: string | undefined
  let pageCount = 0
  const MAX_PAGES = 50

  do {
    pageCount++
    const body: Record<string, unknown> = {
      query: {
        operator: "AND",
        value: [
          { field: "admin_assignee_id", operator: "=", value: adminIdNum },
          { field: "created_at", operator: ">", value: startTsSec },
          { field: "created_at", operator: "<", value: endTsSec },
        ],
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
      timeoutMs: 30_000,
    })

    if (!response.ok) throw new Error(`Intercom search ${response.status}`)

    const payload = (await response.json()) as {
      conversations?: IntercomSearchConversation[]
      data?: IntercomSearchConversation[]
      pages?: { next?: { starting_after: string } | null }
    }

    const convs = payload.conversations ?? payload.data ?? []
    total += convs.length

    for (const c of convs) {
      const stats = c.statistics
      if (stats) {
        if (typeof stats.time_to_admin_reply === "number") frtValues.push(stats.time_to_admin_reply)
        if (typeof stats.time_to_first_close === "number") resolveValues.push(stats.time_to_first_close)
        if (typeof stats.count_assignments === "number") assignmentCounts.push(stats.count_assignments)
        if (typeof stats.count_reopens === "number") reopenCounts.push(stats.count_reopens)
      }
      const rating = c.conversation_rating
      if (rating && typeof rating.score === "number") csatScores.push(rating.score)
    }

    startingAfter = payload.pages?.next?.starting_after
  } while (startingAfter && pageCount < MAX_PAGES)

  function median(values: number[]): number | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  }

  function avg(values: number[]): number | null {
    if (values.length === 0) return null
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  return {
    totalConversations: total,
    avgFrtSec: avg(frtValues),
    medianFrtSec: median(frtValues),
    avgTimeToResolveSec: avg(resolveValues),
    avgAssignments: avg(assignmentCounts),
    avgReopens: avg(reopenCounts),
    avgCsat: avg(csatScores),
    csatCount: csatScores.length,
    periodDays: Math.round((endTsSec - startTsSec) / 86_400),
  }
}
