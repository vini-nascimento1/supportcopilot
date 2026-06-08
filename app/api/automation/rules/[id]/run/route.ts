import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { processAgent } from "@/lib/automation/runner"
import type { AutomationRule } from "@/lib/automation/types"

export const dynamic = "force-dynamic"

/**
 * Manually run a single monitor rule against the current agent's open queue.
 * Returns a summary of how many conversations matched and what actions fired.
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

    // Resolve the current agent.
    const { data: agent } = await db
      .from("agents")
      .select("id, intercom_admin_id")
      .eq("id", agentId)
      .maybeSingle()

    if (!agent?.intercom_admin_id) {
      return NextResponse.json({ error: "No Intercom admin ID configured" }, { status: 400 })
    }

    // Run the rule for this agent.
    const result = await processAgent(db, { id: agent.id, intercom_admin_id: agent.intercom_admin_id }, [rule], Date.now())

    return NextResponse.json({
      ruleName: rule.name,
      casesEvaluated: result.casesEvaluated,
      matches: result.matches,
      actionsApplied: result.actionsApplied,
      errors: result.errors,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
