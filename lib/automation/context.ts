import "server-only"

// Automation engine — context builder.
// Turns a case (DB row and/or Intercom event) into the normalised field bag the
// engine evaluates. Durations are exposed in SECONDS (the unit operators compare in);
// the UI collects minutes and multiplies by 60 before storing the condition value.

import type { EvalContext, FieldValue } from "./types"

/** Minimal shape we can build a context from today (superset is fine). */
export type CaseLike = {
  intercom_conversation_id?: string | null
  intercom_state?: string | null
  subject?: string | null
  snippet?: string | null
  summary?: string | null
  tags?: string[] | null
  auto_tags?: string[] | null
  priority_hint?: string | null
  is_creator?: boolean | null
  is_ai_creator?: boolean | null
  matched_playbook?: string | null
  updated_at?: string | null
  updatedAt?: string | null
  opened_at?: string | null
  created_at?: string | null
}

function ageSeconds(iso: string | null | undefined, nowMs: number): number | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return undefined
  return Math.max(0, Math.floor((nowMs - t) / 1000))
}

/**
 * Build the evaluation context for a case.
 * @param event  the Intercom event key (triggers); omit for monitor sweeps.
 * @param nowMs  current time in ms — passed in (not read from the clock) so the
 *               engine + sweeps stay deterministic and testable.
 */
export function buildContext(c: CaseLike, event: string | null, nowMs: number): EvalContext {
  const updated = c.updated_at ?? c.updatedAt ?? null
  const fields: Record<string, FieldValue> = {
    // Source of truth: the real Intercom conversation state (open/closed/snoozed).
    status: c.intercom_state ?? null,
    subject: c.subject ?? c.snippet ?? c.summary ?? null,
    tags: c.tags ?? c.auto_tags ?? [],
    priority_hint: c.priority_hint ?? null,
    is_creator: c.is_creator ?? null,
    is_ai_creator: c.is_ai_creator ?? null,
    matched_playbook: c.matched_playbook ?? null,
    time_since_update: ageSeconds(updated, nowMs),
    time_since_created: ageSeconds(c.opened_at, nowMs),
    // First-response countdown: minutes elapsed since conversation opened.
    // The evaluator subtracts this from the SLA threshold (stored per-condition
    // in `cond.sla`) to compute time remaining. This way the agent gets alerted
    // BEFORE the breach, not after.
    first_response_minutes: ageSeconds(c.opened_at, nowMs) != null
      ? Math.floor(ageSeconds(c.opened_at, nowMs)! / 60)
      : null,
    event,
  }
  return { fields }
}
