import { NextResponse } from "next/server"

import { getAgentContext, testRule } from "@/lib/automation/rules"
import type { Action, ConditionTree } from "@/lib/automation/types"

export const dynamic = "force-dynamic"

// Dry-run a candidate rule against this agent's recent open cases. Nothing is
// executed or written — pure preview, Kayako-style, so the agent can trust a rule
// before enabling it.
export async function POST(req: Request) {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as
    | { conditions: ConditionTree; actions?: Action[] }
    | null
  if (!body?.conditions) return NextResponse.json({ error: "conditions required" }, { status: 400 })

  try {
    const result = await testRule(
      agentId,
      db,
      { conditions: body.conditions, actions: body.actions ?? [] },
      Date.now()
    )
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
