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

export type AgentTotals = {
  matches: number
  actionsApplied: number
  casesEvaluated: number
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

/** A rule is "agent-scoped" if it references `teammate` with a scoping operator
 *  (is, is_not, contains, etc.).  `is_empty` / `not_empty` are non-scoping —
 *  they need the full queue to find unassigned or assigned conversations. */
export function hasTeammateCondition(rule: AutomationRule): boolean {
  return rule.conditions.groups.some((g) =>
    g.conditions.some((c) => c.field === "teammate" && c.op !== "is_empty" && c.op !== "not_empty")
  )
}

export function sweepConversationToLive(c: SweepConversation): ConversationLive {
  return {
    intercomConversationId: c.id,
    intercomState: c.intercomState,
    subject: c.subject,
    tags: c.tags,
    customerName: c.customerName,
    isCreator: c.isCreator,
    isAiCreator: c.isAiCreator,
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

export async function processAgent(
  db: DbClient,
  agent: { id: string; intercom_admin_id: string | null },
  ownerRules: AutomationRule[],
  nowMs: number
): Promise<AgentTotals> {
  const out: AgentTotals = { matches: 0, actionsApplied: 0, casesEvaluated: 0, errors: [] }
  if (!agent.intercom_admin_id) {
    out.errors.push(`agent ${agent.id}: no intercom_admin_id; skipping sweep`)
    return out
  }

  let liveConvs: SweepConversation[]
  try {
    liveConvs = await searchOpenConversationsForAdmin(agent.intercom_admin_id)
  } catch (e) {
    out.errors.push(`intercom search (agent ${agent.id}): ${(e as Error).message}`)
    return out
  }
  if (liveConvs.length === 0) return out

  // Batch-load DB metadata for these conversations — scoped to THIS agent.
  // Without owner_id filter we'd inherit auto_tags/priority_hint set by another
  // agent's rules (cross-agent state leakage). When a conv is reassigned in
  // Intercom, the new owner's sweep gets fresh meta and the lazy-upsert below
  // re-attributes the row.
  const convIds = liveConvs.map((c) => c.id)
  const { data: metaRows, error: metaErr } = await db
    .from("cases")
    .select("id, intercom_conversation_id, owner_id, priority_hint, auto_tags, playbooks(case_type)")
    .eq("owner_id", agent.id)
    .in("intercom_conversation_id", convIds)
  if (metaErr) out.errors.push(`cases meta: ${metaErr.message}`)
  const metaByConvId = new Map<string, CaseMetaRow>()
  for (const m of (metaRows ?? []) as unknown as CaseMetaRow[]) {
    if (m.intercom_conversation_id) metaByConvId.set(m.intercom_conversation_id, m)
  }

  for (const conv of liveConvs) {
    out.casesEvaluated += 1
    const live = sweepConversationToLive(conv)
    const meta = metaRowToCaseMeta(metaByConvId.get(conv.id) ?? null)

    const ctx = buildContext(live, meta, null, nowMs)
    const plan = planCaseActions(ownerRules, ctx)
    if (plan.length === 0) continue

    // Lazy-upsert: actions need a case_id. Create the metadata row on first match.
    // On reassignment (existing row with a different owner_id), ON CONFLICT re-
    // attributes the row to this agent AND resets rule-set state (auto_tags,
    // priority_hint) — rules are per-agent (ADR-0007), so their side effects
    // must not carry across owners.
    // defaultToNull:false → omitted columns (customer_name when the live
    // payload didn't carry one) keep their existing value instead of being
    // overwritten with NULL.
    let caseId = meta.caseId
    if (!caseId) {
      const upsertRow: Record<string, unknown> = {
        intercom_conversation_id: conv.id,
        owner_id: agent.id,
        auto_tags: [],
        priority_hint: null,
      }
      if (conv.customerName) upsertRow.customer_name = conv.customerName
      const { data: created, error: upErr } = await db
        .from("cases")
        .upsert(upsertRow, { onConflict: "intercom_conversation_id", defaultToNull: false })
        .select("id")
        .maybeSingle()
      if (upErr) {
        out.errors.push(`case upsert (${conv.id}): ${upErr.message}`)
        continue
      }
      caseId = created?.id ?? null
      if (!caseId) continue
    }

    for (const { rule, actions } of plan) {
      out.matches += 1
      const taken: ActionResult[] = []
      for (const action of actions) {
        const res = await runAction(action, {
          ruleId: rule.id,
          ownerId: rule.ownerId,
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
        if (res.applied) out.actionsApplied += 1
        else if (res.detail && !res.detail.startsWith("not implemented")) {
          out.errors.push(`${rule.name}/${action.kind}: ${res.detail}`)
        }
      }

      const { error: runErr } = await db.from("automation_runs").insert({
        rule_id: rule.id,
        case_id: caseId,
        intercom_conversation_id: conv.id,
        matched: true,
        actions_taken: taken,
        context: ctx.fields,
      })
      if (runErr) out.errors.push(`run insert: ${runErr.message}`)
    }
  }
  return out
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

  // Partition rules: "global" (no teammate condition → applies to ALL agents'
  // queues) vs per-agent (has teammate condition → scoped to that owner's queue).
  const globalRules: AutomationRule[] = []
  const rulesByOwner = new Map<string, AutomationRule[]>()
  for (const r of rules) {
    if (!hasTeammateCondition(r)) {
      globalRules.push(r)
    } else {
      const list = rulesByOwner.get(r.ownerId) ?? []
      list.push(r)
      rulesByOwner.set(r.ownerId, list)
    }
  }

  const perAgentIds = Array.from(rulesByOwner.keys())
  if (globalRules.length === 0 && perAgentIds.length === 0) {
    return { ranAt, rulesEvaluated: 0, casesEvaluated: 0, matches: 0, actionsApplied: 0, errors }
  }

  // When global rules exist we must fetch ALL agents (not just those with rules)
  // so every agent's queue is evaluated against the global conditions.
  let agents: Array<{ id: string; intercom_admin_id: string | null }>
  if (globalRules.length > 0) {
    const { data: allAgentRows, error: allErr } = await db
      .from("agents")
      .select("id, intercom_admin_id")
    if (allErr) errors.push(`agents: ${allErr.message}`)
    agents = (allAgentRows ?? []) as Array<{ id: string; intercom_admin_id: string | null }>

    // Surface orphan rules: rule owner_id has no matching agent row.
    const knownAgentIds = new Set(agents.map((a) => a.id))
    const orphanCount = perAgentIds.filter((id) => !knownAgentIds.has(id)).length
    if (orphanCount > 0) {
      errors.push(
        `${orphanCount} agent id(s) referenced by automation_rules have no matching row in agents — rules orphaned`
      )
    }
  } else {
    // No global rules — only fetch agents that actually have rules.
    const { data: agentRows, error: agentErr } = await db
      .from("agents")
      .select("id, intercom_admin_id")
      .in("id", perAgentIds)
    if (agentErr) errors.push(`agents: ${agentErr.message}`)
    agents = (agentRows ?? []) as Array<{ id: string; intercom_admin_id: string | null }>

    const knownAgentIds = new Set(agents.map((a) => a.id))
    const orphanCount = perAgentIds.filter((id) => !knownAgentIds.has(id)).length
    if (orphanCount > 0) {
      errors.push(
        `${orphanCount} agent id(s) referenced by automation_rules have no matching row in agents — rules orphaned`
      )
    }
  }

  // Process agents with bounded concurrency. Each agent fans out further inside
  // (contact-attribute enrichment is concurrent within a batch), so keeping the
  // outer loop small prevents the search-API rate limit from being saturated.
  // Each agent is evaluated against: global rules + their own per-agent rules.
  const AGENT_CONCURRENCY = 3
  let matches = 0
  let actionsApplied = 0
  let casesEvaluated = 0
  for (let i = 0; i < agents.length; i += AGENT_CONCURRENCY) {
    const slice = agents.slice(i, i + AGENT_CONCURRENCY)
    const results = await Promise.all(
      slice.map((agent) => {
        const agentRules = rulesByOwner.get(agent.id) ?? []
        const merged = globalRules.length > 0 ? [...globalRules, ...agentRules] : agentRules
        return processAgent(db, agent, merged, nowMs)
      })
    )
    for (const r of results) {
      matches += r.matches
      actionsApplied += r.actionsApplied
      casesEvaluated += r.casesEvaluated
      if (r.errors.length) errors.push(...r.errors)
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
