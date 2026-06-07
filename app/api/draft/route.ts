import { type NextRequest } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getSignedInEmail } from "@/lib/auth"
import { getConversationDetail } from "@/lib/intercom"
import { getPlaybooksDashboardData, getResponsesForPlaybookIds } from "@/lib/playbooks"
import type { PlaybookListItem, ResponseItem } from "@/lib/playbooks"

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

function buildSystemPrompt(
  playbook: PlaybookListItem | undefined,
  examples: ResponseItem[],
  agentName: string
): string {
  const parts: string[] = []

  parts.push(`You are a support copilot for ${agentName}, a senior support agent at Fanvue — a creator subscription platform (AI creators and human creators both use it).

Your task: write a warm, helpful customer-facing reply to the conversation below.

## Tone rules
- Warm, personal, first-person. Light emoji (👋 😊 💛) — 1-2 max, never forced.
- Open with: "Hey! 👋 Thanks for reaching out to Fanvue Support..." — do NOT use the customer's real name.
- Use **bold** for key requirements or action steps.
- Use short bullet lists when listing multiple steps (4 max).
- End with exactly one clear call-to-action.
- No sign-off footer (no "Warm regards", no name, no title).
- Never promise timelines, refunds, or exceptions not stated in the playbook.

## Critical constraints
- Output ONLY the customer-facing message text — ready to copy-paste.
- The draft IS markdown: use **bold**, bullet lists, and line breaks for readability.
- No intro like "Here's a draft:", no markdown headers (no ##, no ###), no internal commentary.
- Personalize to the customer's specific situation without using their real name.
- If the playbook doesn't cover the issue, acknowledge warmly and ask one focused clarifying question.`)

  if (playbook) {
    const sections: string[] = [`\n## Playbook: ${playbook.caseType}`]
    if (playbook.recognize) sections.push(`**When to use:** ${playbook.recognize}`)
    if (playbook.resolution) sections.push(`**Resolution guidance:**\n${playbook.resolution}`)
    if (playbook.dosDonts) sections.push(`**Important — do not:** ${playbook.dosDonts}`)
    parts.push(sections.join("\n\n"))
  }

  if (examples.length > 0) {
    const exSection = [`\n## Example responses (style reference only — do not copy verbatim)`]
    for (const ex of examples.slice(0, 2)) {
      const body = ex.body.replace(/^FR:\s*/i, "").trim()
      exSection.push(`### ${ex.title}\n${body}`)
    }
    parts.push(exSection.join("\n\n"))
  }

  return parts.join("\n\n")
}

function buildUserMessage(conversation: {
  customer: string
  firstMessage: string
  messages: { role: string; body: string }[]
}): string {
  const parts = [`Customer: ${conversation.customer}`]

  // Include the full conversation thread so the AI has complete context
  parts.push(`\nConversation thread:`)
  parts.push(`Customer: ${conversation.firstMessage}`)

  for (const msg of conversation.messages) {
    if (!msg.body.trim()) continue
    const label = msg.role === "admin" ? "Agent" : "Customer"
    parts.push(`${label}: ${msg.body}`)
  }

  parts.push(`\nDraft a reply following the playbook and tone rules above.`)
  return parts.join("\n")
}

async function persistDraft(
  conversationId: string,
  customerName: string,
  playbookId: string | null,
  replyBody: string,
  email?: string | null
): Promise<void> {
  const supabase = getSupabaseAdminClient()
  if (!supabase || !replyBody.trim()) return

  // Resolve agent id from email so RLS policies can enforce case ownership
  let ownerId: string | undefined
  if (email) {
    const { data: agent } = await supabase
      .from("agents")
      .select("id")
      .eq("email", email)
      .maybeSingle()
    if (agent) ownerId = agent.id
  }

  const { data: caseRow } = await supabase
    .from("cases")
    .upsert(
      {
        intercom_conversation_id: conversationId,
        customer_name: customerName,
        playbook_id: playbookId,
        owner_id: ownerId,
      },
      { onConflict: "intercom_conversation_id" }
    )
    .select("id")
    .single()

  if (!caseRow) return

  const { data: latestVersion } = await supabase
    .from("drafts")
    .select("version")
    .eq("case_id", caseRow.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()

  await supabase.from("drafts").insert({
    case_id: caseRow.id,
    version: (latestVersion?.version ?? 0) + 1,
    reply_body: replyBody,
  })
}

// ── OpenAI-compatible streaming via Verboo router ─────────────────────────

const VERBOO_API_KEY = process.env.VERBOO_API_KEY
const VERBOO_BASE_URL = process.env.VERBOO_BASE_URL ?? "https://code.verboo.ai/router/v1"

type OpenAIMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

async function* streamChatCompletion(
  messages: OpenAIMessage[]
): AsyncGenerator<string> {
  const res = await fetch(`${VERBOO_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VERBOO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      max_tokens: 1024,
      stream: true,
      messages,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error")
    throw new Error(`AI API error (${res.status}): ${text}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response body from AI API")

  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith("data: ")) continue
      const payload = trimmed.slice(6)
      if (payload === "[DONE]") return

      try {
        const parsed = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[]
        }
        const content = parsed.choices?.[0]?.delta?.content
        if (content) yield content
      } catch {
        // skip malformed JSON chunks
      }
    }
  }
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!VERBOO_API_KEY) {
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

  const agentName = await getAgentName(email)
  const systemPrompt = buildSystemPrompt(playbook, responseTemplates, agentName)
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
        try {
          await persistDraft(conversationId, conversation.customer, playbookId ?? null, fullText, email)
        } catch (err) {
          console.error("Failed to persist draft:", err)
        }
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
