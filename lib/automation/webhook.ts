import "server-only"

// Automation engine — Intercom webhook → trigger evaluation.
// Verifies the Intercom signature, resolves the conversation's owning agent,
// builds an eval context from the event payload + DB metadata, and runs that
// agent's enabled TRIGGER rules whose on_events include this topic.
// Draft-only: actions only alert/flag.

import { createHmac, timingSafeEqual } from "crypto"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { readCreatorFlags } from "@/lib/intercom"
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
  const flags = readCreatorFlags(contact?.custom_attributes)
  return {
    intercomConversationId: item.id != null ? String(item.id) : "",
    intercomState: item.state ?? (item.open ? "open" : item.open === false ? "closed" : null),
    subject: stripHtml(item.source?.subject ?? item.source?.body ?? item.title),
    tags: (item.tags?.tags ?? []).map((t) => t.name ?? "").filter(Boolean),
    customerName:
      contact?.name ?? contact?.email ?? item.source?.author?.name ?? item.source?.author?.email ?? null,
    isCreator: flags.isCreator,
    isAiCreator: flags.isAiCreator,
    priority: item.priority ?? null,
    createdAt: unixToIso(item.created_at),
    updatedAt: unixToIso(item.updated_at),
    adminAssigneeId: item.admin_assignee_id != null ? String(item.admin_assignee_id) : null,
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

  const live = itemToConversationLive(item)
  if (!live.intercomConversationId) return { ...out, reason: "no conversation id" }

  // Pull OUR metadata for this conversation — scoped to this owner. Without the
  // owner_id filter, a previous owner's auto_tags / priority_hint would leak into
  // the new owner's eval after reassignment.
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
  const plan = planCaseActions(rules, ctx)
  if (plan.length === 0) return { ...out, handled: true, reason: "no rules matched" }

  // Lazy-upsert the metadata row only when at least one rule fires (avoids
  // polluting cases with rows for events that never match anything). On
  // conflict by intercom_conversation_id, re-attribute the row to this owner
  // and reset rule-set state (auto_tags, priority_hint) — rules are per-agent,
  // so their side effects must not carry across owners.
  let caseId = meta.caseId
  if (!caseId) {
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
    if (!caseId) {
      const { data: existing } = await db
        .from("cases")
        .select("id")
        .eq("intercom_conversation_id", live.intercomConversationId)
        .maybeSingle()
      caseId = (existing?.id as string | undefined) ?? null
    }
  }

  let actionsApplied = 0
  for (const { rule, actions } of plan) {
    out.matches += 1
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
      if (res.applied) actionsApplied += 1
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

  out.handled = true
  out.actionsApplied = actionsApplied
  return out
}
