import { type NextRequest } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getSignedInEmail } from "@/lib/auth"
import { getConversationDetail, searchArticles } from "@/lib/intercom"
import { getPlaybooksDashboardData, getResponsesForPlaybookIds } from "@/lib/playbooks"
import {
  buildSystemPrompt,
  buildNotionAwareSystemPrompt,
  buildGroundedDraftUserMessage,
  buildImproveSystemPrompt,
  buildImproveUserMessage,
  streamChatCompletion,
} from "@/lib/draft-ai"
import type { OpenAIMessage } from "@/lib/draft-ai"
import { encodeImageAttachments } from "@/lib/attachments"
import { retrieveNotionSnippets } from "@/lib/notion-retrieval-server"

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

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!process.env.VERBOO_API_KEY) {
    return new Response("VERBOO_API_KEY is not configured", { status: 503 })
  }

  let body: {
    conversationId?: string
    playbookId?: string
    mode?: "generate" | "improve"
    currentDraft?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return new Response("Invalid JSON body", { status: 400 })
  }

  const { conversationId, playbookId, mode, currentDraft } = body
  if (!conversationId) {
    return new Response("conversationId is required", { status: 400 })
  }
  if (mode === "improve" && !currentDraft?.trim()) {
    return new Response("currentDraft is required to improve", { status: 400 })
  }

  // Require authenticated session
  const email = await getSignedInEmail()
  if (!email) {
    return new Response("Authentication required", { status: 401 })
  }

  const [conversation, playbooksData] = await Promise.all([
    getConversationDetail(conversationId),
    getPlaybooksDashboardData(),
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

  const agentName = await getAgentName(email)

  let systemPrompt: string
  let userMessage: OpenAIMessage["content"]

  if (mode === "improve") {
    systemPrompt = buildImproveSystemPrompt(agentName)
    userMessage = buildImproveUserMessage(conversation, currentDraft as string)
  } else {
    // Fetch relevant Intercom Help Center articles for extra context.
    const searchQuery = [conversation.subject, conversation.firstMessage]
      .filter(Boolean)
      .join(" ")
    const articles = await searchArticles(searchQuery)

    // Always ground in live Notion (best-effort), for BOTH the head (a playbook
    // matched) and the tail (none) — the playbook gives the procedure, Notion adds
    // fresh KB/connector context, with internal sources firewalled out of the
    // customer text. Falls back to the base prompt when retrieval yields nothing
    // (not connected, needs re-consent, or no hits).
    const { origin } = new URL(req.url)
    const snippets = await retrieveNotionSnippets(email, origin, searchQuery)
    systemPrompt =
      snippets.length > 0
        ? buildNotionAwareSystemPrompt(playbook, responseTemplates, agentName, articles, snippets)
        : buildSystemPrompt(playbook, responseTemplates, agentName, articles)

    const images = await encodeImageAttachments(conversation.messages)
    userMessage = await buildGroundedDraftUserMessage(conversation, images)
  }

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
