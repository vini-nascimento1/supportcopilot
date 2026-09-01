import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { buildBriefing } from "@/lib/briefing/build"

export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * "Refresh" on Home: rebuild the briefing ignoring the 5-minute cache and
 * write the fresh copy back. POST because it does real upstream work and a
 * cache write — a GET must stay safe to prefetch.
 *
 * Same session rule as GET: the agent is taken from the session, so this can
 * only ever rebuild the caller's own briefing.
 */
export async function POST(request: Request) {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  try {
    const { origin } = new URL(request.url)
    const briefing = await buildBriefing(email, { force: true, origin })
    return NextResponse.json(briefing, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("[briefing] refresh failed:", (e as Error).message)
    return NextResponse.json({ error: "Couldn't refresh your briefing." }, { status: 500 })
  }
}
