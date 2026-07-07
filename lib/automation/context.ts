import "server-only"

// Automation engine — context builder.
// Turns a (live) Intercom conversation + our (DB) case metadata into the
// normalised field bag the engine evaluates. Durations are exposed in SECONDS
// (the unit operators compare in); the UI collects minutes and multiplies by
// 60 before storing the condition value.

import type { SlaStatus } from "@/lib/intercom"
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
  /** Intercom's native SLA state for this conversation. */
  slaStatus: SlaStatus
  /** Unix seconds since the SLA clock started waiting; null when no one is waiting. */
  waitingSinceSec: number | null
  /**
   * Unix seconds of the first HUMAN admin reply (Intercom excludes Fin/bots).
   * Null = no human has replied yet — the FRT "awaiting first response" state.
   */
  firstAdminReplyAtSec: number | null
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

  // SLA waiting time: only meaningful while the clock is actively running.
  // When sla_status is "hit" / "missed" / "cancelled" / "none", the clock
  // either resolved or never started — exposing the field as null lets the
  // condition engine cleanly evaluate "gte / lte" to false instead of firing
  // off stale data (the bug that caused alerts after a reply had landed).
  const waitingSinceSec = conv?.waitingSinceSec ?? null
  const slaStatus: SlaStatus = conv?.slaStatus ?? "none"
  const timeWaitingSeconds =
    slaStatus === "active" && waitingSinceSec != null
      ? Math.max(0, Math.floor(nowMs / 1000) - waitingSinceSec)
      : null

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
    // SLA fields sourced from Intercom's sla_applied + waiting_since. Use these
    // for "alert before breach" / "alert on breach" rules instead of trying to
    // compute a countdown from createdAt — Intercom already knows whether an
    // admin reply has landed and stops the clock accordingly.
    sla_status: slaStatus,
    time_waiting_seconds: timeWaitingSeconds,
    // A human teammate has replied. Sourced from Intercom's first_admin_reply_at,
    // which EXCLUDES Fin/bot replies — so `false` = "awaiting first human response"
    // (FRT-relevant) even if Fin already messaged. Lets a rule target FRT and skip
    // TTC/already-answered cases, which share the same single SLA name.
    admin_replied: conv ? conv.firstAdminReplyAtSec != null : null,
    event,
  }
  return { fields }
}
