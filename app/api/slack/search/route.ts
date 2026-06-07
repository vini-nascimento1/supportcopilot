import { NextRequest, NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const tokens = await getAgentTokens()
  if (!tokens.slackToken) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 })
  }

  const query = request.nextUrl.searchParams.get("q")
  if (!query?.trim()) {
    return NextResponse.json({ ok: false, error: "Missing query" }, { status: 400 })
  }

  // Search messages
  const url = new URL("https://slack.com/api/search.messages")
  url.searchParams.set("query", query.trim())
  url.searchParams.set("count", "20")
  url.searchParams.set("sort", "timestamp")
  url.searchParams.set("sort_dir", "desc")

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${tokens.slackToken}` },
  })
  const data = (await res.json()) as {
    ok: boolean
    messages?: {
      matches?: Array<{
        ts: string
        text: string
        channel: { id: string; name: string; is_channel?: boolean; is_im?: boolean; is_mpim?: boolean }
        user?: string
        username?: string
        permalink?: string
      }>
    }
    error?: string
  }

  if (!data.ok) {
    return NextResponse.json({ ok: false, error: data.error ?? "Search failed" }, { status: 502 })
  }

  const results = (data.messages?.matches ?? []).map((m) => ({
    ts: m.ts,
    text: m.text,
    channelId: m.channel.id,
    channelName: m.channel.name ?? m.channel.id,
    userId: m.user ?? "unknown",
    userName: m.username ?? m.user ?? "Unknown",
    permalink: m.permalink,
  }))

  return NextResponse.json({ ok: true, results })
}
