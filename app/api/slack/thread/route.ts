import { NextRequest, NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { getThreadReplies } from "@/lib/slack"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const channelId = request.nextUrl.searchParams.get("channel")
  const threadTs = request.nextUrl.searchParams.get("ts")

  if (!channelId || !threadTs) {
    return NextResponse.json({ ok: false, error: "Missing channel or ts parameter" }, { status: 400 })
  }

  const tokens = await getAgentTokens()
  const result = await getThreadReplies(tokens.slackToken, channelId, threadTs)

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Failed to fetch thread replies" }, { status: 500 })
  }

  return NextResponse.json(result)
}
