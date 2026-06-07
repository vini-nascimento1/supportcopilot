import { NextRequest, NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const tokens = await getAgentTokens()
  if (!tokens.slackToken) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 })
  }

  const { channel, name, timestamp } = (await req.json()) as {
    channel?: string; name?: string; timestamp?: string
  }
  if (!channel || !name || !timestamp) {
    return NextResponse.json({ ok: false, error: "Missing channel, name, or timestamp" }, { status: 400 })
  }

  const res = await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, name, timestamp }),
  })
  const data = (await res.json()) as { ok: boolean; error?: string }

  if (!data.ok) {
    return NextResponse.json({ ok: false, error: data.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
