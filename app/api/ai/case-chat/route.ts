import { getSignedInEmail } from "@/lib/auth"
import { getConversationDetail } from "@/lib/intercom"
import { getTopMatches } from "@/lib/case-intelligence"
import { getPlaybooksDashboardData } from "@/lib/playbooks"
import { retrieveNotionSnippets } from "@/lib/notion-retrieval-server"
import { classifyNotionSnippetUse } from "@/lib/notion-retrieval"
import {
  streamChatCompletion,
  type OpenAIMessage,
  type OpenAIContentPart,
} from "@/lib/draft-ai"
import { resolveProviderForAgentEmail } from "@/lib/ai-provider"

export const dynamic = "force-dynamic"

const MAX_THREAD_CHARS = 6_000
// Generous ceiling — the agent would rather wait for a complete answer than see
// it cut off. We stream the reply (see below), so even a long vision answer
// renders progressively and never trips a hard server-side timeout the way the
// old non-streaming + 20s-abort path did.
const MAX_TOKENS = 8_192

type ChatMessage = { role: "user" | "assistant"; content: string }

// Case copilot — an AI assistant scoped to ONE open ticket. Unlike
// /api/ai/chat (the automation assistant), its entire context is the current
// conversation + the matched playbooks, so "give me a case summary" means
// THIS case, not the queue.
export async function POST(request: Request) {
  const email = await getSignedInEmail()
  if (!email) {
    return new Response("Authentication required", { status: 401 })
  }
  if (!process.env.VERBOO_API_KEY) {
    return new Response("AI is not configured (missing key)", { status: 500 })
  }
  const provider = (await resolveProviderForAgentEmail(email)) ?? undefined

  const body = await request.json().catch(() => null)
  const conversationId: string | undefined = body?.conversationId
  const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : []
  const images: { name: string; dataUri: string }[] = Array.isArray(body?.images)
    ? body.images
    : []
  if (!conversationId || messages.length === 0) {
    return new Response("conversationId and messages are required", { status: 400 })
  }

  const [conversation, playbooksData] = await Promise.all([
    getConversationDetail(conversationId),
    getPlaybooksDashboardData(),
  ])
  if (!conversation) {
    return new Response("Conversation not found", { status: 404 })
  }

  const searchText = [
    conversation.subject,
    conversation.firstMessage,
    ...conversation.messages
      .filter((m) => m.role === "customer")
      .map((m) => m.body),
  ]
    .filter(Boolean)
    .join(" ")
  const matches = getTopMatches(searchText, playbooksData.allRows, 3)

  // Thread, newest-last, truncated from the start if oversized
  let thread = conversation.messages
    .map(
      (m) =>
        `[${m.role === "customer" ? "CUSTOMER" : m.role === "ai" ? "AI HELPER" : "AGENT"}] ${m.author}: ${m.body}`,
    )
    .join("\n")
  if (thread.length > MAX_THREAD_CHARS) {
    thread = `…(older messages truncated)\n${thread.slice(-MAX_THREAD_CHARS)}`
  }

  const playbookSection = matches.length
    ? matches
        .map(({ playbook }) => {
          const parts = [`### ${playbook.caseType}`]
          if (playbook.recognize) parts.push(`When it applies: ${playbook.recognize}`)
          if (playbook.checks) parts.push(`Internal checks first: ${playbook.checks}`)
          if (playbook.resolution) parts.push(`Resolution:\n${playbook.resolution}`)
          if (playbook.dosDonts) parts.push(`Do NOT: ${playbook.dosDonts}`)
          return parts.join("\n")
        })
        .join("\n\n")
    : "No playbook matched this case — say so when relevant and never invent policy."

  // Ground the copilot in live Notion (the agent's own hosted-MCP connection),
  // keyed on their latest question. Best-effort: [] when not connected/errors.
  const { origin } = new URL(request.url)
  const latestUserQuestion =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? searchText
  const notionSnippets = await retrieveNotionSnippets(email, origin, latestUserQuestion)
  const notionSafe = notionSnippets.filter((s) => classifyNotionSnippetUse(s) === "customerSafe")
  const notionInternal = notionSnippets.filter((s) => classifyNotionSnippetUse(s) === "internalOnly")
  const notionTransientExpired = notionSnippets.filter((s) => classifyNotionSnippetUse(s) === "transientExpired")
  const notionSection = notionSnippets.length
    ? `\n\n## Notion knowledge retrieved live for this question
${notionSafe.length ? `### Support knowledge — may inform customer-facing drafts\n${notionSafe.map((s) => `- ${s.title}: ${s.text}`).join("\n")}` : ""}
${notionInternal.length ? `\n### Internal context — never quote or reveal to customer\n${notionInternal.map((s) => `- [internal · ${s.source}] ${s.title}: ${s.text}`).join("\n")}` : ""}
${notionTransientExpired.length ? `\n### Expired/unverified transient context — do not assert to customer\n${notionTransientExpired.map((s) => `- [${s.source}; timestamp: ${s.timestamp ?? "unknown"}] ${s.title}: ${s.text}`).join("\n")}` : ""}
Use Support knowledge to inform customer-facing wording. Use internal or expired transient context only as a hint for what the agent should verify. Never tell a customer Fanvue is currently in an outage, incident, degraded state, or active bug from internal/expired context.`
    : ""

  const systemPrompt = `You are the Fanvue support copilot embedded in the canvas for ONE open ticket. Fanvue is a British creator-subscription platform. You assist the support agent working THIS case — every question ("summarise the case", "what can it be?", "what should I check?") refers to this ticket unless the agent clearly says otherwise.

## The open case
- Customer: ${conversation.customer}${conversation.email ? ` <${conversation.email}>` : ""}
- State: ${conversation.state} · Topic: ${conversation.topic ?? "—"} · Tags: ${conversation.tags.join(", ") || "—"}
- Subject: ${conversation.subject ?? "—"}

## Conversation thread
${thread || "(empty)"}

## Matched playbooks (source of truth for policy — cite them by name)
${playbookSection}${notionSection}

## How to behave
- Be concise and practical: summaries, likely root causes, the internal checks to run (e.g. fadmin paths from the playbook), and what to reply.
- Never invent policy (KYC rules, payout thresholds, limits). If the playbooks don't cover it, say so explicitly.
- You are draft-only: you never act on external systems — the agent sends every reply themselves.
- You do NOT have live access to Fadmin, account/profile pages, KYC systems, payout processors, media review tools, billing records, or any external admin system. Only the agent can check those.
- Never claim that you checked, reviewed, saw, confirmed, updated, escalated, refunded, approved, rejected, or changed this customer's account/profile/content/payout/KYC/media unless that result is explicitly present in the conversation thread, playbook, Notion snippet, or image evidence.
- If a live account/profile/tool check is needed, tell the agent what to verify; if drafting for the customer, say the team can look into it without pretending the check already happened.
- Use UK English. **Write everything in English only — always.** No matter what language the customer wrote in (Portuguese, Spanish, French — anything), your replies, summaries, and especially any customer-facing draft MUST be in English. Never mirror the customer's language; understand it, then answer in English.
- Plain text or light markdown (bold, short bullets); no headers.
- When asked for a customer-facing reply, follow Fanvue's tone: warm, first-person, "Hey! 👋 thanks for reaching out…", bold key steps, one clear call-to-action.`

  // When the latest user turn carries pasted images, build it as multimodal
  // content (text + image_url parts). selectModel (inside streamChatCompletion)
  // then routes image turns to the vision model and text-only turns to the
  // fast deepseek-v4-flash path.
  const hasImages = images.length > 0
  const windowed = messages.slice(-12)
  const outgoing: OpenAIMessage[] = windowed.map((m, i) => {
    const isLastUser = i === windowed.length - 1 && m.role === "user"
    if (isLastUser && hasImages) {
      const parts: OpenAIContentPart[] = [
        {
          type: "text",
          text: m.content || "What does the attached image show, in this case's context?",
        },
        ...images.map((img) => ({
          type: "image_url" as const,
          image_url: { url: img.dataUri },
        })),
      ]
      return { role: "user", content: parts }
    }
    return { role: m.role, content: m.content }
  })

  const aiMessages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    ...outgoing,
  ]

  // Stream the answer back as plain text (same contract as /api/draft). The
  // vision model is slow, so streaming lets a long answer render progressively
  // instead of racing a hard timeout — which is what produced the recurring
  // "The AI took too long" failure when reading pasted images.
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamChatCompletion(aiMessages, {
          maxTokens: MAX_TOKENS,
          provider,
        })) {
          controller.enqueue(encoder.encode(chunk))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI request failed"
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
