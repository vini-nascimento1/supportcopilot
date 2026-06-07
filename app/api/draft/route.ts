import { type NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getConversationDetail } from "@/lib/intercom"
import { getPlaybooksDashboardData, getResponsesForPlaybookIds } from "@/lib/playbooks"
import type { PlaybookListItem, ResponseItem } from "@/lib/playbooks"

const AGENT_NAME = "Vinicius"

function buildSystemPrompt(
  playbook: PlaybookListItem | undefined,
  examples: ResponseItem[]
): string {
  const parts: string[] = []

  parts.push(`You are a support copilot for ${AGENT_NAME}, a senior support agent at Fanvue — a creator subscription platform (AI creators and human creators both use it).

Your task: write a warm, helpful customer-facing reply to the conversation below.

## Tone rules
- Warm, personal, first-person. Light emoji (👋 😊 💛) — 1-2 max, never forced.
- Open with: "Hey [name if known]! 👋 Thanks for reaching out to Fanvue Support..."
- Use **bold** for key requirements or action steps.
- Use short bullet lists when listing multiple steps (4 max).
- End with exactly one clear call-to-action.
- Sign off: "Warm regards,\\n${AGENT_NAME} | Fanvue Support 💛"
- Never promise timelines, refunds, or exceptions not stated in the playbook.

## Critical constraints
- Output ONLY the customer-facing message text.
- No intro like "Here's a draft:", no markdown headers, no internal commentary.
- Personalize to the customer's specific situation.
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
  const parts = [`Customer: ${conversation.customer}`, `\nOriginal message:\n${conversation.firstMessage}`]

  const followUps = conversation.messages
    .filter((m) => m.role === "customer" && m.body.trim())
    .slice(0, 3)

  if (followUps.length > 0) {
    parts.push(`\nFollow-up messages from customer:`)
    for (const msg of followUps) {
      parts.push(`- ${msg.body}`)
    }
  }

  parts.push(`\nDraft a reply following the playbook and tone rules above.`)
  return parts.join("\n")
}

async function persistDraft(
  conversationId: string,
  customerName: string,
  playbookId: string | null,
  replyBody: string
): Promise<void> {
  const supabase = getSupabaseAdminClient()
  if (!supabase || !replyBody.trim()) return

  const { data: caseRow } = await supabase
    .from("cases")
    .upsert(
      {
        intercom_conversation_id: conversationId,
        customer_name: customerName,
        playbook_id: playbookId,
        status: "drafted",
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

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response("ANTHROPIC_API_KEY is not configured", { status: 503 })
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

  const systemPrompt = buildSystemPrompt(playbook, responseTemplates)
  const userMessage = buildUserMessage(conversation)

  const anthropic = new Anthropic({ apiKey })
  const encoder = new TextEncoder()
  let fullText = ""

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
          stream: true,
        })

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI generation failed"
        controller.enqueue(encoder.encode(`[Error: ${msg}]`))
      } finally {
        controller.close()
        void persistDraft(conversationId, conversation.customer, playbookId ?? null, fullText)
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
