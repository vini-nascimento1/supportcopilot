import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { buildBriefing } from "@/lib/briefing/build"

export const dynamic = "force-dynamic"
// The build fans out to Intercom, Slack, Gmail and Calendar and can run up to
// three grounded research calls, so it needs more than the default budget.
export const maxDuration = 120

/**
 * The signed-in agent's Home briefing. Session-scoped in both directions: the
 * email comes from the session cookie only (never the request), and the
 * response carries the `Briefing` contract and nothing else — no OAuth token,
 * no raw provider payload.
 */
export async function GET(request: Request) {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  try {
    // Origin is needed for the Notion MCP token exchange during research.
    const { origin } = new URL(request.url)
    const briefing = await buildBriefing(email, { origin })
    return NextResponse.json(briefing, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (e) {
    console.error("[briefing] GET failed:", (e as Error).message)
    return NextResponse.json({ error: "Couldn't build your briefing." }, { status: 500 })
  }
}
