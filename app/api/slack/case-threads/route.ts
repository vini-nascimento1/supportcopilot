import { NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { getConversationDetail } from "@/lib/intercom"

export const dynamic = "force-dynamic"

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

    // Group matches by thread parent ts (or original ts if not a thread reply)
    const threadMap = new Map<string, {
      ts: string
      channelId: string
      channelName: string
      snippet: string
      participantNames: Set<string>
      messageCount: number
      permalink: string | null
      latestTs: string
    }>()

    for (const match of data.messages?.matches ?? []) {
      const threadKey = match.ts // use message's own ts since search.messages doesn't return thread info
      // We'll treat each unique message/thread as its own entry
      if (!threadMap.has(threadKey)) {
        threadMap.set(threadKey, {
          ts: match.ts,
          channelId: match.channel.id,
          channelName: match.channel.name ?? match.channel.id,
          snippet: match.text.slice(0, 200),
          participantNames: new Set([match.username ?? match.user ?? "Unknown"]),
          messageCount: 1,
          permalink: match.permalink ?? null,
          latestTs: match.ts,
        })
      }
    }

    const threads = Array.from(threadMap.values())
      .sort((a, b) => b.latestTs.localeCompare(a.latestTs))
      .map((t) => ({
        ts: t.ts,
        channelId: t.channelId,
        channelName: t.channelName,
        snippet: t.snippet,
        participantCount: t.participantNames.size,
        participantNames: Array.from(t.participantNames),
        messageCount: t.messageCount,
        permalink: t.permalink,
      }))

    return NextResponse.json({ ok: true, threads })
  }

  // All tokens tried and all failed with missing_scope
  if (lastError === "missing_scope") {
    return NextResponse.json({
      ok: false,
      error: "missing_scope",
      detail: "Slack search scope (search:read) is not available. Ask your workspace admin to add it.",
    })
  }

  return NextResponse.json({ ok: false, error: "search_failed", detail: lastError })
}
