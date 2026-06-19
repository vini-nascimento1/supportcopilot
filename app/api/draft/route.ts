import { type NextRequest } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getSignedInEmail } from "@/lib/auth"
import { getConversationDetail, searchArticles } from "@/lib/intercom"
import { getPlaybooksDashboardData, getResponsesForPlaybookIds } from "@/lib/playbooks"
import {
  buildSystemPrompt,
  buildNotionAwareSystemPrompt,
  buildUserMessage,
  streamChatCompletion,
} from "@/lib/draft-ai"
import type { OpenAIMessage } from "@/lib/draft-ai"
import { getFreshNotionMcpToken } from "@/lib/notion-mcp-auth-server"
import { searchNotionViaMcp } from "@/lib/notion-mcp-client"
import type { NotionSnippet } from "@/lib/notion-retrieval"

// How many Notion snippets to retrieve for a tail case.
const NOTION_RETRIEVAL_LIMIT = 5

// For the "tail" (no confident playbook), ground the draft in live Notion
// retrieval via the agent's own hosted-MCP connection. Pure best-effort: any
// failure (not connected, needs re-consent, network/MCP error) returns [] and
// the caller falls back to the base prompt — never surfaces an error to the UI.
async function retrieveNotionSnippets(
  email: string,
  origin: string,
  query: string
): Promise<NotionSnippet[]> {
  if (!query.trim()) return []
  try {
    const tokenResult = await getFreshNotionMcpToken(email, origin)
    if (!tokenResult.accessToken) return []
    const result = await searchNotionViaMcp(
      tokenResult.accessToken,
      query,
      NOTION_RETRIEVAL_LIMIT
    )
    return result.backend === "ai_search" ? result.snippets : []
  } catch {
    return []
  }
}

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

  let body: { conversationId?: string; playbookId?: string }
  try {
    body = (await req.json()) as { conversationId?: string; playbookId?: string }
  } catch {
    return new Response("Invalid JSON body", { status: 400 })
  }

  const { conversationId, playbookId } = body
  if (!conversationId) {
    return new Response("conversationId is required", { status: 400 })
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

  // Fetch relevant Intercom Help Center articles for extra context
  const searchQuery = [conversation.subject, conversation.firstMessage]
    .filter(Boolean)
    .join(" ")
  const articles = await searchArticles(searchQuery)

  const agentName = await getAgentName(email)

  // Head (confident playbook) → base prompt unchanged.
  // Tail (no playbook) → ground the draft in live Notion retrieval via the
  // agent's hosted-MCP connection, firewalling internal sources out of the
  // customer text. Falls back to the base prompt when retrieval yields nothing.
  let systemPrompt: string
  if (playbook) {
    systemPrompt = buildSystemPrompt(playbook, responseTemplates, agentName, articles)
  } else {
    const { origin } = new URL(req.url)
    const snippets = await retrieveNotionSnippets(email, origin, searchQuery)
    systemPrompt =
      snippets.length > 0
        ? buildNotionAwareSystemPrompt(playbook, responseTemplates, agentName, articles, snippets)
        : buildSystemPrompt(playbook, responseTemplates, agentName, articles)
  }

  const userMessage = buildUserMessage(conversation)

  const encoder = new TextEncoder()
  let fullText = ""

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const messages: OpenAIMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ]

        for await (const chunk of streamChatCompletion(messages)) {
          fullText += chunk
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
