import { NextResponse } from "next/server"

import { resolveIntercomAdminId } from "@/lib/auth"
import { getAgentContext } from "@/lib/automation/rules"
import { assignConversationToAdmin } from "@/lib/intercom"
import { assignSuggestion } from "@/lib/reply-queue-store"
import { removeTriageItems } from "@/lib/triage/store"
import {
  computeAndPersistSuggestion,
  type PipelineOutcome,
} from "@/lib/reply-queue-pipeline"

export const dynamic = "force-dynamic"
// The draft is generated inline below (the agent is waiting on it, and the
// canvas opens with it ready). Generation is p50 ~11s but has a long tail, so
// without this the function was killed at the platform default: Intercom had
// the assignment, the draft was lost, and the client saw a failed request.
export const maxDuration = 300

const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN

// Assign an unassigned conversation to the signed-in agent (the 4th human-gated
// Intercom write alongside admin-reply / send-macro / close, per ADR-0011).
// After the Intercom assignment write, triggers the Notion deep search (which
// resolves the owner from the now-set admin_assignee_id → per-user token).
//
// The AI NEVER auto-assigns — assignment only happens on this explicit click.
export async function POST(req: Request) {
  const { db, agentId, email } = await getAgentContext()
  if (!db || !agentId || !email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  let conversationId: string | undefined
  try {
    ;({ conversationId } = (await req.json()) as { conversationId?: string })
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 })
  }

  // Resolve the signing-in agent's Intercom admin ID
  const adminId = await resolveIntercomAdminId(email)
  if (!adminId) {
    return NextResponse.json(
      { error: "No Intercom admin ID found for your account" },
      { status: 400 }
    )
  }

  if (!INTERCOM_TOKEN) {
    return NextResponse.json({ error: "Server misconfigured — no Intercom token" }, { status: 500 })
  }

  // Human-gated Intercom assignment write
  const assignRes = await assignConversationToAdmin(conversationId, adminId)

  if (!assignRes.ok) {
    return NextResponse.json(
      { error: `Intercom assignment failed: ${assignRes.error ?? "unknown"}` },
      { status: 502 }
    )
  }

  // Claim the pending suggestion row
  await assignSuggestion(conversationId, agentId)

  // Drop it from the triage pool immediately — it's now assigned, so it must
  // not reappear in the Triage panel on the next poll before the sweep catches
  // up (the sweep can lag or run partial). Best-effort.
  await removeTriageItems([conversationId])

  // Trigger the Notion deep search (D10: now has an owner, so ai_search runs).
  // `owner` is passed explicitly because we KNOW whose draft this is — we just
  // wrote the assignment. Without it the pipeline has to map the Intercom
  // assignee back to an agent row, which silently yields nobody when the
  // assignment went out under the shared INTERCOM_ADMIN_ID fallback, or when
  // Intercom's read lags the write we just made.
  const origin = new URL(req.url).origin
  let outcome: PipelineOutcome | null = null
  let draftError: string | null = null
  try {
    outcome = await computeAndPersistSuggestion(conversationId, origin, {
      owner: { id: agentId, email },
      onRequest: true,
    })
  } catch {
    // The assignment itself stands — it's already written in Intercom. But the
    // draft is genuinely missing, and the caller is told so rather than being
    // shown a success toast for a draft that will never appear.
    draftError = "generation error"
  }

  // The draft half can fail while the assignment half succeeds. Report both,
  // so the client can stop claiming "drafting a reply" when nothing is.
  const drafted = outcome?.action === "suggested"
  return NextResponse.json({
    ok: true,
    drafted,
    suggestionOutcome: outcome?.action ?? "skipped",
    draftError: drafted ? null : (draftError ?? outcome?.reason ?? "no draft"),
  })
}
