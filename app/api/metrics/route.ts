import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { searchMetricsForAdmin } from "@/lib/intercom"
import type { AgentMetrics } from "@/lib/intercom"

export const dynamic = "force-dynamic"

// Aggregate KPIs — safe to serve up to a day old. Force refresh with ?refresh=1.
const CACHE_TTL_MS = 24 * 3_600_000

function toDateStr(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const url = new URL(req.url)
  const startParam = url.searchParams.get("start")
  const endParam = url.searchParams.get("end")
  const forceRefresh = url.searchParams.get("refresh") === "1"
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
    startTs = Math.floor((now - 30 * 86_400_000) / 1000)
    endTs = Math.floor(now / 1000)
  }

  if (endTs - startTs > 365 * 86_400) {
    return NextResponse.json({ error: "Date range too large (max 365 days)" }, { status: 400 })
  }

  const { data: agent } = await db.from("agents").select("intercom_admin_id").eq("id", agentId).maybeSingle()
  const adminId = agent?.intercom_admin_id as string | null | undefined
  if (!adminId) return NextResponse.json({ error: "No Intercom admin ID configured" }, { status: 400 })

  // Normalize to dates for cache key.
  const startDate = toDateStr(startTs)
  const endDate = toDateStr(endTs)

  // Check cache (fresh within TTL).
  const { data: cached } = await db
    .from("metrics_cache")
    .select("data, created_at")
    .eq("agent_id", agentId)
    .eq("start_date", startDate)
    .eq("end_date", endDate)
    .maybeSingle()

  if (cached && !forceRefresh) {
    const age = now - new Date(cached.created_at as string).getTime()
    if (age < CACHE_TTL_MS) {
      return NextResponse.json(cached.data as AgentMetrics)
    }
  }

  // Fetch fresh from Intercom and store in cache.
  try {
    const metrics = await searchMetricsForAdmin(adminId, startTs, endTs)

    await db.from("metrics_cache").upsert(
      {
        agent_id: agentId,
        start_date: startDate,
        end_date: endDate,
        data: metrics as Record<string, unknown>,
      },
      { onConflict: "agent_id,start_date,end_date", ignoreDuplicates: false }
    )

    return NextResponse.json(metrics)
  } catch (e) {
    // If Intercom fails but we have stale cache, serve it as fallback.
    if (cached) {
      return NextResponse.json(cached.data as AgentMetrics)
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
