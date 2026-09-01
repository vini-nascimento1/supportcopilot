import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import {
  getAgentUserGroups,
  getSlackUserId,
  getUnreadDms,
  searchMentions,
  type SlackBriefingMessage,
} from "@/lib/slack"
import type { AttentionItem, SourceStatus } from "@/lib/briefing/types"
import { MAX_CONTEXT_CHARS, agoLabel, firstNameOf, sanitizeLine } from "@/lib/briefing/format"

// Slack half of the Home briefing. Scope, decided in the plan and enforced here:
//   • DMs and group DMs sent TO the agent since `since`
//   • channel messages that mention the agent personally, or a user group they
//     belong to (@support-team)
// Nothing else. No whole channels, no other people's threads, no thread replies
// to the agent's own messages (v2). The agent's own messages are dropped by the
// lib/slack.ts helpers before they reach here.

export const MAX_SLACK_ITEMS = 10

/** The raw message behind an item, kept in memory for research.ts only. */
export type SlackItemContext = {
  item: AttentionItem
  message: SlackBriefingMessage
  /** Personal `<@U…>` mention, a user-group mention, or a DM. */
  reason: "dm" | "mention" | "group_mention"
}

export type SlackSourceResult = {
  items: AttentionItem[]
  /** Parallel to `items`, keyed by item id. Never persisted, never cached. */
  contexts: Map<string, SlackItemContext>
  status: SourceStatus
}

function fallbackPermalink(message: SlackBriefingMessage): string {
  if (message.permalink) return message.permalink
  return `https://slack.com/archives/${message.channelId}/p${message.ts.replace(".", "")}`
}

/**
 * Field labels a Slack workflow post puts after the ticket title. Used only to
 * find where the title stops — nothing else is read out of the payload.
 */
const TICKET_FIELD_LABELS = [
  "Creator Email Address",
  "Fan Email Address",
  "Email Address",
  "Creator Email",
  "Ticket Description",
  "Ticket Link",
  "Ticket Type",
  "Description",
  "Requester",
  "Assignee",
  "Priority",
  "Category",
  "Created By",
  "Username",
  "Status",
]

/**
 * Pull the ticket title out of a workflow post ("… assigned to you: *Ticket
 * Title* Creator cannot withdraw *Creator Email Address* …").
 *
 * Deliberately conservative: the title must be bounded by a known field label
 * or a line break, and be a plausible length. Anything else returns null and
 * the caller falls back to the sanitized message text, so a workflow we have
 * never seen degrades to today's behaviour rather than to a wrong headline.
 */
export function extractTicketTitle(rawText: string): string | null {
  const text = rawText ?? ""
  const marker = /ticket title\s*[*_`:\-–]*\s*/i.exec(text)
  if (!marker) return null

  const rest = text.slice(marker.index + marker[0].length)
  const lower = rest.toLowerCase()
  let cut = -1
  for (const label of TICKET_FIELD_LABELS) {
    const at = lower.indexOf(label.toLowerCase())
    if (at >= 0 && (cut < 0 || at < cut)) cut = at
  }
  if (cut < 0) cut = rest.indexOf("\n", 1)
  if (cut < 0) return null

  const title = rest.slice(0, cut).replace(/[\s*_`>|:-]+$/g, "").trim()
  if (title.length < 3 || title.length > 160) return null
  return title
}

/**
 * One Slack message → one AttentionItem. Pure so the DM/mention split, the
 * urgency rule and the sanitized context line are fixture-testable.
 *
 * A personal mention or a DM is "now" (someone is waiting on this agent
 * specifically); a user-group mention is "today" — anyone on the group can take
 * it, so it must not shout as loudly as a direct ask.
 *
 * A workflow/bot post (`message.isBot`) is an EVENT, not a person: "Raise" did
 * not mention anyone, it raised a ticket. So it gets event wording, only an
 * "open" action, and research.ts refuses to draft a reply to it — answering a
 * workflow bot in Slack would be noise at best.
 */
export function toSlackItem(
  message: SlackBriefingMessage,
  reason: SlackItemContext["reason"],
  nowMs: number
): AttentionItem {
  const isDm = reason === "dm"
  const occurredAt = new Date(message.tsSeconds * 1000).toISOString()
  const base = {
    id: `slack:${message.channelId}:${message.ts}`,
    source: "slack" as const,
    occurredAt,
    whenLabel: agoLabel(occurredAt, nowMs),
    deepLink: fallbackPermalink(message),
    externalId: message.ts,
  }

  if (message.isBot && !isDm) {
    const botName = message.botName || message.userName || "A workflow"
    const text = message.text ?? ""
    const looksLikeTicket =
      /raise/i.test(botName) || /ticket has been created|new .{0,40}ticket/i.test(text)
    const ticketTitle = extractTicketTitle(text)

    return {
      ...base,
      kind: "slack_mention",
      title: looksLikeTicket
        ? `New ticket raised in #${message.channelName}`
        : `${botName} posted in #${message.channelName}`,
      context: sanitizeLine(ticketTitle ?? text, MAX_CONTEXT_CHARS),
      // "assigned to you" is the one phrase that makes a workflow post personal.
      urgency: /assigned to you/i.test(text) ? "now" : "today",
      actions: ["open"],
    }
  }

  const sender = firstNameOf(message.userName)

  return {
    ...base,
    kind: isDm ? "slack_dm" : "slack_mention",
    title: isDm ? `${sender} messaged you` : `${sender} mentioned you in #${message.channelName}`,
    context: sanitizeLine(message.text, MAX_CONTEXT_CHARS),
    urgency: reason === "group_mention" ? "today" : "now",
    actions: ["reply", "open"],
  }
}

/** Did this message name the agent personally, or just a group they are in? */
export function mentionReason(
  message: SlackBriefingMessage,
  userId: string
): "mention" | "group_mention" {
  // lib/slack.ts sets mentionsSelf from the raw text before humanizing it;
  // the raw-markup check is the fallback for messages built elsewhere.
  const personal = message.mentionsSelf ?? message.text.includes(`<@${userId}>`)
  return personal ? "mention" : "group_mention"
}

/**
 * Resolve the agent's Slack user id, preferring the stored column and falling
 * back to auth.test. A lazily-resolved id is written back so the next briefing
 * skips the round trip (the OAuth callback stores it for new connections).
 */
export async function resolveSlackUserId(opts: {
  email: string
  token: string
  storedUserId: string | null
}): Promise<string | null> {
  if (opts.storedUserId) return opts.storedUserId

  const resolved = await getSlackUserId(opts.token)
  if (!resolved) return null

  const db = getSupabaseAdminClient()
  if (db) {
    await db
      .from("agents")
      .update({ slack_user_id: resolved })
      .eq("email", opts.email)
      .then(undefined, () => {}) // best-effort backfill; never blocks a briefing
  }
  return resolved
}

export async function collectSlackItems(opts: {
  email: string
  slackToken: string | null
  storedUserId: string | null
  sinceMs: number
  nowMs: number
}): Promise<SlackSourceResult> {
  const empty = new Map<string, SlackItemContext>()

  if (!opts.slackToken) {
    return { items: [], contexts: empty, status: { source: "slack", state: "not_connected" } }
  }

  const userId = await resolveSlackUserId({
    email: opts.email,
    token: opts.slackToken,
    storedUserId: opts.storedUserId,
  })
  if (!userId) {
    return {
      items: [],
      contexts: empty,
      status: { source: "slack", state: "error", message: "Slack needs reconnecting in Settings." },
    }
  }

  const sinceUnix = Math.floor(opts.sinceMs / 1000)
  const groups = await getAgentUserGroups(opts.slackToken, userId)

  const [dms, mentions] = await Promise.all([
    getUnreadDms(opts.slackToken, sinceUnix),
    searchMentions(opts.slackToken, {
      userId,
      groupIds: groups.map((g) => g.id),
      sinceUnix,
    }),
  ])

  const contexts = new Map<string, SlackItemContext>()
  const items: AttentionItem[] = []

  const push = (message: SlackBriefingMessage, reason: SlackItemContext["reason"]) => {
    const item = toSlackItem(message, reason, opts.nowMs)
    if (contexts.has(item.id)) return
    contexts.set(item.id, { item, message, reason })
    items.push(item)
  }

  for (const dm of dms) push(dm, "dm")
  for (const mention of mentions) push(mention, mentionReason(mention, userId))

  // Newest first, then cap. DMs and personal mentions naturally win the ranking
  // in build.ts because they carry urgency "now".
  items.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  const capped = items.slice(0, MAX_SLACK_ITEMS)
  const cappedIds = new Set(capped.map((i) => i.id))
  for (const id of [...contexts.keys()]) {
    if (!cappedIds.has(id)) contexts.delete(id)
  }

  return {
    items: capped,
    contexts,
    status: { source: "slack", state: "ok", count: capped.length },
  }
}
