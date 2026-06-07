import { NextResponse } from "next/server"

import { deleteRule, getAgentContext, updateRule, type RuleInput } from "@/lib/automation/rules"

export const dynamic = "force-dynamic"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  const { id } = await params
  const patch = (await req.json().catch(() => null)) as Partial<RuleInput> | null
  if (!patch) return NextResponse.json({ error: "invalid body" }, { status: 400 })
  try {
    return NextResponse.json({ rule: await updateRule(agentId, db, id, patch) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  const { id } = await params
  try {
    await deleteRule(agentId, db, id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
