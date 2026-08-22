import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getNonReadAssignedConversations } from "@/lib/intercom"
import {
  getPendingSuggestionsForAgent,
  filterRecoveryCandidates,
  markSuggestionsStaleByConversations,
} from "@/lib/reply-queue-store"
import { computeAndPersistSuggestion } from "@/lib/reply-queue-pipeline"
import { selectDepartedDrafts } from "@/lib/reply-queue"

// Draft recovery sweep. Invoked on a schedule by Supabase pg_cron via pg_net
// with the shared CRON_SECRET header — same pattern as the triage sweep.
//
// Why this exists: every other path that drafts a reply is opportunistic. The
// assign routes draft in the foreground or in after(), and both can be cut
// short by the function's duration limit; the /api/reply-queue backfill only
// runs while an agent has the Queue tab open, focused, and polling. So a
// conversation could be assigned to an agent, sit non-read (customer waiting),
// and simply never get a draft — with nothing anywhere reporting it. This sweep
// is the backstop that closes that hole: it looks at what SHOULD have a draft
// and doesn't, and drafts it, independent of anyone's browser.
//
// DRAFT-ONLY, like the rest of the pipeline: it only ever writes a
// suggested_replies row. It never sends, never assigns, never writes to
// Intercom. Every reply still waits for a human to approve it.
export const dynamic = "force-dynamic"
export const maxDuration = 300

// Wall-clock budget for the whole run, under maxDuration so the loop finishes
// cleanly and reports what it did rather than being killed mid-generation.
const RUN_BUDGET_MS = 240_000

// Don't touch a conversation attempted within this window — it is either still
// in flight or was just drafted by the client backfill.
const RETRY_AFTER_MS = 15 * 60 * 1000

// A conversation whose last attempt ended in a terminal failure waits this long
// before being retried, so a permanently un-draftable ticket can't burn a
// generation on every single sweep.
const FAILURE_COOLOFF_MS = 6 * 60 * 60 * 1000


// Hard ceiling on generations per run, independent of the time budget.
const MAX_DRAFTS_PER_RUN = 12

type AgentRow = { id: string; email: string | null; intercom_admin_id: string | null }

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET
  const provided = req.headers.get("x-cron-secret")
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db = getSupabaseAdminClient()
  if (!db) {
    return NextResponse.json({ error: "No database client" }, { status: 500 })
  }

  const { data: agents } = await db
    .from("agents")
    .select("id, email, intercom_admin_id")
    .not("intercom_admin_id", "is", null)

  const rows = (agents ?? []) as AgentRow[]

  const origin = new URL(req.url).origin
  const deadline = Date.now() + RUN_BUDGET_MS
  const retryAfterIso = new Date(Date.now() - RETRY_AFTER_MS).toISOString()
  const failureCooloffIso = new Date(Date.now() - FAILURE_COOLOFF_MS).toISOString()

  // Conversations already handled this run. Two agents sharing an Intercom
  // admin id (or the shared env fallback) would otherwise both claim the same
  // conversation and draft it twice.
  const seen = new Set<string>()

  let candidates = 0
  let drafted = 0
  let failed = 0
  let retired = 0
  let agentsScanned = 0
  let intercomErrors = 0
  let budgetExhausted = false

  for (const agent of rows) {
    if (!agent.intercom_admin_id) continue
    if (Date.now() >= deadline || drafted + failed >= MAX_DRAFTS_PER_RUN) {
      budgetExhausted = true
      break
    }

    // null = Intercom unreachable for this agent. Skip them this run rather
    // than treating an outage as "nothing needs drafting".
    const nonRead = await getNonReadAssignedConversations(agent.intercom_admin_id)
    if (!nonRead) {
      intercomErrors += 1
      continue
    }
    agentsScanned += 1

    const pending = await getPendingSuggestionsForAgent(agent.id)
    const haveDraft = new Set(pending.map((p) => p.intercomConversationId))

    // Retire drafts whose conversation has left the non-read set (the agent
    // answered it, or it closed). Until now this reconciliation ONLY ran while
    // an agent had the Queue tab open and polling, so an agent who never opens
    // the tab accumulated pending rows forever — 2,813 rows older than 7 days
    // across 5 owners when this was added. That is not merely untidy:
    // getPendingSuggestionsForAgent caps at 200 rows, so a large enough orphan
    // pile pushes genuinely-live drafts out of the window that builds
    // `haveDraft` above, and this sweep then redrafts a conversation that
    // already had a pending draft. The on-request and grace-period guards live
    // in selectDepartedDrafts(), shared with the queue route's reconciler.
    const nonReadIds = new Set(nonRead.map((c) => c.id))
    const departed = selectDepartedDrafts(pending, nonReadIds, Date.now())
    if (departed.length > 0) {
      await markSuggestionsStaleByConversations(agent.id, departed).catch(() => {})
      retired += departed.length
    }

    const missing = nonRead
      .map((c) => c.id)
      .filter((id) => !haveDraft.has(id) && !seen.has(id))
    if (missing.length === 0) continue

    const toDraft = await filterRecoveryCandidates(missing, {
      retryAfterIso,
      failureCooloffIso,
    })
    candidates += toDraft.length

    for (const id of toDraft) {
      if (Date.now() >= deadline || drafted + failed >= MAX_DRAFTS_PER_RUN) {
        budgetExhausted = true
        break
      }
      seen.add(id)
      try {
        const outcome = await computeAndPersistSuggestion(id, origin, {
          owner: { id: agent.id, email: agent.email },
        })
        if (outcome.action === "suggested") drafted += 1
        else failed += 1
      } catch {
        failed += 1
      }
    }
  }

  // Counts only — no conversation ids, names, or customer text in the response
  // or logs. 207 flags a partial run (Intercom errors, or the budget ran out
  // with work still queued) so a monitor can tell it apart from a clean run.
  const partial = intercomErrors > 0 || budgetExhausted
  return NextResponse.json(
    {
      agentsScanned,
      candidates,
      drafted,
      failed,
      retired,
      intercomErrors,
      budgetExhausted,
    },
    { status: partial ? 207 : 200 }
  )
}
