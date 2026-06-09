import { NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { getConversationDetail } from "@/lib/intercom"

export const dynamic = "force-dynamic"

/**
 * Resolve the bot user id via auth.test, so we can filter out messages
 * sent by the Support Copilot bot itself (e.g. SLA breach alerts).
 */
async function resolveBotUserId(token: string): Promise<string | null> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await res.json()) as { ok?: boolean; user_id?: string }
    return data.ok ? (data.user_id ?? null) : null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const conversationId = searchParams.get("conversationId")

  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "Missing conversationId" }, { status: 400 })
  }

  // Fetch conversation to get customer email
  const conversation = await getConversationDetail(conversationId)
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 })
  }

  const email = conversation.email
  if (!email) {
    return NextResponse.json({ ok: false, error: "no_email" })
  }

  // Get auth tokens
  const tokens = await getAgentTokens()
  const userToken = tokens.slackToken
  const botToken = process.env.SLACK_BOT_TOKEN ?? null

  // Try user token first, then bot token as fallback
  const tokensToTry = [
    { token: userToken, label: "user" },
    { token: botToken, label: "bot" },
  ].filter((t): t is { token: string; label: string } => t.token !== null && t.token !== undefined)

  if (tokensToTry.length === 0) {
    return NextResponse.json({ ok: false, error: "auth_required", detail: "No Slack token configured." })
  }

  let lastError: string | null = null

  for (const { token } of tokensToTry) {
    // Resolve bot user id so we can filter out bot's own messages (SLA alerts, etc.)
    const botUserId = await resolveBotUserId(token)

    // Search for messages containing the customer email
    const url = new URL("https://slack.com/api/search.messages")
    url.searchParams.set("query", `"${email}"`)
    url.searchParams.set("count", "20")
    url.searchParams.set("sort", "timestamp")
    url.searchParams.set("sort_dir", "desc")

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
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
          team?: string
        }>
      }
      error?: string
    }

    if (!data.ok) {
      if (data.error === "missing_scope") {
        lastError = "missing_scope"
        continue // try next token
      }
      return NextResponse.json({ ok: false, error: "search_failed", detail: data.error })
    }

    // Filter out bot's own messages (automation alerts, SLA warnings) and DMs with bot
    const validMatches = (data.messages?.matches ?? []).filter((m) => {
      if (botUserId && m.user === botUserId) return false
      if (m.channel.is_im) return false
      return true
    })

    if (validMatches.length === 0) {
      continue // try next token if available
    }

    // Take only the most recent match (first since sorted desc)
    const latest = validMatches[0]

    return NextResponse.json({
      ok: true,
      threads: [{
        ts: latest.ts,
        channelId: latest.channel.id,
        channelName: latest.channel.name ?? latest.channel.id,
        snippet: latest.text.slice(0, 200),
        participantCount: 1,
        participantNames: [latest.username ?? latest.user ?? "Unknown"],
        messageCount: 1,
        permalink: latest.permalink ?? null,
      }],
    })
  }

  // No valid results found across all tokens
  if (lastError === "missing_scope") {
    return NextResponse.json({
      ok: false,
      error: "missing_scope",
      detail: "Slack search scope (search:read) is not available. Ask your workspace admin to add it.",
    })
  }

  // Clean "no results" case (no error, just nothing found)
  return NextResponse.json({ ok: true, threads: [] })
}
