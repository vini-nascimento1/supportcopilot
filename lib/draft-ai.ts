import type { IntercomArticle } from "@/lib/intercom"
import type { PlaybookListItem, ResponseItem } from "@/lib/playbooks"

export type OpenAIMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

const VERBOO_API_KEY = process.env.VERBOO_API_KEY
const VERBOO_BASE_URL = process.env.VERBOO_BASE_URL ?? "https://code.verboo.ai/router/v1"

// ── System prompt builder ──────────────────────────────────────────────────

export function buildSystemPrompt(
  playbook: PlaybookListItem | undefined,
  examples: ResponseItem[],
  agentName: string,
  articles: IntercomArticle[]
): string {
  const parts: string[] = []

  parts.push(`You are a support copilot for ${agentName}, a senior support agent at Fanvue — a creator subscription platform (AI creators and human creators both use it).

Your task: write a warm, helpful customer-facing reply to the conversation below.

## Context hierarchy (most to least important)
1. **The conversation thread** — this is your primary context. Read the full exchange to understand what has already been said, asked, and answered.
2. **Internal knowledge base articles** — these are your factual source of truth. Reference them for policy, steps, and procedures.
3. **The playbook** — guides the type of case and provides resolution guidance, dos/donts, and example responses.

## Tone rules
- Warm, personal, first-person. Light emoji (👋 😊 💛) — 1-2 max, never forced.
- Open with: "Hey! 👋 Thanks for reaching out to Fanvue Support..." — do NOT use the customer's real name.
- Use **bold** for key requirements or action steps.
- Use short bullet lists when listing multiple steps (4 max).
- End with exactly one clear call-to-action.
- No sign-off footer (no "Warm regards", no name, no title).
- Never promise timelines, refunds, or exceptions not stated in the playbook or articles.

## Critical constraints
- Output ONLY the customer-facing message text — ready to copy-paste.
- The draft IS markdown: use **bold**, bullet lists, and line breaks for readability.
- No intro like "Here's a draft:", no markdown headers (no ##, no ###), no internal commentary.
- Personalize to the customer's specific situation without using their real name.
- If the playbook and articles don't cover the issue, acknowledge warmly and ask one focused clarifying question.

## Closing the conversation
- If the customer has already been answered per the knowledge base articles (policy, steps, or procedures already explained in the thread) and they keep insisting or asking the same thing: **be firm but polite, restate the policy one last time, and signal that the conversation is being closed**.
- Do not keep re-explaining the same thing. One final clear summary + close.
- This is especially important for policy or moderation decisions — acknowledge their frustration, hold the line, and end the conversation.`)

  if (playbook) {
    const sections: string[] = [`\n## Playbook: ${playbook.caseType}`]
    if (playbook.recognize) sections.push(`**When to use:** ${playbook.recognize}`)
    if (playbook.resolution) sections.push(`**Resolution guidance:**\n${playbook.resolution}`)
    if (playbook.dosDonts) sections.push(`**Important — do not:** ${playbook.dosDonts}`)
    parts.push(sections.join("\n\n"))
  }

  if (articles.length > 0) {
    const articleSection = [`\n## Internal knowledge base articles (use as reference)`]
    for (const art of articles) {
      const snippet = [`### ${art.title}`]
      if (art.description) snippet.push(`*${art.description}*`)
      snippet.push(art.bodySnippet)
      articleSection.push(snippet.join("\n\n"))
    }
    parts.push(articleSection.join("\n\n"))
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

// ── Slack-aware system prompt builder ──────────────────────────────────────

export type SlackThreadReply = {
  userName: string
  text: string
  ts: string
}

export function buildSlackAwareSystemPrompt(
  playbook: PlaybookListItem | undefined,
  examples: ResponseItem[],
  agentName: string,
  articles: IntercomArticle[],
  slackThread: { channelName: string; replies: SlackThreadReply[] }
): string {
  const base = buildSystemPrompt(playbook, examples, agentName, articles)

  const threadLines = slackThread.replies.map(
    (r) => `${r.userName}: ${r.text}`
  )

  const slackSection = `\n\n## Slack thread context (internal)
Below is an internal Slack thread from the #${slackThread.channelName} channel discussing this customer's case.

Use this as context ONLY — do NOT copy the internal language verbatim.

Thread:
${threadLines.join("\n")}

## Important: translate internal language
The Slack thread above contains internal team discussion. When writing the customer-facing reply, follow these rules:

- Convert internal language into clear, professional customer-facing wording.
- Do NOT expose: internal system names, Slack messages as quoted text, staff names, IDs, moderation labels, or backend details.
- Do NOT use phrases like: "admin notes," "internal review notes," "workflow," "we flagged you internally," "ticket," "case," or "escalated to the team."
- Instead use: "following a review," "during our review," "after checking," "we have reviewed your account."
- Do NOT mention that a Slack thread or workflow exists. The customer should never know about internal tools.
- If the thread contains conflicting opinions, use the most recent decision or the playbook's guidance.
- If the thread contains instructions from senior staff, follow them but rephrase them in customer-facing language.
- Maintain the same warm, first-person tone from the main prompt.`

  return base + slackSection
}

// ── User message builder ───────────────────────────────────────────────────

export function buildUserMessage(conversation: {
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

// ── Focused Slack thread translation prompt ───────────────────────────────
// Used by /api/draft/from-slack — purely translates internal Slack discussion
// into customer-facing wording. No playbooks, no KB articles, no extra context.

export function buildSlackTranslationPrompt(
  channelName: string,
  replies: SlackThreadReply[]
): string {
  const threadLines = replies.map((r) => `${r.userName}: ${r.text}`)

  return `You are a support agent at Fanvue — a creator subscription platform.

Your task: rewrite the internal Slack thread below into a clear, professional customer-facing reply.

## Rules
- Convert internal language into clear, professional customer-facing wording.
- Do NOT expose: internal system names, Slack messages as quoted text, staff names, IDs, moderation labels, or backend details.
- Do NOT use phrases like: "admin notes," "internal review notes," "workflow," "we flagged you internally," "ticket," "case," or "escalated to the team."
- Instead use: "following a review," "during our review," "after checking," "we have reviewed your account."
- Do NOT mention that a Slack thread or workflow exists. The customer should never know about internal tools.
- If the thread contains conflicting opinions, use the most recent decision.
- If the thread contains instructions from senior staff, follow them but rephrase them.
- Maintain a warm, professional first-person tone.
- Output ONLY the customer-facing message — ready to copy-paste. No intro, no markdown headers, no internal commentary.
- Never promise timelines, refunds, or exceptions not stated in the thread.

## Internal Slack thread (from #${channelName})
${threadLines.join("\n")}

Write the customer-facing reply now:`
}

export async function* streamChatCompletion(
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
