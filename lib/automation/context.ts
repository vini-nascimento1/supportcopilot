import "server-only"

// Automation engine — context builder.
// Turns a (live) Intercom conversation + our (DB) case metadata into the
// normalised field bag the engine evaluates. Durations are exposed in SECONDS
// (the unit operators compare in); the UI collects minutes and multiplies by
// 60 before storing the condition value.

import type { EvalContext, FieldValue } from "./types"

/** Intercom-derived fields (live during sweep, event payload during triggers). */
export type ConversationLive = {
  intercomConversationId: string
  intercomState: string | null
  subject: string | null
  tags: string[]
  customerName: string | null
  isCreator: boolean | null
  priority: string | null
  createdAt: string | null
  updatedAt: string | null
  /** Intercom admin_assignee_id — the teammate assigned to this conversation. */
  adminAssigneeId: string | null
}

/** Our DB metadata about a case (rule-set state + playbook link). */
export type CaseMeta = {
  caseId: string | null
  priorityHint: string | null
  autoTags: string[]
  /** `case_type` of the linked playbook — surfaces in the eval as `matched_playbook`. */
  matchedPlaybook: string | null
}

function ageSeconds(iso: string | null | undefined, nowMs: number): number | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return undefined
  return Math.max(0, Math.floor((nowMs - t) / 1000))
}

/**
 * Build the evaluation context for a case.
 * @param conv   Intercom-side state (live for sweeps, event payload for triggers). Null is allowed for tests.
 * @param meta   DB metadata; null when no `cases` row exists yet (first-time webhook).
 * @param event  the Intercom event key (triggers); omit for monitor sweeps.
 * @param nowMs  current time in ms — passed in (not read from the clock) so the
 *               engine + sweeps stay deterministic and testable.
 */
export function buildContext(
  conv: ConversationLive | null,
  meta: CaseMeta | null,
  event: string | null,
  nowMs: number
): EvalContext {
  const updatedAt = conv?.updatedAt ?? null
  const openedAt = conv?.createdAt ?? null
  const openedAgeSec = ageSeconds(openedAt, nowMs)

  const fields: Record<string, FieldValue> = {
    status: conv?.intercomState ?? null,
    subject: conv?.subject ?? null,
    // tags = Intercom-side tags (applied by admins in Intercom).
    // auto_tags = tags written by OUR rule actions (case.flag add_tags).
    // Keeping them separate prevents rule self-loops: a rule that adds 'urgent'
    // to auto_tags and conditions on `tags contains 'urgent'` would otherwise
    // re-fire on every sweep.
    tags: conv?.tags ?? [],
    auto_tags: meta?.autoTags ?? [],
    // priority_hint = our rule-set state. priority = Intercom's native priority
    // flag (set by admins in the Intercom UI). Both are exposed independently.
    priority_hint: meta?.priorityHint ?? null,
    priority: conv?.priority ?? null,
    is_creator: conv?.isCreator ?? null,
    matched_playbook: meta?.matchedPlaybook ?? null,
    time_since_update: ageSeconds(updatedAt, nowMs),
    time_since_created: openedAgeSec,
    // Teammate = the Intercom admin assigned to this conversation.
    // Rules without a teammate condition are "global" — they evaluate against
    // all agents' queues. Rules with `teammate is <id>` are scoped to that agent.
    teammate: conv?.adminAssigneeId ?? null,
    // First-response countdown: minutes elapsed since conversation opened.
    // The evaluator subtracts this from the SLA threshold (stored per-condition
    // in `cond.sla`) to compute time remaining. This way the agent gets alerted
    // BEFORE the breach, not after.
    first_response_minutes: openedAgeSec != null ? Math.floor(openedAgeSec / 60) : null,
    event,
  }
  return { fields }
}
