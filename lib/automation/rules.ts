import "server-only"

// Automation rules — per-agent CRUD + dry-run test, used by /api/automation/rules*.
// All access is scoped to the signed-in agent (rules are per-agent, ADR-0007).

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getSignedInEmail } from "@/lib/auth"
import { evaluateTree, planCaseActions } from "./engine"
import { buildContext } from "./context"
import { caseToContextInput, type CaseRowForContext } from "./runner"
import type { Action, AutomationRule, ConditionTree, RuleKind } from "./types"

export type RuleInput = {
  name: string
  description?: string | null
  kind: RuleKind
  enabled?: boolean
  priority?: number
  conditions: ConditionTree
  actions: Action[]
  sweepEveryMins?: number | null
  onEvents?: string[] | null
}

const EMPTY_TREE: ConditionTree = { match: "any", groups: [] }

/** Resolve the signed-in agent → { db, agentId }. null agentId = not an agent. */
export async function getAgentContext() {
  const email = await getSignedInEmail()
  if (!email) return { db: null, agentId: null as string | null, email: null as string | null }
  const db = getSupabaseAdminClient()
  if (!db) return { db: null, agentId: null, email }
  const { data } = await db.from("agents").select("id").eq("email", email).maybeSingle()
  return { db, agentId: (data?.id as string | undefined) ?? null, email }
}

function rowToRule(r: Record<string, unknown>): AutomationRule {
  return {
    id: r.id as string,
    ownerId: r.owner_id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    kind: r.kind as RuleKind,
    enabled: r.enabled as boolean,
    priority: r.priority as number,
    conditions: (r.conditions as ConditionTree) ?? EMPTY_TREE,
    actions: (r.actions as Action[]) ?? [],
    sweepEveryMins: (r.sweep_every_mins as number | null) ?? null,
    onEvents: (r.on_events as string[] | null) ?? null,
  }
}

/** Normalise input to DB columns, honouring the kind_shape CHECK constraint. */
function toRow(input: RuleInput, agentId: string) {
  const isMonitor = input.kind === "monitor"
  return {
    owner_id: agentId,
    name: input.name?.trim() || "Untitled rule",
    description: input.description ?? null,
    kind: input.kind,
    enabled: input.enabled ?? false,
    priority: typeof input.priority === "number" ? input.priority : 100,
    conditions: input.conditions ?? EMPTY_TREE,
    actions: input.actions ?? [],
    // monitor → sweep cadence (default 5 min); trigger → null
    sweep_every_mins: isMonitor ? input.sweepEveryMins ?? 5 : null,
    // trigger → events (default both); monitor → null
    on_events: isMonitor
      ? null
      : input.onEvents && input.onEvents.length
        ? input.onEvents
        : ["conversation.created", "conversation.updated"],
  }
}

export async function listRules(agentId: string, db: NonNullable<ReturnType<typeof getSupabaseAdminClient>>) {
  const { data, error } = await db
    .from("automation_rules")
    .select("*")
    .eq("owner_id", agentId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToRule)
}

export async function createRule(
  agentId: string,
  db: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  input: RuleInput
) {
  const { data, error } = await db.from("automation_rules").insert(toRow(input, agentId)).select("*").single()
  if (error) throw new Error(error.message)
  return rowToRule(data)
}

export async function updateRule(
  agentId: string,
  db: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  id: string,
  patch: Partial<RuleInput>
) {
  // Build a column patch from whichever fields were provided.
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) row.name = patch.name.trim() || "Untitled rule"
  if (patch.description !== undefined) row.description = patch.description
  if (patch.enabled !== undefined) row.enabled = patch.enabled
  if (patch.priority !== undefined) row.priority = patch.priority
  if (patch.conditions !== undefined) row.conditions = patch.conditions
  if (patch.actions !== undefined) row.actions = patch.actions
  if (patch.sweepEveryMins !== undefined) row.sweep_every_mins = patch.sweepEveryMins
  if (patch.onEvents !== undefined) row.on_events = patch.onEvents

  const { data, error } = await db
    .from("automation_rules")
    .update(row)
    .eq("id", id)
    .eq("owner_id", agentId) // defense-in-depth on top of RLS
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return rowToRule(data)
}

export async function deleteRule(
  agentId: string,
  db: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  id: string
) {
  const { error } = await db.from("automation_rules").delete().eq("id", id).eq("owner_id", agentId)
  if (error) throw new Error(error.message)
}

export type TestMatch = {
  caseId: string
  customer: string | null
  status: string | null
  actionKinds: string[]
}

/**
 * Dry-run: evaluate a candidate condition tree (+ actions) against this agent's
 * recent open cases. Returns which would match and what actions would run.
 * Pure decision — NO actions are executed and nothing is written.
 */
export async function testRule(
  agentId: string,
  db: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  candidate: { conditions: ConditionTree; actions: Action[] },
  nowMs: number,
  limit = 50
): Promise<{ scanned: number; matches: TestMatch[] }> {
  const { data, error } = await db
    .from("cases")
    .select("*, playbooks(case_type)")
    .eq("owner_id", agentId)
    .order("opened_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  const cases = (data ?? []) as (CaseRowForContext & { customer_name?: string | null })[]

  const matches: TestMatch[] = []
  for (const c of cases) {
    const ctx = buildContext(caseToContextInput(c), null, nowMs)
    if (!evaluateTree(candidate.conditions, ctx)) continue
    const plan = planCaseActions(
      [{ id: "candidate", ownerId: agentId, name: "candidate", kind: "monitor", enabled: true, priority: 1, conditions: candidate.conditions, actions: candidate.actions, sweepEveryMins: 5 }],
      ctx
    )
    matches.push({
      caseId: c.id,
      customer: c.customer_name ?? null,
      status: c.status ?? null,
      actionKinds: plan[0]?.actions.map((a) => a.kind) ?? [],
    })
  }
  return { scanned: cases.length, matches }
}
