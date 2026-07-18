import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { runTriageSweep } from "@/lib/triage/sweep"
import { getLatestSweptAt } from "@/lib/triage/store"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Manual "Sweep now" for the Canvas triage panel — same runTriageSweep as the
// cron (app/api/cron/triage-sweep/route.ts), gated by a signed-in agent
// instead of the cron secret. Rate-limited to once a minute across ALL
// agents (the pool is global, not per-agent) so a row of impatient clicks
// can't turn into a paginated full-Intercom-queue fetch on every click.
const MIN_INTERVAL_MS = 60_000

export async function POST() {
  const { email } = await getAgentContext()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const latestSweptAt = await getLatestSweptAt()
  if (latestSweptAt) {
    const ageMs = Date.now() - Date.parse(latestSweptAt)
    if (ageMs < MIN_INTERVAL_MS) {
      return NextResponse.json({ ok: false, error: "swept recently" }, { status: 429 })
    }
  }

  const summary = await runTriageSweep(Date.now())
  return NextResponse.json({ ok: !summary.error, ...summary })
}
