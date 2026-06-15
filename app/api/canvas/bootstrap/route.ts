import { NextResponse } from "next/server"

import { getConversationDetail } from "@/lib/intercom"
import { getTopMatches } from "@/lib/case-intelligence"
import { getPlaybooksDashboardData } from "@/lib/playbooks"

export const dynamic = "force-dynamic"

// Client-side data source for keep-alive canvas panes. The route-per-canvas
// page (app/cases/[id]/canvas/page.tsx) computes this on the server at navigate
// time; in the workspace host panes mount without navigating, so they fetch the
// same payload here. Keep the shape in sync with that page's CaseCanvas props.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }

  const [conversation, playbooksData] = await Promise.all([
    getConversationDetail(id),
    getPlaybooksDashboardData(),
  ])
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

  const topMatch = getTopMatches(ticketText, playbooksData.allRows, 1)[0]

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
    playbookId: topMatch?.playbook.id,
    playbookName: topMatch?.playbook.caseType,
    ticketText,
  })
}
