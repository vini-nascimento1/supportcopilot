import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { sweepConversationToLive, metaRowToCaseMeta } from "@/lib/automation/runner"
import type { AutomationRule, Action } from "@/lib/automation/types"
import { buildContext } from "@/lib/automation/context"
import { searchOpenConversationsForAdmin } from "@/lib/intercom"
import { planCaseActions } from "@/lib/automation/engine"
import { runAction } from "@/lib/automation/actions"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

/**
 * Manually run a single monitor rule against ALL open Intercom conversations.
 * This ensures conditions like "teammate is <specific_id>" or
 * "teammate is_empty" are evaluated on the full queue — not just the
 * current agent's queue.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const { id } = await params

  try {
    // Fetch the rule.
    const { data: rows, error: fetchErr } = await db
      .from("automation_rules")
      .select("*")
      .eq("id", id)
      .eq("owner_id", agentId) // defense-in-depth: only own rules
      .maybeSingle()

    if (fetchErr) return NextResponse.json({ error: `DB error: ${fetchErr.message}` }, { status: 500 })
    if (!rows) return NextResponse.json({ error: "Rule not found" }, { status: 404 })

    const rule: AutomationRule = {
      id: rows.id,
      ownerId: rows.owner_id,
      name: rows.name,
      kind: rows.kind,
      enabled: rows.enabled,
      priority: rows.priority,
      conditions: rows.conditions,
      actions: rows.actions,
      sweepEveryMins: rows.sweep_every_mins,
      onEvents: rows.on_events,
    }

    if (rule.kind !== "monitor") {
      return NextResponse.json({ error: "Only monitor rules can be run manually" }, { status: 400 })
    }

    // Fetch ALL open conversations (no admin filter) so teammate conditions
    // evaluate correctly against the full queue.
    let liveConvs
    try {
      liveConvs = await searchOpenConversationsForAdmin()
    } catch (e) {
      return NextResponse.json({ error: `Intercom: ${(e as Error).message}` }, { status: 502 })
    }

    if (!liveConvs || liveConvs.length === 0) {
      return NextResponse.json({ ruleName: rule.name, casesEvaluated: 0, matches: 0, actionsApplied: 0, errors: [] })
    }

    const nowMs = Date.now()
    const convIds = liveConvs.map((c) => c.id)

    // Batch-load DB metadata for these conversations.
    const { data: metaRows } = await db
      .from("cases")
      .select("id, intercom_conversation_id, owner_id, priority_hint, auto_tags, playbooks(case_type)")
      .in("intercom_conversation_id", convIds)

    const metaByConvId = new Map<string, NonNullable<typeof metaRows>[number]>()
    for (const m of metaRows ?? []) {
      const cid = m.intercom_conversation_id as string | null
      if (cid) metaByConvId.set(cid, m)
    }

    const adminDb = getSupabaseAdminClient()
    if (!adminDb) return NextResponse.json({ error: "No admin client" }, { status: 500 })

    let matches = 0
    let actionsApplied = 0
    const errors: string[] = []

    for (const conv of liveConvs) {
      const live = sweepConversationToLive(conv)
      const meta = metaRowToCaseMeta(
        (metaByConvId.get(conv.id) ?? null) as Parameters<typeof metaRowToCaseMeta>[0]
      )
      const ctx = buildContext(live, meta, null, nowMs)
      const plan = planCaseActions([rule], ctx)
      if (plan.length === 0) continue

      // Upsert a cases row if none exists — actions like case.flag need a caseId.
      let caseId = meta.caseId
      if (!caseId) {
        const upsertRow: Record<string, unknown> = {
          intercom_conversation_id: conv.id,
          owner_id: agentId,
          auto_tags: [],
          priority_hint: null,
        }
        if (conv.customerName) upsertRow.customer_name = conv.customerName
        const { data: created, error: upErr } = await adminDb
          .from("cases")
          .upsert(upsertRow, { onConflict: "intercom_conversation_id", defaultToNull: false })
          .select("id")
          .maybeSingle()
        if (upErr) {
          errors.push(`case upsert (${conv.id}): ${upErr.message}`)
          continue
        }
        caseId = created?.id ?? null
        if (!caseId) continue
      }

      for (const { rule: matchedRule, actions } of plan) {
        matches += 1
        const taken: Array<{ kind: string; applied: boolean; detail: string }> = []
        for (const action of actions as Action[]) {
          const res = await runAction(action, {
            ruleId: matchedRule.id,
            ownerId: matchedRule.ownerId,
            caseId,
            intercomConversationId: conv.id,
            nowMs,
            customer: live.customerName,
            subject: live.subject,
            intercomState: live.intercomState,
            adminAssigneeId: live.adminAssigneeId,
            ruleName: matchedRule.name,
          })
          taken.push(res)
          if (res.applied) actionsApplied += 1
          else if (res.detail && !res.detail.startsWith("not implemented")) {
            errors.push(`${matchedRule.name}/${action.kind}: ${res.detail}`)
          }
        }

        // Record the run for audit trail (matches processAgent pattern).
        const { error: runErr } = await adminDb.from("automation_runs").insert({
          rule_id: matchedRule.id,
          case_id: caseId,
          intercom_conversation_id: conv.id,
          matched: true,
          actions_taken: taken,
          context: ctx.fields,
          source: "manual",
        })
        if (runErr) errors.push(`run insert: ${runErr.message}`)
      }
    }

    return NextResponse.json({
      ruleName: rule.name,
      casesEvaluated: liveConvs.length,
      matches,
      actionsApplied,
      errors: errors.length ? errors : undefined,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
