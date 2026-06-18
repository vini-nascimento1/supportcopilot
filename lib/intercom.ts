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
  created_at?: number | null
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

  // The conversation's opening message lives on `source`, NOT in
  // conversation_parts — so the thread must start with it, otherwise the
  // card begins mid-conversation and the first customer contact is lost.
  const sourceBody = stripHtml(conv.source?.body)
  const initialMessage: ConversationMessage[] = sourceBody
    ? [
        {
          role: conv.source?.author?.type === "admin" ? "admin" : "customer",
          author:
            conv.source?.author?.name ??
            conv.source?.author?.email ??
            (conv.source?.author?.type === "admin" ? "Agent" : "Customer"),
          body: sourceBody,
          createdAt: toDate(conv.created_at) ?? "",
        },
      ]
    : []

  // A customer-visible message rides on more part types than just `comment`:
  // when a customer replies to a *closed* conversation the reply arrives as an
  // `open` part (it reopens the thread), an agent's first reply can ride on the
  // `assignment` part, and a reply that also closes rides on `close` — all
  // carry their text in `body`. Filtering to `comment` alone silently dropped
  // reopen messages and assignment greetings. Internal `note` parts stay
  // hidden; structural events (assignments, tag updates, SLA, etc.) carry no
  // body and fall out once we strip HTML.
  const partMessages: ConversationMessage[] = parts
    .filter((p) => p.part_type !== "note")
    .map((p) => ({
      role: (p.author?.type === "admin" ? "admin" : "customer") as "admin" | "customer",
      author: p.author?.name ?? (p.author?.type === "admin" ? "Agent" : "Customer"),
      body: stripHtml(p.body),
      createdAt: toDate(p.created_at) ?? "",
    }))
    .filter((m) => m.body)

  const messages: ConversationMessage[] = [...initialMessage, ...partMessages]

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

/**
 * Which inbox to load. "mine" = the signed-in agent (default),
 * "unassigned" = open conversations with no assignee (Intercom's Unassigned
 * inbox), "admin" = a specific teammate's inbox.
 */
export type InboxFilter =
  | { kind: "mine" }
  | { kind: "unassigned" }
  | { kind: "admin"; adminId: string }

export async function getOpenCasesQueue(
  playbooks: PlaybookListItem[],
  agentAdminId?: string | null,
  inbox: InboxFilter = { kind: "mine" }
): Promise<CasesQueueData> {
  // Resolve the assignee clause. Unassigned conversations carry
  // admin_assignee_id = 0 in Intercom's search API.
  let assigneeValue: string | number
  if (inbox.kind === "unassigned") {
    assigneeValue = 0
  } else if (inbox.kind === "admin") {
    assigneeValue = inbox.adminId
  } else {
    const adminId = agentAdminId ?? intercomAdminId
    if (!adminId) {
      return demoCases(playbooks)
    }
    assigneeValue = adminId
  }

  if (!intercomToken) {
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
            value: assigneeValue,
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
  rating?: number | null
  remark?: string | null
  created_at?: number | null
  replied_at?: number | null
  contact_id?: string | null
  teammate?: { id?: string | null } | null
}

type IntercomSlaApplied = {
  sla_name?: string | null
  /** active = clock running; hit = resolved in time; missed = breached; cancelled = SLA no longer applies. */
  sla_status?: "active" | "hit" | "missed" | "cancelled" | null
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
  /** Unix seconds: when the current SLA clock started waiting for a reply. Null when no one is waiting. */
  waiting_since?: number | null
  sla_applied?: IntercomSlaApplied | null
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

export type SlaStatus = "active" | "hit" | "missed" | "cancelled" | "none"

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
  /** Intercom's native SLA status. "none" when no SLA applies. */
  slaStatus: SlaStatus
  slaName: string | null
  /** Unix seconds since the SLA clock started waiting; null when not waiting. */
  waitingSinceSec: number | null
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
      slaStatus: (c.sla_applied?.sla_status ?? "none") as SlaStatus,
      slaName: c.sla_applied?.sla_name ?? null,
      waitingSinceSec: typeof c.waiting_since === "number" ? c.waiting_since : null,
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

// ── Intercom Help Center articles ───────────────────────────────────────────

export type IntercomArticle = {
  id: string
  title: string
  description: string
  bodySnippet: string
}

/**
 * Search Intercom Help Center articles by keyword query.
 * Returns up to 5 matching articles with body truncated to ~1 200 chars each.
 * Returns empty array if the token is missing, the request fails, or Help
 * Center is not set up on this workspace.
 */
export async function searchArticles(query: string): Promise<IntercomArticle[]> {
  if (!intercomToken || !query.trim()) return []

  try {
    const response = await fetchIntercom("https://api.intercom.io/articles/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${intercomToken}`,
        "Content-Type": "application/json",
        "Intercom-Version": "2.11",
      },
      body: JSON.stringify({
        query: {
          operator: "AND",
          value: [{ field: "body", operator: "~", value: query }],
        },
        pagination: { per_page: 5 },
      }),
      cache: "no-store",
      timeoutMs: 10_000,
    })

    if (!response.ok) return []

    const payload = (await response.json()) as {
      data?: Array<{
        id: string
        title?: string
        description?: string
        body?: string
      }>
    }

    return (payload.data ?? []).map((a) => ({
      id: a.id,
      title: a.title ?? "",
      description: a.description ?? "",
      bodySnippet: stripHtml(a.body).slice(0, 1_200),
    }))
  } catch {
    return []
  }
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
  /** Average CSAT rating (1-5, null if no ratings). */
  avgCsat: number | null
  /** Number of conversations with a CSAT rating. */
  csatCount: number | null
  /** Period in days. */
  periodDays: number
  /** Average number of conversations per day. */
  perDayConversations: number | null
  /** Average number of CSAT ratings per day. */
  perDayCsat: number | null
  /** Number of working days in the period (0=Sun..6=Sat). Set by API route (not by searchMetricsForAdmin). */
  workingDays?: number | null
}

type MetricsWindowRaw = {
  total: number
  frtValues: number[]
  resolveValues: number[]
  assignmentCounts: number[]
  reopenCounts: number[]
  csatScores: number[]
}

// Intercom search uses cursor pagination, so a single date range can't be parallelised.
// Splitting the time window into sub-ranges that each paginate independently is the workaround.
async function fetchMetricsWindow(
  adminIdNum: number,
  startTsSec: number,
  endTsSec: number
): Promise<MetricsWindowRaw> {
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
      if (rating && typeof rating.rating === "number") csatScores.push(rating.rating)
    }

    startingAfter = payload.pages?.next?.starting_after
  } while (startingAfter && pageCount < MAX_PAGES)

  return { total, frtValues, resolveValues, assignmentCounts, reopenCounts, csatScores }
}

/**
 * Fetch the agent's conversation metrics from Intercom.
 * Searches conversations assigned to this admin and computes aggregate KPIs
 * from statistics.* and conversation_rating fields returned by the search API.
 *
 * Wide ranges are split into up to 6 parallel sub-windows (~7 days each) to
 * cut wall-clock latency. Each window is capped at 50 pages (7,500 conversations).
 */
export async function searchMetricsForAdmin(
  adminId: string,
  startTsSec: number,
  endTsSec: number
): Promise<AgentMetrics> {
  if (!intercomToken) throw new Error("INTERCOM_ACCESS_TOKEN is not set")

  const adminIdNum = Number(adminId)
  if (!Number.isFinite(adminIdNum)) throw new Error(`Invalid intercom_admin_id: ${adminId}`)

  const PARALLEL_WINDOW_DAYS = 7
  const MAX_PARALLEL_WINDOWS = 6
  const windowSec = Math.max(1, endTsSec - startTsSec)
  const dayCount = Math.ceil(windowSec / 86_400)
  const windowCount = Math.min(
    MAX_PARALLEL_WINDOWS,
    Math.max(1, Math.ceil(dayCount / PARALLEL_WINDOW_DAYS))
  )
  const stride = Math.ceil(windowSec / windowCount)

  const windows: Array<[number, number]> = []
  for (let i = 0; i < windowCount; i++) {
    const s = startTsSec + i * stride
    const e = i === windowCount - 1 ? endTsSec : Math.min(endTsSec, s + stride)
    windows.push([s, e])
  }

  const results = await Promise.all(
    windows.map(([s, e]) => fetchMetricsWindow(adminIdNum, s, e))
  )

  const frtValues = results.flatMap((r) => r.frtValues)
  const resolveValues = results.flatMap((r) => r.resolveValues)
  const assignmentCounts = results.flatMap((r) => r.assignmentCounts)
  const reopenCounts = results.flatMap((r) => r.reopenCounts)
  const csatScores = results.flatMap((r) => r.csatScores)
  const total = results.reduce((sum, r) => sum + r.total, 0)

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

  const days = Math.round((endTsSec - startTsSec) / 86_400) || 1

  return {
    totalConversations: total,
    avgFrtSec: avg(frtValues),
    medianFrtSec: median(frtValues),
    avgTimeToResolveSec: avg(resolveValues),
    avgAssignments: avg(assignmentCounts),
    avgReopens: avg(reopenCounts),
    avgCsat: avg(csatScores),
    csatCount: csatScores.length,
    periodDays: days,
    perDayConversations: total > 0 ? Math.round(total / days) : null,
    perDayCsat: csatScores.length > 0 ? Math.round((csatScores.length / days) * 10) / 10 : null,
  }
}

// --- Macros (canned/saved replies) ------------------------------------------
// Intercom only serves macros under the "Unstable" API version; 2.11 returns
// intercom_version_invalid. Cursor-paginated via pages.next.starting_after.

export interface IntercomMacro {
  intercomId: string
  name: string
  body: string
  bodyText: string | null
  visibility: string
  intercomUpdatedAt: string | null
  raw: unknown
}

/** Fetch all macros from Intercom (follows cursor pagination). */
export async function listIntercomMacros(): Promise<IntercomMacro[]> {
  if (!intercomToken) return []
  const out: IntercomMacro[] = []
  let startingAfter: string | null = null
  // Hard page cap to avoid runaway loops if the cursor never terminates.
  for (let page = 0; page < 50; page++) {
    const url = new URL("https://api.intercom.io/macros")
    url.searchParams.set("per_page", "50")
    if (startingAfter) url.searchParams.set("starting_after", startingAfter)
    const res = await fetchIntercom(url.toString(), {
      headers: {
        Authorization: `Bearer ${intercomToken}`,
        Accept: "application/json",
        "Intercom-Version": "Unstable",
      },
    })
    if (!res.ok) {
      throw new Error(`Intercom macros fetch failed: ${res.status} ${await res.text().catch(() => "")}`)
    }
    const json = (await res.json()) as {
      data?: Array<Record<string, unknown>>
      pages?: { next?: { starting_after?: string } | null } | null
    }
    for (const m of json.data ?? []) {
      const id = m.id
      if (typeof id !== "string") continue
      out.push({
        intercomId: id,
        name: typeof m.name === "string" ? m.name : "(untitled)",
        body: typeof m.body === "string" ? m.body : "",
        bodyText: typeof m.body_text === "string" ? m.body_text : null,
        visibility: typeof m.visible_to === "string" ? m.visible_to : "everyone",
        intercomUpdatedAt: toDate(m.updated_at),
        raw: m,
      })
    }
    const next = json.pages?.next?.starting_after
    if (!next) break
    startingAfter = next
  }
  return out
}

// --- Conversation state -----------------------------------------------------

/** Close an Intercom conversation. Real write — only ever called behind an
    explicit human click (see ADR-0011). Returns true on success. */
export async function closeConversation(
  conversationId: string,
  adminId: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!intercomToken) return { ok: false, status: 500, error: "No Intercom token" }
  const res = await fetchIntercom(
    `https://api.intercom.io/conversations/${conversationId}/parts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${intercomToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Intercom-Version": "2.11",
      },
      body: JSON.stringify({
        message_type: "close",
        type: "admin",
        admin_id: adminId,
      }),
    },
  )
  if (!res.ok) {
    return { ok: false, status: res.status, error: await res.text().catch(() => "") }
  }
  return { ok: true, status: res.status }
}
