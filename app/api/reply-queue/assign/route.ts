import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import { assignConversationToAdmin } from "@/lib/intercom"
import { assignSuggestion } from "@/lib/reply-queue-store"
import {
  computeAndPersistSuggestion,
  type PipelineOutcome,
} from "@/lib/reply-queue-pipeline"

export const dynamic = "force-dynamic"

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
  const { data: agent } = await db
    .from("agents")
    .select("intercom_admin_id")
    .eq("email", email)
    .maybeSingle()

  const adminId = agent?.intercom_admin_id ?? process.env.INTERCOM_ADMIN_ID
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

  // Trigger the Notion deep search (D10: now has an owner, so ai_search runs)
  const origin = new URL(req.url).origin
  let outcome: PipelineOutcome | null = null
  try {
    outcome = await computeAndPersistSuggestion(conversationId, origin)
  } catch {
    // Best-effort — the suggestion row is already assigned; the deep-search
    // recompute is a bonus, not a requirement. The next webhook event will
    // recompute it anyway.
  }

  return NextResponse.json({ ok: true, suggestionOutcome: outcome?.action })
}
