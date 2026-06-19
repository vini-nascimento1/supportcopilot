import { NextResponse } from "next/server"

import { getConversationDetail } from "@/lib/intercom"
import { getTopMatches } from "@/lib/case-intelligence"
import {
  classifyPlaybookMatch,
  GATE_CONFIDENCE_THRESHOLD,
} from "@/lib/playbook-gate"
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

  const gate = await classifyPlaybookMatch(ticketText, playbooksData.allRows)

  // On a Verboo error, degrade to the legacy keyword matcher so behaviour
  // never regresses; otherwise honour the confidence threshold.
  const matched =
    gate.reason === "error"
      ? getTopMatches(ticketText, playbooksData.allRows, 1)[0]?.playbook ?? null
      : gate.playbookId && gate.confidence >= GATE_CONFIDENCE_THRESHOLD
        ? playbooksData.allRows.find((p) => p.id === gate.playbookId) ?? null
        : null

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
    playbookId: matched?.id,
    playbookName: matched?.caseType,
    gate: {
      matched: Boolean(matched),
      confidence: gate.confidence,
      reason: gate.reason,
    },
    ticketText,
  })
}
