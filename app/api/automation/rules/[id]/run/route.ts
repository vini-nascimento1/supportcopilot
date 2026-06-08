import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { sweepConversationToLive, metaRowToCaseMeta } from "@/lib/automation/runner"
import type { AutomationRule } from "@/lib/automation/types"
import { buildContext } from "@/lib/automation/context"
import { searchOpenConversationsForAdmin } from "@/lib/intercom"
import { planCaseActions } from "@/lib/automation/engine"

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
      matches += 1
      actionsApplied += plan[0].actions.length
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
