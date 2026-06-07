import { NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { getGmailThread } from "@/lib/gmail-client"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const tokens = await getAgentTokens()
  if (!tokens.googleToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const thread = await getGmailThread(tokens.googleToken, id, tokens.email)
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 })
  }

  return NextResponse.json(thread)
}
