import "server-only"

// Automation engine — monitor sweep runner.
// Loads enabled monitor rules + open cases, evaluates each case against ITS OWNER'S
// rules (rules are per-agent), executes the planned draft-only actions, and records
// matched evaluations in automation_runs. Invoked by /api/automation/sweep (pg_cron).
//
// nowMs is injected (not read from the clock) so sweeps stay deterministic/testable.

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { planCaseActions } from "./engine"
import { runAction, type ActionResult } from "./actions"
import { buildContext, type CaseLike } from "./context"
import type { AutomationRule } from "./types"

export type SweepSummary = {
  ranAt: string
  rulesEvaluated: number
  casesEvaluated: number
  matches: number
  actionsApplied: number
  errors: string[]
}

type RuleRow = {
  id: string
  owner_id: string
  name: string
  kind: "trigger" | "monitor"
  enabled: boolean
  priority: number
  conditions: AutomationRule["conditions"]
  actions: AutomationRule["actions"]
  sweep_every_mins: number | null
  on_events: string[] | null
}

type CaseRow = CaseLike & {
  id: string
  owner_id: string | null
  playbooks?: { case_type: string | null } | null
}

function toRule(r: RuleRow): AutomationRule {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    kind: r.kind,
    enabled: r.enabled,
    priority: r.priority,
    conditions: r.conditions,
    actions: r.actions,
    sweepEveryMins: r.sweep_every_mins,
    onEvents: r.on_events,
  }
}

export type CaseRowForContext = CaseRow

export function caseToContextInput(c: CaseRow): CaseLike {
  // cases has no updated_at column; opened_at (fallback created_at) is the best proxy.
  const updated = c.opened_at ?? c.created_at ?? null
  return {
    intercom_conversation_id: c.intercom_conversation_id,
    intercom_state: c.intercom_state,
    subject: c.summary,
    summary: c.summary,
    tags: c.auto_tags ?? [],
    priority_hint: c.priority_hint,
    is_creator: c.is_creator,
    is_ai_creator: c.is_ai_creator,
    matched_playbook: c.playbooks?.case_type ?? null,
    updated_at: updated,
    opened_at: c.opened_at ?? c.created_at ?? null,
  }
}

export async function runMonitorSweep(nowMs: number): Promise<SweepSummary> {
  const ranAt = new Date(nowMs).toISOString()
  const errors: string[] = []
  const db = getSupabaseAdminClient()
  if (!db) {
    return { ranAt, rulesEvaluated: 0, casesEvaluated: 0, matches: 0, actionsApplied: 0, errors: ["no admin client"] }
  }

  const { data: ruleRows, error: ruleErr } = await db
    .from("automation_rules")
    .select("*")
    .eq("enabled", true)
    .eq("kind", "monitor")
    .order("priority", { ascending: true })
  if (ruleErr) errors.push(`rules: ${ruleErr.message}`)
  const rules = (ruleRows ?? []).map(toRule)

  const { data: caseRows, error: caseErr } = await db
    .from("cases")
    .select("*, playbooks(case_type)")
    .eq("intercom_state", "open")
  if (caseErr) errors.push(`cases: ${caseErr.message}`)
  const cases = (caseRows ?? []) as CaseRow[]

  // Index rules by owner so each case only sees its owner's rules (rules are per-agent).
  const rulesByOwner = new Map<string, AutomationRule[]>()
  for (const r of rules) {
    const list = rulesByOwner.get(r.ownerId) ?? []
    list.push(r)
    rulesByOwner.set(r.ownerId, list)
  }

  let matches = 0
  let actionsApplied = 0

  for (const c of cases) {
    const ownerRules = c.owner_id ? rulesByOwner.get(c.owner_id) ?? [] : []
    if (ownerRules.length === 0) continue

    const ctx = buildContext(caseToContextInput(c), null, nowMs)
    const plan = planCaseActions(ownerRules, ctx)

    for (const { rule, actions } of plan) {
      matches += 1
      const taken: ActionResult[] = []
      for (const action of actions) {
        const res = await runAction(action, {
          ruleId: rule.id,
          ownerId: rule.ownerId,
          caseId: c.id,
          intercomConversationId: c.intercom_conversation_id ?? null,
          nowMs,
        })
        taken.push(res)
        if (res.applied) actionsApplied += 1
        else if (res.detail && !res.detail.startsWith("not implemented")) errors.push(`${rule.name}/${action.kind}: ${res.detail}`)
      }

      // Audit: record only matched evaluations (non-matches would be overwhelming noise).
      const { error: runErr } = await db.from("automation_runs").insert({
        rule_id: rule.id,
        case_id: c.id,
        intercom_conversation_id: c.intercom_conversation_id ?? null,
        matched: true,
        actions_taken: taken,
        context: ctx.fields,
      })
      if (runErr) errors.push(`run insert: ${runErr.message}`)
    }
  }

  return {
    ranAt,
    rulesEvaluated: rules.length,
    casesEvaluated: cases.length,
    matches,
    actionsApplied,
    errors,
  }
}
