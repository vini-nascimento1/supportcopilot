import "server-only"

import { getNonReadAssignedConversations, type NonReadConversation } from "@/lib/intercom"
import { getPendingSuggestionsForAgent, type QueueItem } from "@/lib/reply-queue-store"
import type {
  AttentionItem,
  PreparedSource,
  SourceStatus,
} from "@/lib/briefing/types"
import {
  MAX_CONTEXT_CHARS,
  MAX_TITLE_CHARS,
  deriveLockReason,
  firstNameOf,
  sanitizeLine,
  waitingLabel,
} from "@/lib/briefing/format"

// Intercom half of the Home briefing. Deliberately reuses the exact two reads
// the Canvas queue already runs — getNonReadAssignedConversations (live
// membership) and getPendingSuggestionsForAgent (the cached drafts) — and
// reconciles them the same way /api/reply-queue does: a cached draft whose
// conversation has left the non-read set is not shown, and a non-read
// conversation with no draft yet is shown as `pending` with no prepared reply.
// Nothing is drafted, sent or staled from here; the briefing is read-only.

/** How many ticket rows a single briefing will carry. */
export const MAX_TICKET_ITEMS = 12

function intercomDeepLink(conversationId: string): string {
  const appId = process.env.INTERCOM_APP_ID
  if (!appId) return "/cases"
  return `https://app.intercom.com/a/inbox/${appId}/inbox/conversation/${conversationId}`
}

/**
 * Map the queue row's free-form source kinds (retrieval `source_kind`, Notion
 * result `type`) onto the closed set the briefing contract allows. Unknown
 * kinds come in through the Notion connector, so they land on "notion".
 */
export function toPreparedSourceKind(raw: string | undefined): PreparedSource["kind"] {
  switch ((raw ?? "").toLowerCase()) {
    case "slack":
      return "slack"
    case "macro":
    case "response":
      return "macro"
    case "playbook":
      return "playbook"
    case "article":
    case "intercom_article":
      return "article"
    case "case":
    case "conversation":
      return "case"
    default:
      return "notion"
  }
}

export function toPreparedSources(sources: QueueItem["sources"]): PreparedSource[] {
  return (sources ?? [])
    .filter((s) => Boolean(s?.title))
    .slice(0, 5)
    .map((s) => ({
      kind: toPreparedSourceKind(s.kind),
      label: sanitizeLine(s.title, MAX_TITLE_CHARS),
      ...(s.url ? { url: s.url } : {}),
    }))
}

/**
 * One non-read conversation → one AttentionItem. Pure: the caller supplies the
 * matching queue row (or null when the draft hasn't been written yet) and the
 * conversation's tags, so the whole normalizer is fixture-testable.
 */
export function toTicketItem(
  conversation: NonReadConversation,
  draft: QueueItem | null,
  nowMs: number,
  tags?: readonly string[] | null
): AttentionItem {
  const customer = firstNameOf(conversation.customer, "a customer")
  const base: AttentionItem = {
    id: `intercom:${conversation.id}`,
    source: "intercom",
    kind: "ticket_awaiting_reply",
    title: `Reply to ${customer}`,
    context: sanitizeLine(draft?.subject ?? conversation.subject, MAX_CONTEXT_CHARS),
    // A customer waiting on us is always the top band — the FRT clock is
    // already running (see lib/inbox-sla.ts).
    urgency: "now",
    occurredAt: conversation.waitingSince ?? new Date(nowMs).toISOString(),
    ...(conversation.waitingSince ? { dueAt: conversation.waitingSince } : {}),
    whenLabel: waitingLabel(conversation.waitingSince, nowMs),
    deepLink: intercomDeepLink(conversation.id),
    externalId: conversation.id,
    actions: draft ? ["reply", "open"] : ["open"],
  }

  if (!draft) return { ...base, pending: true }

  const lockReason = deriveLockReason({ band: draft.riskBand, tags })

  return {
    ...base,
    prepared: {
      kind: "draft",
      body: draft.body,
      suggestionId: draft.id,
      band: draft.riskBand,
      ...(lockReason ? { lockReason } : {}),
      sources: toPreparedSources(draft.sources),
    },
  }
}

export type IntercomSourceResult = { items: AttentionItem[]; status: SourceStatus }

/**
 * Live read. `adminId` null (no Intercom admin on the agent row and no env
 * fallback) is reported as not_connected rather than an error — nothing is
 * broken, the agent just has no Intercom identity mapped yet.
 */
export async function collectIntercomItems(opts: {
  agentId: string
  adminId: string | null
  nowMs: number
}): Promise<IntercomSourceResult> {
  if (!opts.adminId) {
    return { items: [], status: { source: "intercom", state: "not_connected" } }
  }

  const [pending, nonRead] = await Promise.all([
    getPendingSuggestionsForAgent(opts.agentId),
    getNonReadAssignedConversations(opts.adminId),
  ])

  // Intercom unreachable — say so instead of silently reporting an empty queue.
  if (!nonRead) {
    return {
      items: [],
      status: { source: "intercom", state: "error", message: "Intercom is unreachable right now." },
    }
  }

  const draftByConversation = new Map<string, QueueItem>()
  for (const p of pending) {
    if (!draftByConversation.has(p.intercomConversationId)) {
      draftByConversation.set(p.intercomConversationId, p)
    }
  }

  const items = nonRead
    .slice(0, MAX_TICKET_ITEMS)
    .map((c) => toTicketItem(c, draftByConversation.get(c.id) ?? null, opts.nowMs))

  return { items, status: { source: "intercom", state: "ok", count: items.length } }
}
