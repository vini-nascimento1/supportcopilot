import { NextResponse } from "next/server"

import { runMonitorSweep } from "@/lib/automation/runner"

// Monitor sweep endpoint. Invoked every 5 min by Supabase pg_cron via pg_net
// (net.http_post), authenticated with a shared CRON_SECRET header — NOT a user
// session. Once the app is deployed (TODO 5.1), wire the pg_cron schedule to this URL.
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET
  const provided = req.headers.get("x-cron-secret")
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const summary = await runMonitorSweep(Date.now())
  return NextResponse.json(summary, { status: summary.errors.length ? 207 : 200 })
}
