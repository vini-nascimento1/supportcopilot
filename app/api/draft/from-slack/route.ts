import { type NextRequest } from "next/server"
import { getSignedInEmail } from "@/lib/auth"
import { getConversationDetail } from "@/lib/intercom"
import { getThreadReplies } from "@/lib/slack"
import { getAgentTokens } from "@/lib/auth"
import {
  buildSlackTranslationPrompt,
  streamChatCompletion,
} from "@/lib/draft-ai"
import type { OpenAIMessage, SlackThreadReply } from "@/lib/draft-ai"

export async function POST(req: NextRequest) {
  if (!process.env.VERBOO_API_KEY) {
    return new Response("VERBOO_API_KEY is not configured", { status: 503 })
  }

  let body: {
    conversationId?: string
    channelId?: string
    threadTs?: string
    channelName?: string
  }
  try {
    body = (await req.json()) as {
      conversationId?: string
      channelId?: string
      threadTs?: string
      channelName?: string
    }
  } catch {
    return new Response("Invalid JSON body", { status: 400 })
  }

  const { conversationId, channelId, threadTs, channelName } = body
  if (!conversationId || !channelId || !threadTs) {
    return new Response("Missing required fields: conversationId, channelId, threadTs", { status: 400 })
  }

  const email = await getSignedInEmail()
  if (!email) {
    return new Response("Authentication required", { status: 401 })
  }

  // Fetch conversation for context and Slack thread
  const [conversation, tokens] = await Promise.all([
    getConversationDetail(conversationId),
    getAgentTokens(),
  ])

  if (!conversation) {
    return new Response("Conversation not found in Intercom", { status: 404 })
  }

  // Fetch Slack thread replies
  const threadResult = await getThreadReplies(tokens.slackToken, channelId, threadTs)
  const slackReplies: SlackThreadReply[] = threadResult.ok
    ? threadResult.replies.map((r) => ({
        userName: r.userName,
        text: r.text,
        ts: r.ts,
      }))
    : []

  if (slackReplies.length === 0) {
    return new Response("No replies found in Slack thread", { status: 404 })
  }

  // Use focused translation prompt — no playbooks, no KB articles, no examples
  const systemPrompt = buildSlackTranslationPrompt(
    channelName ?? "unknown",
    slackReplies
  )

  const userMessage = `The customer's name is ${conversation.customer}.

Draft a warm, professional reply to the customer based on the internal thread above.
Use first-person ("I've reviewed your account", "I can confirm", etc.).
Open warmly without using the customer's real name. End with a clear call-to-action.`

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
