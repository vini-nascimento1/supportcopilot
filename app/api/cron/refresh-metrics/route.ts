import { NextResponse } from "next/server"

import { searchMetricsForAdmin } from "@/lib/intercom"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

// Pre-populates metrics_cache for every active agent for the canonical date
// ranges (7 / 30 / 90 days). Invoked daily by Supabase pg_cron at 01:00 UTC
// (2 AM BST / 1 AM GMT — UK shift handover) via pg_net.net.http_post.
// Authenticated by the shared x-cron-secret header — never a user session.

export const dynamic = "force-dynamic"
export const maxDuration = 60

const RANGE_DAYS = [7, 30, 90] as const

function toDateStr(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

// Mirrors the working-day count logic in app/api/metrics/route.ts — keep in sync.
function countWorkingDays(startTs: number, endTs: number, workingDays: number[]): number {
  const startD = new Date(startTs * 1000)
  const endD = new Date(endTs * 1000)
  let count = 0
  for (let d = new Date(startD); d < endD; d.setDate(d.getDate() + 1)) {
    if (workingDays.includes(d.getDay())) count++
  }
  return Math.max(count, 1)
}

type AgentRow = {
  id: string
  intercom_admin_id: string | null
  working_days: number[] | null
}

type RangeResult = {
  agentId: string
  rangeDays: number
  status: "ok" | "error"
  error?: string
}

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET
  const provided = req.headers.get("x-cron-secret")
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: "Supabase admin client unavailable" }, { status: 500 })

  const { data: agents, error: agentsErr } = await db
    .from("agents")
    .select("id, intercom_admin_id, working_days")
    .not("intercom_admin_id", "is", null)

  if (agentsErr) {
    return NextResponse.json({ error: `Failed to list agents: ${agentsErr.message}` }, { status: 500 })
  }

  const now = Date.now()
  const endTs = Math.floor(now / 1000)
  const endDate = toDateStr(endTs)

  const tasks: Array<Promise<RangeResult>> = []
  for (const a of (agents ?? []) as AgentRow[]) {
    if (!a.intercom_admin_id) continue
    const workingDays = a.working_days ?? [1, 2, 3, 4, 5]

    for (const days of RANGE_DAYS) {
      const startTs = Math.floor((now - days * 86_400_000) / 1000)
      const startDate = toDateStr(startTs)

      tasks.push(
        (async () => {
          try {
            const metrics = await searchMetricsForAdmin(a.intercom_admin_id!, startTs, endTs)
            const workingDayCount = countWorkingDays(startTs, endTs, workingDays)
            const result = {
              ...metrics,
              workingDays: workingDayCount,
              perDayConversations:
                metrics.totalConversations > 0
                  ? Math.round(metrics.totalConversations / workingDayCount)
                  : null,
              perDayCsat:
                (metrics.csatCount ?? 0) > 0
                  ? Math.round(((metrics.csatCount ?? 0) / workingDayCount) * 10) / 10
                  : null,
            }
            await db.from("metrics_cache").upsert(
              {
                agent_id: a.id,
                start_date: startDate,
                end_date: endDate,
                data: result as Record<string, unknown>,
              },
              { onConflict: "agent_id,start_date,end_date", ignoreDuplicates: false }
            )
            return { agentId: a.id, rangeDays: days, status: "ok" as const }
          } catch (e) {
            return {
              agentId: a.id,
              rangeDays: days,
              status: "error" as const,
              error: (e as Error).message,
            }
          }
        })()
      )
    }
  }

  const results = await Promise.all(tasks)
  const errors = results.filter((r) => r.status === "error")
  return NextResponse.json(
    {
      agentsProcessed: new Set(results.map((r) => r.agentId)).size,
      tasksRun: results.length,
      errors,
    },
    { status: errors.length ? 207 : 200 }
  )
}
