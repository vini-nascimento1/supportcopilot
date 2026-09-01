// Shared contract for the Home briefing. Pure types, no I/O, importable from
// both server and client code. Every source (Intercom queue, Slack, Gmail,
// Calendar) is normalized into an AttentionItem; the AI narrative and the UI
// only ever see this shape. Raw provider payloads are never stored on it.
//
// See docs/plans/2026-09-01-home-briefing.md for the design and the mockup at
// docs/plans/home-briefing-mockup.html for the intended rendering.

import type { RiskBand } from "@/lib/reply-queue"

export type AttentionSource = "intercom" | "slack" | "gmail" | "calendar"

export type AttentionKind =
  | "ticket_awaiting_reply" // Intercom non-read conversation assigned to the agent
  | "slack_mention" // channel message mentioning the agent or a user group they belong to
  | "slack_dm" // direct message (im/mpim) to the agent
  | "slack_thread_reply" // reply in a thread the agent posted in
  | "email_action" // unread email that asks the agent for something
  | "email_fyi" // unread email worth seeing, no action
  | "calendar_event" // event today in the agent's timezone

// "now" = the "Needs you now" section. Everything else goes to the calm
// sections (schedule / Slack digest / email digest).
export type AttentionUrgency = "now" | "today" | "later"

export type PreparedSource = {
  // Where the prepared text was grounded. label is human-readable, e.g.
  // "Notion · Payouts & KYC playbook › Name mismatch". url is optional.
  kind: "notion" | "slack" | "macro" | "playbook" | "article" | "case"
  label: string
  url?: string
}

// What the copilot already did for this item. `draft` = a customer reply from
// the reply queue (carries the queue's band + lock semantics unchanged);
// `answer` = a researched reply to a colleague (Slack); `summary` = a digest of
// an email or thread with no reply proposed (money decisions, FYIs).
export type PreparedContent =
  | {
      kind: "draft"
      body: string
      suggestionId: string // suggested_replies.id — approve/reject/edit go through /api/reply-queue/resolve
      band: RiskBand
      // Present when band === "needs_check": the reason the send is locked
      // (e.g. "Verify the charge in fadmin before sending"). Sends stay
      // locked everywhere; on web/mobile the UI shows "Open on desktop".
      lockReason?: string
      sources: PreparedSource[]
    }
  | {
      kind: "answer"
      body: string
      sources: PreparedSource[]
      // Slack destination for "Send in Slack": channel + optional thread ts.
      replyTo: { channelId: string; threadTs?: string }
    }
  | {
      kind: "summary"
      body: string
    }

export type AttentionAction = "reply" | "open" | "mark_seen" | "join"

export type AttentionItem = {
  id: string // stable per item, e.g. `intercom:${conversationId}`, `slack:${channel}:${ts}`
  source: AttentionSource
  kind: AttentionKind
  title: string // short; first names at most, never emails or full names
  context: string // one line under the title
  urgency: AttentionUrgency
  occurredAt: string // ISO
  dueAt?: string // ISO — event start, or when the ticket entered waiting_since
  // Human-readable elapsed/deadline label the UI shows verbatim, e.g.
  // "Waiting 26 min", "in 48 min", "1h ago". Computed server-side so the
  // client needs no clock logic.
  whenLabel: string
  deepLink: string // opens the original in the source (Intercom / Slack / Gmail / Calendar)
  externalId: string
  actions: AttentionAction[]
  prepared?: PreparedContent
  // Set on the item that opened the copilot's research (kind slack_mention/dm)
  // while the research is still running, so the UI can render a skeleton.
  pending?: boolean
}

// Per-source status so the UI can render "connect" / "nothing new" states.
export type SourceStatus =
  | { source: AttentionSource; state: "ok"; count: number }
  | { source: AttentionSource; state: "not_connected" }
  | { source: AttentionSource; state: "error"; message: string }

export type BriefingCounts = {
  now: number
  drafted: number // prepared.kind === "draft"
  researched: number // prepared.kind === "answer"
  locked: number // draft && band === "needs_check"
}

export type Briefing = {
  generatedAt: string // ISO
  since: string // ISO — the window the digests cover (agents.last_seen_at or 24h ago)
  // 1–3 sentences from the model, or the deterministic fallback.
  narrative: string
  narrativeSource: "model" | "fallback"
  counts: BriefingCounts
  items: AttentionItem[] // ranked: "now" first, then by dueAt/occurredAt
  sources: SourceStatus[]
}

export type CalendarItem = AttentionItem & { kind: "calendar_event" }

// Which items qualify for the "Needs you now" section. Kept as a pure function
// so the rule is testable and identical on server and client.
export function isNeedsYouNow(item: AttentionItem, nowMs: number): boolean {
  switch (item.kind) {
    case "ticket_awaiting_reply":
    case "slack_dm":
    case "email_action":
    case "slack_mention":
      // The source decides: tickets, DMs and action emails are always "now"; a
      // personal mention is "now" while a user-group mention (@support-team)
      // is "today" — anyone on the group can take it, so it stays in the
      // digest. Keeping this on urgency means the section and counts.now
      // always agree.
      return item.urgency === "now"
    case "calendar_event": {
      if (!item.dueAt) return false
      const ms = Date.parse(item.dueAt) - nowMs
      return ms >= 0 && ms < 60 * 60 * 1000
    }
    default:
      return false
  }
}

export function countBriefing(items: AttentionItem[]): BriefingCounts {
  let now = 0
  let drafted = 0
  let researched = 0
  let locked = 0
  for (const it of items) {
    if (it.urgency === "now") now++
    if (it.prepared?.kind === "draft") {
      drafted++
      if (it.prepared.band === "needs_check") locked++
    }
    if (it.prepared?.kind === "answer") researched++
  }
  return { now, drafted, researched, locked }
}
