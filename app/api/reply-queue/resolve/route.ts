import { NextResponse } from "next/server"

import { getAgentContext } from "@/lib/automation/rules"
import {
  logReplyQueueEvent,
  resolveSuggestionOnReply,
  type ReplyQueueAction,
} from "@/lib/reply-queue-store"

export const dynamic = "force-dynamic"

type ResolvePayload = {
  conversationId?: string
  suggestionId?: string
  action?: ReplyQueueAction
  bodyChanged?: boolean
  finalBody?: string
}

// Mark a suggestion resolved after the agent approved it. The actual customer
// send already happened through the human-gated send route (/api/draft/send,
// ADR-0011); this only flips the queue row so it leaves the lobby.
export async function POST(req: Request) {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  let payload: ResolvePayload
  try {
    payload = (await req.json()) as ResolvePayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const { conversationId, suggestionId } = payload
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 })
  }

  const action =
    payload.action === "reject"
      ? "reject"
      : payload.action === "edit" || payload.bodyChanged
        ? "edit"
        : "approve"

  await logReplyQueueEvent({
    action,
    agentId,
    suggestionId,
    conversationId,
    bodyChanged: payload.bodyChanged,
    finalBody: payload.finalBody,
  })
  await resolveSuggestionOnReply(conversationId, action === "reject" ? "stale" : "approved")
  return NextResponse.json({ ok: true })
}
