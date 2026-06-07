import { NextResponse } from "next/server"

import { createRule, getAgentContext, listRules, type RuleInput } from "@/lib/automation/rules"

export const dynamic = "force-dynamic"

export async function GET() {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  try {
    return NextResponse.json({ rules: await listRules(agentId, db) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  const body = (await req.json().catch(() => null)) as RuleInput | null
  if (!body || (body.kind !== "trigger" && body.kind !== "monitor")) {
    return NextResponse.json({ error: "kind must be 'trigger' or 'monitor'" }, { status: 400 })
  }
  try {
    return NextResponse.json({ rule: await createRule(agentId, db, body) }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
