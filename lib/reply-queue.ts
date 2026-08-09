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

// ── Evidence-based banding (retrieval v2) ──────────────────────────────────
//
// The v1 rule above promotes ANY gate match straight to "ready". That is
// backwards: playbook-matched drafts were approved 57.6% of the time versus
// 67.5% when nothing matched (n=1,201 reply_queue_events). A wrong match
// corrupted the prompt AND raised the trust signal, so the worst drafts
// arrived wearing the highest-confidence badge.
//
// v2 keys off how good the retrieved evidence actually was. Same three band
// values, so the UI, send-lock and audit log are unchanged.

export type EvidenceBandInput = {
  capabilityGap: boolean
  playbookRequiresManualAction?: boolean
  /** Retrieval deliberately returned nothing (below the score floor). */
  abstained: boolean
  /** Fused score of the top passage, if any. */
  topScore: number | null
  /** Passages found by BOTH the vector and lexical arms — the strongest signal. */
  agreedCount: number
  /** How many passages the customer-facing reply may actually be grounded on. */
  customerSafeCount: number
}

/**
 * "ready" now requires real corroboration: at least one passage that both
 * retrieval arms agreed on, and something customer-safe to ground the reply in.
 * A confident-but-unsupported draft lands in low_confidence where it belongs,
 * instead of being waved through.
 */
export function deriveEvidenceRiskBand(input: EvidenceBandInput): RiskBand {
  if (input.capabilityGap) return "needs_check"
  if (input.playbookRequiresManualAction) return "needs_check"

  // Abstaining is a correct, deliberate outcome — but the draft is then written
  // from the thread alone, so it must not claim to be grounded.
  if (input.abstained) return "low_confidence"

  // Internal-only evidence can inform what the agent does, never what the
  // customer is told. Nothing customer-safe means nothing to ground a reply on.
  if (input.customerSafeCount === 0) return "low_confidence"

  if (input.agreedCount > 0) return "ready"

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
