import "server-only"

import { getInboxThreads, type GmailThreadSummary } from "@/lib/gmail-client"
import type { AttentionItem, AttentionKind, SourceStatus } from "@/lib/briefing/types"
import { MAX_CONTEXT_CHARS, MAX_TITLE_CHARS, agoLabel, firstNameOf, sanitizeLine } from "@/lib/briefing/format"

// Gmail half of the Home briefing.
//
// SECURITY NOTE (v1): nothing from email reaches a model. The classification
// below is a keyword heuristic, and `prepared` is a deterministic summary built
// from the subject and Gmail's own snippet — no generation, no research call.
// The narrative model never sees item bodies at all (see narrative.ts), so an
// instruction planted in an email cannot reach a prompt through this source.

export const MAX_EMAIL_ITEMS = 8

/**
 * Senders whose mail is operationally load-bearing for support: the payout and
 * identity providers. A message from one of these is an action by default.
 * Matched against the sender's domain, lowercased.
 */
export const PARTNER_SENDER_FRAGMENTS = [
  "masspay",
  "ondato",
  "triplea",
  "triple-a",
  "intercom",
] as const

/** Phrases that turn an email into something the agent has to do. */
export const ACTION_PHRASES = [
  "can you",
  "could you",
  "please",
  "confirm",
  "approve",
  "action required",
  "by eod",
  "by end of day",
  "needs your",
  "waiting on you",
  "reply",
  "deadline",
] as const

export function isPartnerSender(from: string | null | undefined): boolean {
  const lower = (from ?? "").toLowerCase()
  return PARTNER_SENDER_FRAGMENTS.some((f) => lower.includes(f))
}

/**
 * `email_action` vs `email_fyi`. Deliberately a small, readable rule set rather
 * than a model call: the cost of a wrong guess here is one row in the wrong
 * digest, and v1 sends nothing from email to the model.
 */
export function classifyEmail(thread: {
  from: string | null | undefined
  subject: string | null | undefined
  snippet: string | null | undefined
}): AttentionKind {
  if (isPartnerSender(thread.from)) return "email_action"
  const haystack = `${thread.subject ?? ""} ${thread.snippet ?? ""}`.toLowerCase()
  if (haystack.includes("?")) return "email_action"
  if (ACTION_PHRASES.some((p) => haystack.includes(p))) return "email_action"
  return "email_fyi"
}

/** One Gmail thread → one AttentionItem. Pure. */
export function toEmailItem(thread: GmailThreadSummary, nowMs: number): AttentionItem {
  const kind = classifyEmail(thread)
  const sender = firstNameOf(thread.fromName || thread.from, "a sender")
  const subject = sanitizeLine(thread.subject, MAX_TITLE_CHARS) || "(No subject)"
  const snippet = sanitizeLine(thread.snippet, MAX_CONTEXT_CHARS)

  return {
    id: `gmail:${thread.id}`,
    source: "gmail",
    kind,
    title: subject,
    context: snippet ? `From ${sender} · ${snippet}` : `From ${sender}`,
    // An email that asks for something is a "today" job, not a now one: the
    // customer clock is not running on it the way it is on an Intercom ticket.
    urgency: kind === "email_action" ? "today" : "later",
    occurredAt: thread.date,
    whenLabel: agoLabel(thread.date, nowMs),
    deepLink: `https://mail.google.com/mail/u/0/#inbox/${thread.id}`,
    externalId: thread.id,
    actions: ["open", "mark_seen"],
    prepared: {
      kind: "summary",
      // Subject + snippet only. No model, no thread body, no attachments.
      body: snippet ? `${subject} — ${snippet}` : subject,
    },
  }
}

export type GmailSourceResult = { items: AttentionItem[]; status: SourceStatus }

export async function collectGmailItems(opts: {
  googleToken: string | null
  email: string | null
  sinceMs: number
  nowMs: number
}): Promise<GmailSourceResult> {
  if (!opts.googleToken) {
    return { items: [], status: { source: "gmail", state: "not_connected" } }
  }

  // Gmail's search accepts an epoch-seconds `after:` — narrower than pulling
  // the whole inbox and filtering client-side.
  const afterSeconds = Math.floor(opts.sinceMs / 1000)
  const result = await getInboxThreads(
    opts.googleToken,
    opts.email,
    null,
    `in:inbox is:unread after:${afterSeconds}`
  )

  if (!result.connected) {
    return {
      items: [],
      status: { source: "gmail", state: "error", message: "Couldn't read your inbox." },
    }
  }

  const items = result.threads
    .filter((t) => t.isUnread)
    .slice(0, MAX_EMAIL_ITEMS)
    .map((t) => toEmailItem(t, opts.nowMs))

  return { items, status: { source: "gmail", state: "ok", count: items.length } }
}
