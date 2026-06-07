import { NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { getInboxThreads } from "@/lib/gmail-client"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pageToken = searchParams.get("pageToken")
  const query = searchParams.get("q") ?? "in:inbox"

  const tokens = await getAgentTokens()
  if (!tokens.googleToken) {
    return NextResponse.json({ connected: false }, { status: 401 })
  }

  const result = await getInboxThreads(tokens.googleToken, tokens.email, pageToken, query)
  return NextResponse.json(result)
}
