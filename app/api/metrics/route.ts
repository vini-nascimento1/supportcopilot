import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { searchMetricsForAdmin } from "@/lib/intercom"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const url = new URL(req.url)
  const startParam = url.searchParams.get("start")
  const endParam = url.searchParams.get("end")
  const now = Date.now()

  let startTs: number
  let endTs: number

  if (startParam && endParam) {
    startTs = Number(startParam)
    endTs = Number(endParam)
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 })
    }
  } else {
    // Default: last 30 days.
    startTs = Math.floor((now - 30 * 86_400_000) / 1000)
    endTs = Math.floor(now / 1000)
  }

  // Sanity check: max 365 days.
  if (endTs - startTs > 365 * 86_400) {
    return NextResponse.json({ error: "Date range too large (max 365 days)" }, { status: 400 })
  }

  const { data: agent } = await db.from("agents").select("intercom_admin_id").eq("id", agentId).maybeSingle()
  const adminId = agent?.intercom_admin_id as string | null | undefined
  if (!adminId) return NextResponse.json({ error: "No Intercom admin ID configured" }, { status: 400 })

  try {
    const metrics = await searchMetricsForAdmin(adminId, startTs, endTs)
    return NextResponse.json(metrics)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
