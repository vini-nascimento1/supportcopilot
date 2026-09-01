import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import {
  dismissItems,
  parseItemIds,
  resolveAgentId,
  undismissItems,
} from "@/lib/briefing/dismissals"

export const dynamic = "force-dynamic"

/**
 * Per-item "I have handled this" state for Home.
 *
 *   POST   { ids: string[] }  → hide those items from every list and count
 *   DELETE { ids: string[] }  → undo, bring them back
 *
 * Session-scoped in both directions, exactly like GET /api/briefing: the agent
 * comes from the session cookie, never from the request, so a caller can only
 * ever change their own briefing. The body carries item ids and nothing else —
 * no titles, no bodies, no counterparties — and only counts are logged.
 */

async function readIds(request: Request): Promise<{ ids: string[] } | { error: string }> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { error: "Expected a JSON body." }
  }
  const parsed = parseItemIds(body)
  return parsed.ok ? { ids: parsed.ids } : { error: parsed.error }
}

async function handle(request: Request, mode: "dismiss" | "undismiss") {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const parsed = await readIds(request)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const agentId = await resolveAgentId(email)
  if (!agentId) {
    return NextResponse.json({ error: "No agent record found." }, { status: 404 })
  }

  try {
    if (mode === "dismiss") {
      const dismissed = await dismissItems(agentId, parsed.ids)
      return NextResponse.json({ dismissed, ids: parsed.ids }, {
        headers: { "Cache-Control": "no-store" },
      })
    }
    const restored = await undismissItems(agentId, parsed.ids)
    return NextResponse.json({ restored, ids: parsed.ids }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: mode === "dismiss" ? "Couldn't dismiss those." : "Couldn't undo that." },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  return handle(request, "dismiss")
}

export async function DELETE(request: Request) {
  return handle(request, "undismiss")
}
