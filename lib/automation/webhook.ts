import "server-only"

// Automation engine — Intercom webhook → trigger evaluation.
// Verifies the Intercom signature, evaluates every enabled TRIGGER rule
// subscribing to this topic against the live conversation, and runs the
// rule's actions when conditions match. Same semantics as the sweep:
// owner_id is who gets notified, not who owns the conversation.
// Draft-only: actions only alert/flag.

import { createHmac, timingSafeEqual } from "crypto"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { planCaseActions } from "./engine"
import { runAction, type ActionResult } from "./actions"
import { buildContext, type ConversationLive, type CaseMeta } from "./context"
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
  open?: boolean | null
  admin_assignee_id?: number | string | null
  updated_at?: number | null
  created_at?: number | null
  title?: string | null
  priority?: string | null
  waiting_since?: number | null
  sla_applied?: {
    sla_name?: string | null
    sla_status?: "active" | "hit" | "missed" | "cancelled" | null
  } | null
  source?: {
    subject?: string | null
    body?: string | null
    author?: { name?: string | null; email?: string | null } | null
  } | null
  tags?: { tags?: Array<{ name?: string | null }> } | null
  contacts?: {
    contacts?: Array<{
      name?: string | null
      email?: string | null
      custom_attributes?: Record<string, unknown> | null
    }>
  } | null
}

const unixToIso = (s: number | null | undefined): string | null =>
  typeof s === "number" ? new Date(s * 1000).toISOString() : null

function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null
  const out = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  return out || null
}

function itemToConversationLive(item: IntercomConversationItem): ConversationLive {
  const contact = item.contacts?.contacts?.[0]
  const tags = (item.tags?.tags ?? []).map((t) => t.name ?? "").filter(Boolean)
  return {
    intercomConversationId: item.id != null ? String(item.id) : "",
    intercomState: item.state ?? (item.open ? "open" : item.open === false ? "closed" : null),
    subject: stripHtml(item.source?.subject ?? item.source?.body ?? item.title),
    tags,
    customerName:
      contact?.name ?? contact?.email ?? item.source?.author?.name ?? item.source?.author?.email ?? null,
    isCreator: tags.includes("CREATOR_TAG") || null,
    priority: item.priority ?? null,
    createdAt: unixToIso(item.created_at),
    updatedAt: unixToIso(item.updated_at),
    adminAssigneeId: item.admin_assignee_id != null ? String(item.admin_assignee_id) : null,
    slaStatus: item.sla_applied?.sla_status ?? "none",
    waitingSinceSec: typeof item.waiting_since === "number" ? item.waiting_since : null,
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

function rowToTriggerRule(r: Record<string, unknown>): AutomationRule {
  return {
    id: r.id as string,
    ownerId: r.owner_id as string,
    name: r.name as string,
    kind: "trigger",
    enabled: r.enabled as boolean,
    priority: r.priority as number,
    conditions: (r.conditions as ConditionTree) ?? { match: "any", groups: [] },
    actions: (r.actions as Action[]) ?? [],
    onEvents: r.on_events as string[],
  }
}

/**
 * Evaluate trigger rules for one Intercom notification.
 * Mirrors the sweep's semantics: every enabled trigger rule subscribing to this
 * topic is evaluated against the conversation, regardless of who the conversation
 * is assigned to — the `teammate` condition inside the rule decides applicability.
 * The rule's `owner_id` is the agent who gets notified, not who owns the conversation.
 *
 * Returns quickly; never throws to the caller (webhooks must 200 fast).
 */
export async function runTriggerForEvent(payload: IntercomNotification, nowMs: number): Promise<TriggerOutcome> {
  const topic = payload.topic ?? null
  const item = payload.data?.item
  const out: TriggerOutcome = { topic, handled: false, matches: 0, actionsApplied: 0, errors: [] }
  if (!topic || !item) return { ...out, reason: "no topic/item" }

  const db = getSupabaseAdminClient()
  if (!db) return { ...out, reason: "no admin client" }

  // Load every enabled trigger rule subscribing to this topic, across all owners.
  // The condition engine handles teammate / assignee filtering at eval time, so
  // a rule like "alert me when Fin gets a chat" works even though the conversation
  // is not assigned to me.
  const { data: ruleRows } = await db
    .from("automation_rules")
    .select("*")
    .eq("enabled", true)
    .eq("kind", "trigger")
    .order("priority", { ascending: true })

  const rules: AutomationRule[] = (ruleRows ?? [])
    .filter((r) => Array.isArray(r.on_events) && (r.on_events as string[]).includes(topic))
    .map(rowToTriggerRule)

  if (rules.length === 0) return { ...out, handled: true, reason: "no matching trigger rules" }

  const live = itemToConversationLive(item)
  if (!live.intercomConversationId) return { ...out, reason: "no conversation id" }

  // The conversation's actual assignee, if any, drives whether we touch the local
  // `cases` row. We only lazy-upsert a case row when the rule's owner matches the
  // assignee — otherwise the upsert would clobber the owner of a different agent's
  // case row (the table has a unique constraint on intercom_conversation_id alone).
  const assignee = item.admin_assignee_id != null ? String(item.admin_assignee_id) : null
  let assigneeAgentId: string | null = null
  if (assignee) {
    const { data: agent } = await db
      .from("agents")
      .select("id")
      .eq("intercom_admin_id", assignee)
      .maybeSingle()
    assigneeAgentId = (agent?.id as string | undefined) ?? null

    if (!assigneeAgentId && process.env.INTERCOM_ADMIN_ID && assignee === process.env.INTERCOM_ADMIN_ID) {
      const { data: singleAgent } = await db.from("agents").select("id").limit(1).maybeSingle()
      if (singleAgent?.id) {
        assigneeAgentId = singleAgent.id as string
        await db.from("agents").update({ intercom_admin_id: assignee }).eq("id", assigneeAgentId)
      }
    }
  }

  // Group rules by owner_id and evaluate per group: each owner has their own
  // case-metadata view of the conversation. Two owners with rules on the same
  // conversation get independent evaluations and runs.
  const rulesByOwner = new Map<string, AutomationRule[]>()
  for (const r of rules) {
    const bucket = rulesByOwner.get(r.ownerId) ?? []
    bucket.push(r)
    rulesByOwner.set(r.ownerId, bucket)
  }

  let totalActionsApplied = 0
  let totalMatches = 0

  for (const [ownerId, ownerRules] of rulesByOwner) {
    const { data: metaRow } = await db
      .from("cases")
      .select("id, priority_hint, auto_tags, playbooks(case_type)")
      .eq("intercom_conversation_id", live.intercomConversationId)
      .eq("owner_id", ownerId)
      .maybeSingle()
    const meta: CaseMeta = {
      caseId: (metaRow?.id as string | undefined) ?? null,
      priorityHint: (metaRow?.priority_hint as string | null) ?? null,
      autoTags: (metaRow?.auto_tags as string[] | null) ?? [],
      matchedPlaybook:
        (Array.isArray(metaRow?.playbooks)
          ? (metaRow?.playbooks[0]?.case_type as string | undefined)
          : ((metaRow?.playbooks as { case_type: string | null } | null | undefined)?.case_type ?? null)) ?? null,
    }

    const ctx = buildContext(live, meta, topic, nowMs)
    const plan = planCaseActions(ownerRules, ctx)
    if (plan.length === 0) continue

    // Lazy-upsert the metadata row only when at least one rule fires. To avoid
    // clobbering another agent's case row, only upsert when this owner IS the
    // assignee — for cross-agent rules (e.g. "alert me about Fin's chats"),
    // we run actions without a case_id, which is fine for alert.* actions.
    let caseId = meta.caseId
    if (!caseId && assigneeAgentId === ownerId) {
      const upsertRow: Record<string, unknown> = {
        intercom_conversation_id: live.intercomConversationId,
        owner_id: ownerId,
        auto_tags: [],
        priority_hint: null,
      }
      if (live.customerName) upsertRow.customer_name = live.customerName
      const { data: upserted, error: upsertErr } = await db
        .from("cases")
        .upsert(upsertRow, {
          onConflict: "intercom_conversation_id",
          ignoreDuplicates: false,
          defaultToNull: false,
        })
        .select("id")
        .maybeSingle()
      if (upsertErr) out.errors.push(`case upsert: ${upsertErr.message}`)
      caseId = (upserted?.id as string | undefined) ?? null
    }

    for (const { rule, actions } of plan) {
      totalMatches += 1
      const taken: ActionResult[] = []
      for (const action of actions) {
        const res = await runAction(action, {
          ruleId: rule.id,
          ownerId,
          caseId,
          intercomConversationId: live.intercomConversationId,
          nowMs,
          customer: live.customerName,
          subject: live.subject,
          intercomState: live.intercomState,
          adminAssigneeId: live.adminAssigneeId,
          ruleName: rule.name,
        })
        taken.push(res)
        if (res.applied) totalActionsApplied += 1
      }
      await db.from("automation_runs").insert({
        rule_id: rule.id,
        case_id: caseId,
        intercom_conversation_id: live.intercomConversationId,
        matched: true,
        actions_taken: taken,
        context: ctx.fields,
      })
    }
  }

  out.handled = true
  out.matches = totalMatches
  out.actionsApplied = totalActionsApplied
  if (totalMatches === 0) out.reason = "no rules matched"
  return out
}
