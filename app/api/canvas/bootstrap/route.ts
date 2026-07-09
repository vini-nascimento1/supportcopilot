import { NextResponse } from "next/server"

import { getConversationDetail } from "@/lib/intercom"

export const dynamic = "force-dynamic"

// Client-side data source for keep-alive canvas panes. The route-per-canvas
// page (app/cases/[id]/canvas/page.tsx) computes this on the server at navigate
// time; in the workspace host panes mount without navigating, so they fetch the
// same payload here. Keep the shape in sync with that page's CaseCanvas props.
//
// Playbook match is deliberately NOT computed here — it's a live LLM call
// (see /api/canvas/playbook-match) and blocking this payload on it made every
// pane take seconds to mount. CaseCanvas fetches the match separately once
// this payload (and the pane) has already rendered.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }

  const conversation = await getConversationDetail(id)
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
  }

  const ticketText = [
    conversation.subject,
    conversation.firstMessage,
    ...conversation.messages
      .filter((m) => m.role === "customer")
      .map((m) => m.body),
  ]
    .filter(Boolean)
    .join(" ")

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
    ticketText,
  })
}
