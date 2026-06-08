import { NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"

export const dynamic = "force-dynamic"

/**
 * GET /api/slack/emoji
 *
 * Fetches all emoji from Slack's emoji.list API and returns them as a map.
 * This includes both default Slack emoji and any custom workspace emoji.
 *
 * Response shape:
 *   { ok: true, emoji: Record<string, string> }
 *   The value is either a unicode character or an image URL for custom emoji.
 */
export async function GET() {
  const tokens = await getAgentTokens()

  if (!tokens.slackToken) {
    return NextResponse.json({ ok: false, error: "No Slack token" }, { status: 401 })
  }

  try {
    const res = await fetch("https://slack.com/api/emoji.list", {
      headers: { Authorization: `Bearer ${tokens.slackToken}` },
    })

    const data = (await res.json()) as {
      ok: boolean
      emoji?: Record<string, string>
      error?: string
      cache_ts?: string
    }

    if (!data.ok) {
      return NextResponse.json(
        { ok: false, error: data.error ?? "Slack emoji.list failed" },
        { status: 502 },
      )
    }

    // cache_ts can be used to only re-fetch when the list has changed
    return NextResponse.json({
      ok: true,
      emoji: data.emoji ?? {},
      cacheTs: data.cache_ts,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Network error" },
      { status: 502 },
    )
  }
}
