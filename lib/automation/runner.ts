import "server-only"

// Automation engine — monitor sweep runner.
// Live-Intercom architecture: cases are fetched from Intercom (not from our DB)
// per agent's `intercom_admin_id`. We then JOIN our DB metadata (playbook_id,
// outcome, priority_hint, auto_tags) by intercom_conversation_id. Cases with no
// metadata row yet are evaluated with empty meta — and if a rule fires we
// upsert the minimal row so actions like `case.flag` have something to write to.
//
// nowMs is injected (not read from the clock) so sweeps stay deterministic/testable.

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { searchOpenConversationsForAdmin, type SweepConversation } from "@/lib/intercom"
import { planCaseActions } from "./engine"
import { runAction, type ActionResult } from "./actions"
import { buildContext, type CaseMeta, type ConversationLive } from "./context"
import type { AutomationRule } from "./types"

export type SweepSummary = {
  ranAt: string
  rulesEvaluated: number
  casesEvaluated: number
  matches: number
  actionsApplied: number
  errors: string[]
}

type DbClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>

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

type CaseMetaRow = {
  id: string
  intercom_conversation_id: string | null
  owner_id: string | null
  priority_hint: string | null
  auto_tags: string[] | null
  // PostgREST embeds to-one FKs as an object, but supabase-js generated types
  // sometimes type it as array — accept both at runtime.
  playbooks?: { case_type: string | null } | Array<{ case_type: string | null }> | null
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

export function sweepConversationToLive(c: SweepConversation): ConversationLive {
  return {
    intercomConversationId: c.id,
    intercomState: c.intercomState,
    subject: c.subject,
    tags: c.tags,
    customerName: c.customerName,
    isCreator: c.isCreator,
    priority: c.priority,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    adminAssigneeId: c.adminAssigneeId,
  }
}

export function metaRowToCaseMeta(row: CaseMetaRow | null): CaseMeta {
  if (!row) {
    return { caseId: null, priorityHint: null, autoTags: [], matchedPlaybook: null }
  }
  const pb = Array.isArray(row.playbooks) ? row.playbooks[0] : row.playbooks
  return {
    caseId: row.id,
    priorityHint: row.priority_hint,
    autoTags: row.auto_tags ?? [],
    matchedPlaybook: pb?.case_type ?? null,
  }
}


/** Filter rules whose `sweep_every_mins` interval has elapsed since last run.
 *  Rules with no interval set (null) are always eligible.
 *  On query failure the full set passes through (fail-open). */
async function filterEligibleRules(
  db: DbClient,
  rules: AutomationRule[],
  nowMs: number
): Promise<AutomationRule[]> {
  const intervalRules = rules.filter((r) => r.sweepEveryMins != null)
  if (intervalRules.length === 0) return rules

  const ruleIds = intervalRules.map((r) => r.id)
  const { data: runs } = await db
    .from("automation_runs")
    .select("rule_id, ran_at")
    .eq("source", "sweep")
    .in("rule_id", ruleIds)
    .order("ran_at", { ascending: false })
    .limit(10000)

  const lastRunByRule = new Map<string, number>()
  for (const r of runs ?? []) {
    if (!lastRunByRule.has(r.rule_id)) {
      lastRunByRule.set(r.rule_id, new Date(r.ran_at).getTime())
    }
  }

  return rules.filter((r) => {
    if (r.sweepEveryMins == null) return true
    const lastRun = lastRunByRule.get(r.id)
    if (lastRun == null) return true // never run before
    return nowMs - lastRun >= r.sweepEveryMins * 60_000
  })
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
  const allRules = (ruleRows ?? []).map(toRule)

  // Filter by sweep interval — skip rules that haven't reached their cadence.
  const rules = await filterEligibleRules(db, allRules, nowMs)
  const skippedCount = allRules.length - rules.length
  if (skippedCount > 0) errors.push(`skipped ${skippedCount} rule(s) — sweep interval not yet elapsed`)

  if (rules.length === 0) {
    return { ranAt, rulesEvaluated: 0, casesEvaluated: 0, matches: 0, actionsApplied: 0, errors }
  }

  // Fetch the FULL open queue once (not per agent). The per-agent fetch left
  // cross-team rules — e.g. "alert me on any SLA breach across the team" —
  // silently dead because conversations assigned to non-agents (Fin, other
  // teammates without an agents row) were never seen. The condition engine
  // still filters by `teammate is X` when the user wants a personal scope.
  let liveConvs: SweepConversation[]
  try {
    liveConvs = await searchOpenConversationsForAdmin()
  } catch (e) {
    errors.push(`intercom search: ${(e as Error).message}`)
    return { ranAt, rulesEvaluated: rules.length, casesEvaluated: 0, matches: 0, actionsApplied: 0, errors }
  }
  if (liveConvs.length === 0) {
    return { ranAt, rulesEvaluated: rules.length, casesEvaluated: 0, matches: 0, actionsApplied: 0, errors }
  }

  // Agent lookup: intercom_admin_id → agent.id. Used to decide whether the
  // conversation's assignee is the same agent as the matching rule's owner,
  // which gates the cases-table lazy-upsert (avoids clobbering another owner's
  // case row — see same constraint in the trigger handler).
  const { data: agentRows, error: agentErr } = await db
    .from("agents")
    .select("id, intercom_admin_id")
  if (agentErr) errors.push(`agents: ${agentErr.message}`)
  const agentByIntercomId = new Map<string, string>()
  for (const a of (agentRows ?? []) as Array<{ id: string; intercom_admin_id: string | null }>) {
    if (a.intercom_admin_id) agentByIntercomId.set(a.intercom_admin_id, a.id)
  }

  // Orphan-rule warning (rule.owner_id with no matching agent row).
  const knownAgentIds = new Set(agentByIntercomId.values())
  const ownerIds = Array.from(new Set(rules.map((r) => r.ownerId)))
  const orphanCount = ownerIds.filter((id) => !knownAgentIds.has(id)).length
  if (orphanCount > 0) {
    errors.push(
      `${orphanCount} agent id(s) referenced by automation_rules have no matching row in agents — rules orphaned`
    )
  }

  // Batch-load every case metadata row that could belong to these convs,
  // across all owners. Indexed by (owner_id, conversation_id).
  const convIds = liveConvs.map((c) => c.id)
  const { data: metaRows, error: metaErr } = await db
    .from("cases")
    .select("id, intercom_conversation_id, owner_id, priority_hint, auto_tags, playbooks(case_type)")
    .in("intercom_conversation_id", convIds)
  if (metaErr) errors.push(`cases meta: ${metaErr.message}`)
  const metaByOwnerByConv = new Map<string, Map<string, CaseMetaRow>>()
  for (const m of (metaRows ?? []) as unknown as CaseMetaRow[]) {
    const ownerId = m.owner_id ?? null
    const convId = m.intercom_conversation_id ?? null
    if (!ownerId || !convId) continue
    let inner = metaByOwnerByConv.get(ownerId)
    if (!inner) {
      inner = new Map()
      metaByOwnerByConv.set(ownerId, inner)
    }
    inner.set(convId, m)
  }

  const rulesByOwner = new Map<string, AutomationRule[]>()
  for (const r of rules) {
    const bucket = rulesByOwner.get(r.ownerId) ?? []
    bucket.push(r)
    rulesByOwner.set(r.ownerId, bucket)
  }

  let matches = 0
  let actionsApplied = 0
  let casesEvaluated = 0

  for (const conv of liveConvs) {
    casesEvaluated += 1
    const live = sweepConversationToLive(conv)
    const assigneeAgentId = live.adminAssigneeId
      ? agentByIntercomId.get(String(live.adminAssigneeId)) ?? null
      : null

    for (const [ownerId, ownerRules] of rulesByOwner) {
      const meta = metaRowToCaseMeta(metaByOwnerByConv.get(ownerId)?.get(conv.id) ?? null)
      const ctx = buildContext(live, meta, null, nowMs)
      const plan = planCaseActions(ownerRules, ctx)
      if (plan.length === 0) continue

      // Only lazy-upsert when the conversation's assignee IS this owner, to
      // avoid clobbering a different agent's case row (cases.intercom_conversation_id
      // is unique). Cross-agent matches still fire alert.* actions with caseId=null.
      let caseId = meta.caseId
      if (!caseId && assigneeAgentId === ownerId) {
        const upsertRow: Record<string, unknown> = {
          intercom_conversation_id: conv.id,
          owner_id: ownerId,
          auto_tags: [],
          priority_hint: null,
        }
        if (conv.customerName) upsertRow.customer_name = conv.customerName
        const { data: created, error: upErr } = await db
          .from("cases")
          .upsert(upsertRow, { onConflict: "intercom_conversation_id", defaultToNull: false })
          .select("id")
          .maybeSingle()
        if (upErr) errors.push(`case upsert (${conv.id}): ${upErr.message}`)
        caseId = created?.id ?? null
      }

      for (const { rule, actions } of plan) {
        matches += 1
        const taken: ActionResult[] = []
        for (const action of actions) {
          const res = await runAction(action, {
            ruleId: rule.id,
            ownerId,
            caseId,
            intercomConversationId: conv.id,
            nowMs,
            customer: live.customerName,
            subject: live.subject,
            intercomState: live.intercomState,
            adminAssigneeId: live.adminAssigneeId,
            ruleName: rule.name,
          })
          taken.push(res)
          if (res.applied) actionsApplied += 1
          else if (res.detail && !res.detail.startsWith("not implemented")) {
            errors.push(`${rule.name}/${action.kind}: ${res.detail}`)
          }
        }

        const { error: runErr } = await db.from("automation_runs").insert({
          rule_id: rule.id,
          case_id: caseId,
          intercom_conversation_id: conv.id,
          matched: true,
          actions_taken: taken,
          context: ctx.fields,
          source: "sweep",
        })
        if (runErr) errors.push(`run insert: ${runErr.message}`)
      }
    }
  }

  return {
    ranAt,
    rulesEvaluated: rules.length,
    casesEvaluated,
    matches,
    actionsApplied,
    errors,
  }
}
