import { NextResponse, after } from "next/server"

import { resolveIntercomAdminId } from "@/lib/auth"
import { getAgentContext } from "@/lib/automation/rules"
import { assignConversationToAdmin } from "@/lib/intercom"
import { assignSuggestion } from "@/lib/reply-queue-store"
import { removeTriageItems } from "@/lib/triage/store"
import { computeAndPersistSuggestion } from "@/lib/reply-queue-pipeline"

export const dynamic = "force-dynamic"

const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN

// Cap on how many conversations one bulk click can claim — mirrors
// ON_REQUEST_MAX in /api/reply-queue/generate. Anything past the cap is
// dropped and reported back so the caller can surface "assigned N of M".
const BULK_MAX = 15

// Bulk variant of /api/reply-queue/assign: backs the Triage panel's
// multi-select "Assign N + draft" action. Still human-gated — one explicit
// click claims the whole batch, same as the single-row button; the AI never
// auto-assigns.
//
// Each id gets its own real Intercom assignment write, done SEQUENTIALLY (not
// Promise.all): these are live Intercom writes, and keeping them ordered
// makes failures easy to attribute to a specific conversation. Intercom's
// 1000/min limit is not a concern at BULK_MAX conversations.
//
// Draft generation for the newly-assigned ids runs in the BACKGROUND via
// after(), exactly like /api/reply-queue/generate — it's throttled by the
// Verboo gate and can take a while, so the response returns as soon as the
// assignment writes land and drafts surface on the next Queue poll.
// DRAFT-ONLY in that background half: only the assignment writes above are
// synchronous, and only a suggested_replies row is ever written for the
// generation step. Never sends, never re-assigns.
export async function POST(req: Request) {
  const { db, agentId, email } = await getAgentContext()
  if (!db || !agentId || !email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  let conversationIds: unknown
  try {
    ;({ conversationIds } = (await req.json()) as { conversationIds?: unknown })
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const ids = Array.isArray(conversationIds)
    ? Array.from(
        new Set(conversationIds.filter((x): x is string => typeof x === "string" && x.length > 0))
      )
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: "conversationIds required" }, { status: 400 })
  }

  // Resolve the signing-in agent's Intercom admin ID once for the whole batch.
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

  const taken = ids.slice(0, BULK_MAX)
  const dropped = ids.length - taken.length

  const assigned: string[] = []
  const failed: Array<{ conversationId: string; error: string }> = []

  // Sequential, real Intercom writes — see comment above.
  for (const id of taken) {
    const res = await assignConversationToAdmin(id, adminId)
    if (res.ok) {
      await assignSuggestion(id, agentId)
      assigned.push(id)
    } else {
      failed.push({ conversationId: id, error: res.error ?? `Intercom ${res.status}` })
    }
  }

  // Drop the just-assigned ids from the triage pool immediately so they don't
  // linger in the panel until the next sweep. Best-effort.
  await removeTriageItems(assigned)

  // Background draft generation — see the top-of-file comment. Does not block
  // the response; a failure here never unwinds the assignment already made.
  const origin = new URL(req.url).origin
  after(async () => {
    for (const id of assigned) {
      await computeAndPersistSuggestion(id, origin).catch(() => {})
    }
  })

  return NextResponse.json({ assigned: assigned.length, failed, dropped })
}
