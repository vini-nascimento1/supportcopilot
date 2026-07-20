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
  hasAgentPersonallyReplied,
  streamChatCompletion,
} from "@/lib/draft-ai"
import type { OpenAIMessage } from "@/lib/draft-ai"
import { encodeImageAttachments } from "@/lib/attachments"
import { retrieveNotionSnippets } from "@/lib/notion-retrieval-server"
import { resolveProviderForAgentEmail } from "@/lib/ai-provider"

async function getAgent(email: string): Promise<{ name: string; intercomAdminId: string | null }> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return { name: "the support team", intercomAdminId: null }
  const { data } = await supabase
    .from("agents")
    .select("name, intercom_admin_id")
    .eq("email", email)
    .maybeSingle()
  return {
    name: data?.name?.split(" ")[0] ?? "the support team",
    intercomAdminId: (data?.intercom_admin_id as string | undefined) ?? null,
  }
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

  const { name: agentName, intercomAdminId } = await getAgent(email)
  // Route through this agent's personal AI key if they've set one.
  const provider = (await resolveProviderForAgentEmail(email)) ?? undefined

  let systemPrompt: string
  let userMessage: OpenAIMessage["content"]

  // We already have this contact's email (Intercom resolved it to route the
  // conversation) — tell the draft brain so it doesn't ask the customer for
  // it, even though the value itself never enters the prompt.
  const hasKnownEmail = Boolean(conversation.email)

  if (mode === "improve") {
    systemPrompt = buildImproveSystemPrompt(agentName)
    userMessage = buildImproveUserMessage(conversation, currentDraft as string, hasKnownEmail)
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
    // "Has THIS signed-in agent personally replied" — not "has any agent
    // replied". See lib/draft-ai.ts's hasAgentPersonallyReplied for why the
    // generic admin label can't be trusted for this on its own.
    const hasAgentReplied = hasAgentPersonallyReplied(conversation.messages, intercomAdminId)
    systemPrompt =
      snippets.length > 0
        ? buildNotionAwareSystemPrompt(playbook, responseTemplates, agentName, articles, snippets, hasAgentReplied)
        : buildSystemPrompt(playbook, responseTemplates, agentName, articles, hasAgentReplied)

    const images = await encodeImageAttachments(conversation.messages)
    userMessage = await buildGroundedDraftUserMessage(conversation, images, hasAgentReplied, hasKnownEmail, provider)
  }

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const messages: OpenAIMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ]

        // Pass the request signal so a client cancel/disconnect aborts the
        // upstream Verboo stream instead of leaving it running.
        for await (const chunk of streamChatCompletion(messages, { signal: req.signal, provider })) {
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
