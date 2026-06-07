import { NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { getSlackFeed } from "@/lib/slack"

export const dynamic = "force-dynamic"

export async function GET() {
  const tokens = await getAgentTokens()
  const feed = await getSlackFeed(tokens.slackToken)
  return NextResponse.json(feed)
}
