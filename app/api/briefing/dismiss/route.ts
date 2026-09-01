import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import {
  dismissItems,
  parseDismissBody,
  resolveAgentId,
  undismissItems,
  type DismissReason,
} from "@/lib/briefing/dismissals"

export const dynamic = "force-dynamic"

/**
 * Per-item "I have handled this" state for Home.
 *
 *   POST   { ids, reason?, until? } → hide those items from every list and count
 *              reason: "manual" (default) or "acted". Anything else is refused —
 *              "read" is only ever written server-side by the read-signal check
 *              (lib/briefing/read-signals.ts).
 *              until:  ISO timestamp, in the future and at most 14 days out.
 *                      Present ⇒ this is a snooze: the item comes back by itself
 *                      once the time passes. Echoed back in the response.
 *   DELETE { ids }                  → undo, bring them back whatever hid them
 *
 * Session-scoped in both directions, exactly like GET /api/briefing: the agent
 * comes from the session cookie, never from the request, so a caller can only
 * ever change their own briefing. The body carries item ids and nothing else —
 * no titles, no bodies, no counterparties — and only counts are logged.
 */

type ParsedRequest = { ids: string[]; reason: DismissReason; until?: string }

async function readBody(request: Request): Promise<ParsedRequest | { error: string }> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { error: "Expected a JSON body." }
  }
  const parsed = parseDismissBody(body, Date.now())
  if (!parsed.ok) return { error: parsed.error }
  return { ids: parsed.ids, reason: parsed.reason, until: parsed.until }
}

async function handle(request: Request, mode: "dismiss" | "undismiss") {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const parsed = await readBody(request)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const agentId = await resolveAgentId(email)
  if (!agentId) {
    return NextResponse.json({ error: "No agent record found." }, { status: 404 })
  }

  try {
    if (mode === "dismiss") {
      const dismissed = await dismissItems(agentId, parsed.ids, {
        reason: parsed.reason,
        until: parsed.until,
      })
      // `until` only comes back on a snooze, so the client can tell the two
      // apart without re-reading the body it just sent.
      const payload = parsed.until
        ? { dismissed, ids: parsed.ids, until: parsed.until }
        : { dismissed, ids: parsed.ids }
      return NextResponse.json(payload, {
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
