import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { searchMetricsForAdmin } from "@/lib/intercom"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  // Parse period from query (default 30 days).
  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 365)

  // Resolve the agent's Intercom admin ID.
  const { data: agent } = await db.from("agents").select("intercom_admin_id").eq("id", agentId).maybeSingle()
  const adminId = agent?.intercom_admin_id as string | null | undefined
  if (!adminId) return NextResponse.json({ error: "No Intercom admin ID configured" }, { status: 400 })

  try {
    const metrics = await searchMetricsForAdmin(adminId, days)
    return NextResponse.json(metrics)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
