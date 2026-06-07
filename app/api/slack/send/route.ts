import { NextRequest, NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { sendSlackMessage } from "@/lib/slack"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const tokens = await getAgentTokens()

  const body = (await request.json()) as { channel: string; text: string; threadTs?: string }
  if (!body.channel || !body.text?.trim()) {
    return NextResponse.json({ ok: false, error: "Missing channel or text" }, { status: 400 })
  }

  const result = await sendSlackMessage(tokens.slackToken, body.channel, body.text.trim(), body.threadTs)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Failed to send" }, { status: 502 })
  }

  return NextResponse.json(result)
}
