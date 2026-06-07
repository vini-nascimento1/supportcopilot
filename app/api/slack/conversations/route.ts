import { NextRequest, NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { getUserConversations, getConversationMessages } from "@/lib/slack"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const tokens = await getAgentTokens()
  const channelId = request.nextUrl.searchParams.get("channel")

  if (channelId) {
    // Fetch messages for a specific channel
    const result = await getConversationMessages(tokens.slackToken, channelId, 50)
    if (!result) {
      return NextResponse.json({ ok: false, error: "Failed to fetch messages" }, { status: 500 })
    }
    return NextResponse.json({ ok: true, messages: result.messages, channelName: result.channelName })
  }

  // Fetch all user conversations
  const result = await getUserConversations(tokens.slackToken)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Failed to fetch conversations" }, { status: 500 })
  }
  return NextResponse.json(result)
}
