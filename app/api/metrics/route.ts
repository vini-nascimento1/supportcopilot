import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { searchMetricsForAdmin } from "@/lib/intercom"
import type { AgentMetrics } from "@/lib/intercom"
import { getReplyQueueMetrics } from "@/lib/reply-queue-store"

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

  const { data: agent } = await db.from("agents").select("intercom_admin_id, working_days").eq("id", agentId).maybeSingle()
  const adminId = agent?.intercom_admin_id as string | null | undefined
  if (!adminId) return NextResponse.json({ error: "No Intercom admin ID configured" }, { status: 400 })

  // Count working days in the date range.
  const wd = (agent?.working_days ?? [1, 2, 3, 4, 5]) as number[]
  const startD = new Date(startTs * 1000)
  const endD = new Date(endTs * 1000)
  let workingDayCount = 0
  for (let d = new Date(startD); d < endD; d.setDate(d.getDate() + 1)) {
    if (wd.includes(d.getDay())) workingDayCount++
  }
  workingDayCount = Math.max(workingDayCount, 1)

  // Normalize to dates for cache key.
  const startDate = toDateStr(startTs)
  const endDate = toDateStr(endTs)
  const replyQueue = await getReplyQueueMetrics({
    agentId,
    startIso: new Date(startTs * 1000).toISOString(),
    endIso: new Date(endTs * 1000).toISOString(),
  })

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
      return NextResponse.json({ ...(cached.data as AgentMetrics), replyQueue })
    }
  }

  // Fetch fresh from Intercom and store in cache.
  try {
    const metrics = await searchMetricsForAdmin(adminId, startTs, endTs)

    // Override per-day calculations with working days instead of calendar days.
    const result = {
      ...metrics,
      workingDays: workingDayCount,
      perDayConversations: metrics.totalConversations > 0 ? Math.round(metrics.totalConversations / workingDayCount) : null,
      perDayCsat: (metrics.csatCount ?? 0) > 0 ? Math.round(((metrics.csatCount ?? 0) / workingDayCount) * 10) / 10 : null,
    }

    await db.from("metrics_cache").upsert(
      {
        agent_id: agentId,
        start_date: startDate,
        end_date: endDate,
        data: result as Record<string, unknown>,
      },
      { onConflict: "agent_id,start_date,end_date", ignoreDuplicates: false }
    )

    return NextResponse.json({ ...result, replyQueue })
  } catch (e) {
    // If Intercom fails but we have stale cache, serve it as fallback.
    if (cached) {
      return NextResponse.json({ ...(cached.data as AgentMetrics), replyQueue })
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
