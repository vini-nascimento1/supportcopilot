import { NextResponse } from "next/server"

import { runTriageSweep } from "@/lib/triage/sweep"

// Triage sweep endpoint. Invoked on a schedule by Supabase pg_cron via pg_net
// (net.http_post), authenticated with a shared CRON_SECRET header — NOT a
// user session, same as app/api/automation/sweep/route.ts. Classifies the
// unassigned/Fin-held open pool into triage_items (no LLM calls, no Intercom
// writes — see lib/triage/sweep.ts).
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET
  const provided = req.headers.get("x-cron-secret")
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const summary = await runTriageSweep(Date.now())
  return NextResponse.json(summary, { status: summary.error ? 207 : 200 })
}
