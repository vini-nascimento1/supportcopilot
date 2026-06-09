import { type NextRequest } from "next/server"
import { getSignedInEmail } from "@/lib/auth"
import { getConversationDetail, searchArticles } from "@/lib/intercom"
import { getPlaybooksDashboardData, getResponsesForPlaybookIds } from "@/lib/playbooks"
import { getThreadReplies } from "@/lib/slack"
import { getAgentTokens } from "@/lib/auth"
import {
  buildSlackAwareSystemPrompt,
  buildUserMessage,
  streamChatCompletion,
} from "@/lib/draft-ai"
import type { OpenAIMessage, SlackThreadReply } from "@/lib/draft-ai"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

async function getAgentName(email: string): Promise<string> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return "the support team"
  const { data } = await supabase
    .from("agents")
    .select("name")
    .eq("email", email)
    .maybeSingle()
  return data?.name?.split(" ")[0] ?? "the support team"
}

export async function POST(req: NextRequest) {
  if (!process.env.VERBOO_API_KEY) {
    return new Response("VERBOO_API_KEY is not configured", { status: 503 })
  }

  let body: {
    conversationId?: string
    channelId?: string
    threadTs?: string
    channelName?: string
    playbookId?: string
  }
  try {
    body = (await req.json()) as {
      conversationId?: string
      channelId?: string
      threadTs?: string
      channelName?: string
      playbookId?: string
    }
  } catch {
    return new Response("Invalid JSON body", { status: 400 })
  }

  const { conversationId, channelId, threadTs, channelName, playbookId } = body
  if (!conversationId || !channelId || !threadTs) {
    return new Response("Missing required fields: conversationId, channelId, threadTs", { status: 400 })
  }

  const email = await getSignedInEmail()
  if (!email) {
    return new Response("Authentication required", { status: 401 })
  }

  // Fetch conversation + playbook data
  const [conversation, playbooksData, tokens] = await Promise.all([
    getConversationDetail(conversationId),
    getPlaybooksDashboardData(),
    getAgentTokens(),
  ])

  if (!conversation) {
    return new Response("Conversation not found in Intercom", { status: 404 })
  }

  const playbook = playbookId
    ? playbooksData.allRows.find((p) => p.id === playbookId)
    : undefined

  const responseTemplates = playbookId
    ? ((await getResponsesForPlaybookIds([playbookId])).get(playbookId) ?? [])
    : []

  // Fetch Slack thread
  const threadResult = await getThreadReplies(tokens.slackToken, channelId, threadTs)
  const slackReplies: SlackThreadReply[] = threadResult.ok
    ? threadResult.replies.map((r) => ({
        userName: r.userName,
        text: r.text,
        ts: r.ts,
      }))
    : []

  // Fetch KB articles
  const searchQuery = [conversation.subject, conversation.firstMessage]
    .filter(Boolean)
    .join(" ")
  const articles = await searchArticles(searchQuery)

  const agentName = await getAgentName(email)
  const systemPrompt = buildSlackAwareSystemPrompt(
    playbook,
    responseTemplates,
    agentName,
    articles,
    { channelName: channelName ?? "unknown", replies: slackReplies }
  )
  const userMessage = buildUserMessage(conversation)

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const messages: OpenAIMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ]

        for await (const chunk of streamChatCompletion(messages)) {
          controller.enqueue(encoder.encode(chunk))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI generation failed"
        controller.enqueue(encoder.encode(`[Error: ${msg}]`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
