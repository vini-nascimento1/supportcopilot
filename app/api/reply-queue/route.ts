import { NextResponse, after } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getNonReadAssignedConvIds } from "@/lib/intercom"
import {
  getPendingSuggestionsForAgent,
  markSuggestionsStaleByConversations,
  getRecentlyTouchedConversationIds,
} from "@/lib/reply-queue-store"
import { computeAndPersistSuggestion } from "@/lib/reply-queue-pipeline"

export const dynamic = "force-dynamic"

// Don't recompute a draft for the same conversation more than once per window,
// and cap how many we backfill per request — bounds background LLM work.
const BACKFILL_WINDOW_MS = 5 * 60 * 1000
const BACKFILL_MAX = 8

// The autonomous reply queue for the signed-in agent: their NON-READ conversations
// (the customer is waiting on us), each with its precomputed AI draft. Membership
// is reconciled against live Intercom on every load, because the cached
// suggestions table drifts (webhook resolution is unreliable):
//   • a cached suggestion whose conversation is no longer non-read — the agent
//     replied, or it closed — is dropped from the response and marked stale; and
//   • a non-read conversation with no draft yet is backfilled in the background
//     (recency-guarded, capped) so it shows up on the next poll.
// If Intercom is unreachable we fall back to the raw cached suggestions rather
// than emptying the queue. The client splits the list into the two risk bands.
export async function GET(request: Request) {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ items: [] })

  const { data: agent } = await db
    .from("agents")
    .select("id, intercom_admin_id")
    .eq("email", email)
    .maybeSingle()
  const agentId = agent?.id as string | undefined
  if (!agentId) return NextResponse.json({ items: [] })
  const adminId =
    (agent?.intercom_admin_id as string | null) ?? process.env.INTERCOM_ADMIN_ID ?? null

  try {
    const [pending, nonRead] = await Promise.all([
      getPendingSuggestionsForAgent(agentId),
      adminId ? getNonReadAssignedConvIds(adminId) : Promise.resolve(null),
    ])

    // Intercom unreachable / no admin id → show cached suggestions as-is rather
    // than emptying the queue on a transient outage.
    if (!nonRead) {
      return NextResponse.json({ items: pending })
    }

    const items = pending.filter((p) => nonRead.has(p.intercomConversationId))

    // Reconcile in the background — never block the response.
    const haveDraft = new Set(pending.map((p) => p.intercomConversationId))
    const noLongerNonRead = pending
      .filter((p) => !nonRead.has(p.intercomConversationId))
      .map((p) => p.intercomConversationId)
    const missing = [...nonRead].filter((id) => !haveDraft.has(id))
    const url = new URL(request.url)
    const origin = url.origin
    // ?force=1 (the manual "Refresh" button) bypasses the recency guard so the
    // agent can generate any still-missing drafts on demand instead of waiting
    // for the next poll window.
    const force = url.searchParams.get("force") === "1"

    after(async () => {
      try {
        if (noLongerNonRead.length > 0) {
          await markSuggestionsStaleByConversations(agentId, noLongerNonRead)
        }
        if (missing.length > 0) {
          let toCompute = missing
          if (!force) {
            const sinceIso = new Date(Date.now() - BACKFILL_WINDOW_MS).toISOString()
            const recent = await getRecentlyTouchedConversationIds(missing, sinceIso)
            toCompute = missing.filter((id) => !recent.has(id))
          }
          for (const id of toCompute.slice(0, BACKFILL_MAX)) {
            await computeAndPersistSuggestion(id, origin).catch(() => {})
          }
        }
      } catch {
        // best-effort reconciliation; the response already went out
      }
    })

    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ items: [], error: "Couldn't load the reply queue." })
  }
}
