import { NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { getGmailUnreadCount } from "@/lib/gmail-client"

export const dynamic = "force-dynamic"

export async function GET() {
  const tokens = await getAgentTokens()
  if (!tokens.googleToken) {
    return NextResponse.json({ connected: false })
  }

  const result = await getGmailUnreadCount(tokens.googleToken, tokens.email)
  return NextResponse.json(result)
}
