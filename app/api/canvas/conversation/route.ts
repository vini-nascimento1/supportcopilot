import { NextResponse } from "next/server"

import { getConversationDetail } from "@/lib/intercom"

export const dynamic = "force-dynamic"

// Lightweight live refresh for a single canvas: just the Intercom thread + case
// header, no playbook recompute (that's only needed when the canvas first
// opens, via /api/canvas/bootstrap). Used by the canvas refresh button and the
// active-pane auto-refresh poll so reopened/closed conversations stay current.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }

  const conversation = await getConversationDetail(id)
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
  }

  return NextResponse.json({
    caseInfo: {
      conversationId: id,
      customerName: conversation.customer,
      customerEmail: conversation.email,
      state: conversation.state,
      topic: conversation.topic,
      tags: conversation.tags,
      intercomUrl: conversation.intercomUrl,
    },
    conversation: {
      subject: conversation.subject,
      messages: conversation.messages,
    },
  })
}
