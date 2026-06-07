import "server-only"

// Automation engine — Intercom webhook → trigger evaluation.
// Verifies the Intercom signature, resolves the conversation's owning agent, builds
// an eval context from the event payload, and runs that agent's enabled TRIGGER
// rules whose on_events include this topic. Draft-only: actions only alert/flag.

import { createHmac, timingSafeEqual } from "crypto"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { planCaseActions } from "./engine"
import { runAction, type ActionResult } from "./actions"
import { buildContext, type CaseLike } from "./context"
import type { AutomationRule, ConditionTree, Action } from "./types"

/** Verify Intercom's `X-Hub-Signature: sha1=<hmac>` over the raw request body. */
export function verifyIntercomSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const expected = "sha1=" + createHmac("sha1", secret).update(rawBody, "utf8").digest("hex")
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

type IntercomNotification = {
  topic?: string
  delivery_id?: string
  data?: { item?: IntercomConversationItem }
}

type IntercomConversationItem = {
  id?: string | number
  state?: string | null
  admin_assignee_id?: number | string | null
  updated_at?: number | null
  created_at?: number | null
  title?: string | null
  source?: { subject?: string | null; body?: string | null } | null
  tags?: { tags?: Array<{ name?: string | null }> } | null
}

const unixToIso = (s: number | null | undefined): string | null =>
  typeof s === "number" ? new Date(s * 1000).toISOString() : null

function itemToCaseLike(item: IntercomConversationItem): CaseLike {
  return {
    intercom_conversation_id: item.id != null ? String(item.id) : null,
    status: item.state ?? null, // Intercom state (open/closed/snoozed) for eval
    intercom_state: item.state ?? null,
    subject: item.source?.subject ?? item.source?.body ?? item.title ?? null,
    tags: (item.tags?.tags ?? []).map((t) => t.name ?? "").filter(Boolean),
    updated_at: unixToIso(item.updated_at),
    opened_at: unixToIso(item.created_at),
  }
}

export type TriggerOutcome = {
  topic: string | null
  handled: boolean
  reason?: string
  matches: number
  actionsApplied: number
  errors: string[]
}

/**
 * Evaluate trigger rules for one Intercom notification.
 * Returns quickly; never throws to the caller (webhooks must 200 fast).
 */
export async function runTriggerForEvent(payload: IntercomNotification, nowMs: number): Promise<TriggerOutcome> {
  const topic = payload.topic ?? null
  const item = payload.data?.item
  const out: TriggerOutcome = { topic, handled: false, matches: 0, actionsApplied: 0, errors: [] }
  if (!topic || !item) return { ...out, reason: "no topic/item" }

  const db = getSupabaseAdminClient()
  if (!db) return { ...out, reason: "no admin client" }

  // Owner = the agent assigned to this conversation (rules are per-agent).
  const assignee = item.admin_assignee_id
  if (assignee == null) return { ...out, reason: "no assignee" }

  // Primary lookup: match intercom_admin_id in the agents table.
  const { data: agent } = await db
    .from("agents")
    .select("id")
    .eq("intercom_admin_id", String(assignee))
    .maybeSingle()

  let ownerId = (agent?.id as string | undefined) ?? null

  // Fallback: if no agent has intercom_admin_id set yet, check if the env var
  // INTERCOM_ADMIN_ID matches this assignee and there's exactly one agent → use it.
  // This unblocks triggers while the DB is being bootstrapped.
  if (!ownerId && process.env.INTERCOM_ADMIN_ID && String(assignee) === process.env.INTERCOM_ADMIN_ID) {
    const { data: singleAgent } = await db
      .from("agents")
      .select("id")
      .limit(1)
      .maybeSingle()
    if (singleAgent?.id) {
      ownerId = singleAgent.id as string
      // Persist so future lookups are fast (best-effort, ignore errors).
      await db.from("agents").update({ intercom_admin_id: String(assignee) }).eq("id", ownerId)
    }
  }

  if (!ownerId) return { ...out, reason: "assignee is not a known agent" }

  // Enabled trigger rules for this owner whose on_events include this topic.
  const { data: ruleRows } = await db
    .from("automation_rules")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("enabled", true)
    .eq("kind", "trigger")
    .order("priority", { ascending: true })
  const rules: AutomationRule[] = (ruleRows ?? [])
    .filter((r) => Array.isArray(r.on_events) && (r.on_events as string[]).includes(topic))
    .map((r) => ({
      id: r.id as string,
      ownerId: r.owner_id as string,
      name: r.name as string,
      kind: "trigger",
      enabled: r.enabled as boolean,
      priority: r.priority as number,
      conditions: (r.conditions as ConditionTree) ?? { match: "any", groups: [] },
      actions: (r.actions as Action[]) ?? [],
      onEvents: r.on_events as string[],
    }))
  if (rules.length === 0) return { ...out, handled: true, reason: "no matching trigger rules" }

  // Upsert a local case row so monitors have data to sweep.
  // Monitors query `cases WHERE status='open'`; without this, the table stays empty.
  const convId = item.id != null ? String(item.id) : null
  let caseId: string | null = null
  if (convId) {
    const caseRow = {
      intercom_conversation_id: convId,
      owner_id: ownerId,
      status: "open", // internal workflow status — not the Intercom state
      intercom_state: item.state ?? "open", // Intercom's real conversation state
      summary: item.source?.subject ?? item.source?.body ?? item.title ?? null,
      opened_at: unixToIso(item.created_at),
    }
    const { data: upserted, error: upsertErr } = await db
      .from("cases")
      .upsert(caseRow, { onConflict: "intercom_conversation_id", ignoreDuplicates: false })
      .select("id")
      .maybeSingle()
    if (upsertErr) out.errors.push(`case upsert: ${upsertErr.message}`)
    caseId = (upserted?.id as string | undefined) ?? null

    // Also try to find existing if upsert didn't return id (edge case).
    if (!caseId) {
      const { data: existing } = await db.from("cases").select("id").eq("intercom_conversation_id", convId).maybeSingle()
      caseId = (existing?.id as string | undefined) ?? null
    }
  }

  const ctx = buildContext(itemToCaseLike(item), topic, nowMs)
  const plan = planCaseActions(rules, ctx)

  let actionsApplied = 0
  for (const { rule, actions } of plan) {
    out.matches += 1
    const taken: ActionResult[] = []
    for (const action of actions) {
      const res = await runAction(action, {
        ruleId: rule.id,
        ownerId,
        caseId,
        intercomConversationId: convId,
        nowMs,
      })
      taken.push(res)
      if (res.applied) actionsApplied += 1
    }
    await db.from("automation_runs").insert({
      rule_id: rule.id,
      case_id: caseId,
      intercom_conversation_id: convId,
      matched: true,
      actions_taken: taken,
      context: ctx.fields,
    })
  }

  out.handled = true
  out.actionsApplied = actionsApplied
  return out
}
