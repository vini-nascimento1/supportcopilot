// Pure routing logic for the autonomous non-read reply queue. No I/O and no
// `server-only` (mirrors lib/playbook-gate.ts and lib/automation/engine.ts) so
// it is unit-tested. The I/O lives in lib/reply-queue-store.ts (service role)
// and the webhook pipeline. See
// FanvueSupport/Engineering/Plan - Autonomous non-read reply queue.md (D6, D9).

export type RiskBand = "ready" | "needs_check" | "low_confidence"
export type SuggestionStatus = "pending" | "approved" | "superseded" | "stale"

// Capability-gap categories: the AI can draft the safe part, but a human must
// verify in fadmin before sending. Hard-coded and non-overridable (D6 + the
// non-negotiables of Plan - Autonomous triage agent (vision): financial, KYC,
// media, bans, moderation/compliance). Matched against Intercom conversation
// tags as case-insensitive substrings. NOTE: confirm/extend this set against
// Fanvue's real Intercom tag vocabulary before go-live.
export const LOCKED_CATEGORIES = [
  "payout",
  "masspay",
  "triplea",
  "financial",
  "kyc",
  "media",
  "ban",
  "moderation",
  "compliance",
] as const

// "Non-read" = waiting on us: the last message in the thread is the customer's.
// Intercom author types: user / lead / contact = customer; admin / bot = us.
export function isNonRead(lastAuthorType: string | null | undefined): boolean {
  if (!lastAuthorType) return false
  const t = lastAuthorType.toLowerCase()
  return t === "user" || t === "lead" || t === "contact"
}

// A capability gap exists when any conversation tag matches a locked category.
// Case-insensitive and substring-tolerant — Intercom tags vary in the wild
// ("payout", "Payout Issue", "kyc-review", "Banned user"...).
export function hasCapabilityGap(tags: readonly string[] | null | undefined): boolean {
  if (!tags || tags.length === 0) return false
  return tags.some((raw) => {
    const tag = raw.toLowerCase()
    return LOCKED_CATEGORIES.some((cat) => tag.includes(cat))
  })
}

export type RiskBandInput = {
  capabilityGap: boolean
  gateMatched: boolean // gate found a playbook at/above threshold (head)
  notionHadHits: boolean // tail: notion ai_search returned snippets
  // The matched playbook is flagged requires_manual_action: the agent must do a
  // manual system step (e.g. resend a payout email) that the AI can't. Force the
  // card into needs_check so the send is locked until a human acts.
  playbookRequiresManualAction?: boolean
}

// Decide the queue band (D6/D9):
//   - capability gap                 -> needs_check (send LOCKED), regardless of anything else
//   - matched playbook needs a manual step -> needs_check (send LOCKED)
//   - head (playbook match)          -> ready
//   - tail with Notion hits          -> ready
//   - tail, weak/no Notion           -> low_confidence (enters queue, send NOT locked)
export function deriveRiskBand(input: RiskBandInput): RiskBand {
  if (input.capabilityGap) return "needs_check"
  if (input.playbookRequiresManualAction) return "needs_check"
  if (input.gateMatched) return "ready"
  if (input.notionHadHits) return "ready"
  return "low_confidence"
}

// The send button is locked only for capability-gap cards.
export function isSendLocked(band: RiskBand): boolean {
  return band === "needs_check"
}

// Did the agent meaningfully edit the AI draft before sending, or just
// reformat whitespace? Normalize both sides (trim + collapse all whitespace
// runs, including newlines, to a single space) before comparing so line-break
// or spacing-only differences don't count as an edit. Used by the reply-queue
// audit log (reply_queue_events.body_changed) to derive the flag from the
// actual final text rather than trusting a caller-supplied boolean.
export function hasBodyChanged(suggested: string, final: string): boolean {
  const normalize = (s: string) => s.trim().replace(/\s+/g, " ")
  return normalize(suggested) !== normalize(final)
}

// Map an Intercom webhook topic to the actor whose action it represents:
//   conversation.user.created / .user.replied / contact.* / lead.* -> "customer"  (recompute)
//   conversation.admin.replied (an agent answered)                 -> "agent_reply" (leaves the queue)
//   anything else (assigned, noted, closed, tag.*, ...)            -> "other"     (ignore)
export function classifyWebhookTopic(
  topic: string | null | undefined
): "customer" | "agent_reply" | "other" {
  if (!topic) return "other"
  const t = topic.toLowerCase()
  if (t.includes("admin") && t.includes("repl")) return "agent_reply"
  if (
    (t.includes("user") || t.includes("contact") || t.includes("lead")) &&
    (t.includes("repl") || t.includes("creat"))
  ) {
    return "customer"
  }
  return "other"
}
