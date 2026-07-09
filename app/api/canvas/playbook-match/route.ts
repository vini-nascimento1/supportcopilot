import { NextResponse } from "next/server"

import { getTopMatches } from "@/lib/case-intelligence"
import {
  classifyPlaybookMatch,
  GATE_CONFIDENCE_THRESHOLD,
} from "@/lib/playbook-gate"
import { getPlaybooksDashboardData } from "@/lib/playbooks"

export const dynamic = "force-dynamic"

// Playbook match banner for the Conversation card. Split out of
// /api/canvas/bootstrap and the canvas page's server render so the Verboo
// classifier call (a live LLM round trip) never blocks the canvas from
// painting — the client fetches this once the canvas is already up.
export async function POST(request: Request) {
  const { ticketText } = (await request.json().catch(() => ({}))) as {
    ticketText?: string
  }
  if (!ticketText) {
    return NextResponse.json({ playbookId: undefined, playbookName: undefined })
  }

  const playbooksData = await getPlaybooksDashboardData()
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
    playbookId: matched?.id,
    playbookName: matched?.caseType,
  })
}
