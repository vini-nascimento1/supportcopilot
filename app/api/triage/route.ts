import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { EMPTY_TRIAGE_PREFS, filterAndRank } from "@/lib/triage/match"
import {
  getTriagePrefs,
  listTriageItems,
  getLatestSweptAt,
  getTriageSweepStatus,
} from "@/lib/triage/store"

export const dynamic = "force-dynamic"

// The triage pool for the signed-in agent's Canvas panel: every open
// conversation nobody proactive is working (unassigned, or Fin-held), swept
// into triage_items by the cron sweep (lib/triage/sweep.ts — read-only here,
// no Intercom calls in this route), filtered/ranked by the agent's saved
// triage_prefs. Read-only: nothing here writes to Intercom or triggers a sweep
// (see POST /api/triage/run for the manual "Sweep now" action).
export async function GET() {
  const { agentId, email } = await getAgentContext()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  // Signed in but no agents row yet — degrade gracefully rather than error,
  // same as /api/reply-queue for an unprovisioned account.
  if (!agentId) {
    return NextResponse.json({ items: [], pool: 0, prefs: EMPTY_TRIAGE_PREFS, sweptAt: null })
  }

  const [items, prefs, sweptAt, sweepStatus] = await Promise.all([
    listTriageItems(),
    getTriagePrefs(agentId),
    getLatestSweptAt(),
    getTriageSweepStatus(),
  ])

  const ranked = filterAndRank(items, prefs, Date.now())

  return NextResponse.json({
    items: ranked,
    pool: items.length,
    prefs,
    sweptAt,
    // Lets the panel warn when the pool count is only a partial snapshot
    // (last sweep hit its page cap or errored mid-pagination).
    sweepStatus,
  })
}
