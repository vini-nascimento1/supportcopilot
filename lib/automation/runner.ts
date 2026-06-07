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
    isAiCreator: c.isAiCreator,
    priority: c.priority,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
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

  // Index rules by owner — only agents with rules need an Intercom fetch.
  const rulesByOwner = new Map<string, AutomationRule[]>()
  for (const r of rules) {
    const list = rulesByOwner.get(r.ownerId) ?? []
    list.push(r)
    rulesByOwner.set(r.ownerId, list)
  }

  const agentIds = Array.from(rulesByOwner.keys())
  if (agentIds.length === 0) {
    return { ranAt, rulesEvaluated: 0, casesEvaluated: 0, matches: 0, actionsApplied: 0, errors }
  }

  const { data: agentRows, error: agentErr } = await db
    .from("agents")
    .select("id, intercom_admin_id")
    .in("id", agentIds)
  if (agentErr) errors.push(`agents: ${agentErr.message}`)
  const agents = (agentRows ?? []) as Array<{ id: string; intercom_admin_id: string | null }>

  let matches = 0
  let actionsApplied = 0
  let casesEvaluated = 0

  for (const agent of agents) {
    const ownerRules = rulesByOwner.get(agent.id) ?? []
    if (ownerRules.length === 0) continue
    if (!agent.intercom_admin_id) {
      errors.push(`agent ${agent.id}: no intercom_admin_id; skipping sweep`)
      continue
    }

    let liveConvs: SweepConversation[]
    try {
      liveConvs = await searchOpenConversationsForAdmin(agent.intercom_admin_id)
    } catch (e) {
      errors.push(`intercom search (agent ${agent.id}): ${(e as Error).message}`)
      continue
    }
    if (liveConvs.length === 0) continue

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
    if (metaErr) errors.push(`cases meta: ${metaErr.message}`)
    const metaByConvId = new Map<string, CaseMetaRow>()
    for (const m of (metaRows ?? []) as unknown as CaseMetaRow[]) {
      if (m.intercom_conversation_id) metaByConvId.set(m.intercom_conversation_id, m)
    }

    for (const conv of liveConvs) {
      casesEvaluated += 1
      const live = sweepConversationToLive(conv)
      const metaRow = metaByConvId.get(conv.id) ?? null
      const meta = metaRowToCaseMeta(metaRow)

      const ctx = buildContext(live, meta, null, nowMs)
      const plan = planCaseActions(ownerRules, ctx)
      if (plan.length === 0) continue

      // Lazy-upsert: actions need a case_id. Create the metadata row on first match.
      // On reassignment (existing row with a different owner_id), ON CONFLICT re-
      // attributes the row to this agent AND resets the rule-set state (auto_tags,
      // priority_hint) — rules are per-agent (ADR-0007), so their side effects must
      // not carry across owners. customer_name is preserved if the live payload
      // dropped it.
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
          .upsert(upsertRow, { onConflict: "intercom_conversation_id" })
          .select("id")
          .maybeSingle()
        if (upErr) {
          errors.push(`case upsert (${conv.id}): ${upErr.message}`)
          continue
        }
        caseId = created?.id ?? null
        if (!caseId) continue
      }

      for (const { rule, actions } of plan) {
        matches += 1
        const taken: ActionResult[] = []
        for (const action of actions) {
          const res = await runAction(action, {
            ruleId: rule.id,
            ownerId: rule.ownerId,
            caseId,
            intercomConversationId: conv.id,
            nowMs,
          })
          taken.push(res)
          if (res.applied) actionsApplied += 1
          else if (res.detail && !res.detail.startsWith("not implemented")) errors.push(`${rule.name}/${action.kind}: ${res.detail}`)
        }

        const { error: runErr } = await db.from("automation_runs").insert({
          rule_id: rule.id,
          case_id: caseId,
          intercom_conversation_id: conv.id,
          matched: true,
          actions_taken: taken,
          context: ctx.fields,
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
