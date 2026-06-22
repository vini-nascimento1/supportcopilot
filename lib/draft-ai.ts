import type { IntercomArticle } from "@/lib/intercom"
import type { PlaybookListItem, ResponseItem } from "@/lib/playbooks"
import type { NotionSnippet } from "@/lib/notion-retrieval"

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

export type OpenAIMessage = {
  role: "system" | "user" | "assistant"
  content: string | OpenAIContentPart[]
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

Playbooks cover only some cases — when the thread and the playbook disagree, the thread wins. Never let a playbook template override what this specific conversation actually needs.

## Respond to the latest message
- You are writing the **next message in an ongoing conversation**, not a standalone reply. It must read like a natural continuation of THIS thread.
- Anchor your reply on the customer's **most recent message**. Everything earlier is background; the last message is what you are actually answering.
- Do NOT repeat greetings, explanations, policies, or steps already stated earlier in the thread — assume the customer has read them. Move the conversation forward; don't restate the last thing.
- If the customer's latest message is a reaction or emotion (resignation, frustration, thanks, "ok I'll do it") rather than a new question, respond to *that* — acknowledge how they feel and reassure — instead of re-explaining policy they've already been given.

## Tone rules
- Warm, personal, first-person. Light emoji (👋 😊 💛) — 1-2 max, never forced.
- **Greet only on the first reply.** If no agent has replied yet in the thread below, open with a warm greeting + thanks (e.g. "Hey! 👋 Thanks for reaching out to Fanvue Support..."). If an agent has already replied and the conversation is mid-flow, do NOT greet or thank again — pick up naturally as the same agent continuing the thread.
- Never use the customer's real name.
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
- **Write in English only.** The customer conversation may be in any language, but your reply must always be in English.

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

// ── Notion-aware system prompt builder ─────────────────────────────────────
// Used for the "tail" (no confident playbook): grounds the draft in fresh
// Notion retrieval (lib/notion-retrieval) while firewalling connector/internal
// content out of the customer-facing text. See spec D10. Mirrors the
// Slack-aware builder above.

export function buildNotionAwareSystemPrompt(
  playbook: PlaybookListItem | undefined,
  examples: ResponseItem[],
  agentName: string,
  articles: IntercomArticle[],
  notionSnippets: NotionSnippet[]
): string {
  const base = buildSystemPrompt(playbook, examples, agentName, articles)
  if (notionSnippets.length === 0) return base

  const citable = notionSnippets.filter((s) => !s.isInternalSource)
  const internal = notionSnippets.filter((s) => s.isInternalSource)

  const sections: string[] = [`\n\n## Fresh knowledge from Notion (retrieved for this case)`]

  if (citable.length > 0) {
    const lines = citable.map((s, i) => `[${i + 1}] ${s.title}: ${s.text}`)
    sections.push(
      `### Support knowledge — you MAY ground your reply on this (paraphrase, never paste)\n${lines.join("\n")}`
    )
  }

  if (internal.length > 0) {
    const lines = internal.map((s) => `- (${s.source}) ${s.title}: ${s.text}`)
    sections.push(
      `### Internal context — DO NOT quote or reveal to the customer\nThese come from internal/connected sources (Slack, Drive, Linear, etc.). Use them ONLY to reason about what is true and what to do internally — never repeat them to the customer.\n${lines.join("\n")}`
    )
  }

  sections.push(`## Firewall rules for the Notion knowledge above
- The customer-facing reply must be **your own paraphrase** in Fanvue tone — never paste a snippet verbatim.
- Ground the reply only on the **Support knowledge** items, the knowledge base articles, and the playbook. Treat the **Internal context** items as background reasoning only.
- Never reveal: internal plans/roadmap, other users' data or flags, Slack channel names, staff names, document names, system/tool names, or that any internal source exists.
- If the only relevant information is in the Internal context, do not invent a customer answer — acknowledge warmly and ask one focused clarifying question, or hold the policy line.`)

  return base + sections.join("\n\n")
}

// ── User message builder ───────────────────────────────────────────────────

export function buildUserMessage(
  conversation: {
    customer: string
    firstMessage: string
    messages: { role: string; body: string }[]
  },
  images?: { name: string; dataUri: string }[]
): string | OpenAIContentPart[] {
  const parts = [`Customer: ${conversation.customer}`]

  // Include the full conversation thread so the AI has complete context
  parts.push(`\nConversation thread:`)
  parts.push(`Customer: ${conversation.firstMessage}`)

  for (const msg of conversation.messages) {
    if (!msg.body.trim()) continue
    const label =
      msg.role === "admin"
        ? "Agent"
        : msg.role === "ai"
          ? "AI helper"
          : "Customer"
    parts.push(`${label}: ${msg.body}`)
  }

  if (images && images.length > 0) {
    parts.push(
      `\nThe customer attached ${images.length} image(s) below. Use them as factual evidence — read any error codes, amounts, IDs, or document details shown — but never infer policy from an image; cite playbooks as usual.`
    )
  }

  parts.push(
    `\nThe latest Customer message above is what you are replying to. Agent and AI helper messages are context about what has already been said or suggested; do not treat them as customer requests. Write the next message in this conversation, anchored on the latest customer message and the context already exchanged. Follow the tone and context rules above. Do not greet again if an agent has already replied, and do not repeat anything already said earlier in the thread.`
  )
  const text = parts.join("\n")

  if (!images || images.length === 0) return text

  return [
    { type: "text", text },
    ...images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: img.dataUri },
    })),
  ]
}

// ── Improve-an-existing-draft builders ─────────────────────────────────────

export function buildImproveSystemPrompt(agentName: string): string {
  return `You are a support copilot for ${agentName}, a senior support agent at Fanvue.

Your task: IMPROVE the existing customer-facing reply draft provided below — do not write a new reply from scratch.

## How to improve
- Keep the draft's meaning, facts, policy, and intent EXACTLY. Never add policy, promises, timelines, or steps that aren't already there.
- Improve tone (warm, personal, first-person, Fanvue voice), clarity, flow, and completeness.
- Light emoji (👋 😊 💛) — 1-2 max, never forced. Use **bold** for key steps; short bullet lists (4 max).
- Do not greet again if the thread shows an agent already replied.

## Critical constraints
- Output ONLY the improved customer-facing message text — ready to copy-paste. No "Here's the improved version:", no headers, no commentary.
- The output IS markdown.
- Never use the customer's real name.
- **Write in English only**, regardless of the conversation's language.`
}

export function buildImproveUserMessage(
  conversation: {
    customer: string
    firstMessage: string
    messages: { role: string; body: string }[]
  },
  currentDraft: string
): string {
  const parts = [`Customer: ${conversation.customer}`, `\nConversation thread:`]
  parts.push(`Customer: ${conversation.firstMessage}`)
  for (const msg of conversation.messages) {
    if (!msg.body.trim()) continue
    parts.push(`${msg.role === "admin" ? "Agent" : "Customer"}: ${msg.body}`)
  }
  parts.push(`\n## Current draft to improve\n${currentDraft}`)
  parts.push(`\nRewrite the draft above per the rules. Output only the improved message.`)
  return parts.join("\n")
}

// ── Macro adaptation user message ─────────────────────────────────────────
// The macro-adapt path must NOT reuse buildUserMessage: that ends with "Write
// the next message in this conversation…", which a flash model follows over the
// system instruction → it writes a generic draft and ignores the macro. This
// builder presents the thread but anchors the task on the macro instead.

export function buildMacroAdaptUserMessage(conversation: {
  customer: string
  firstMessage: string
  messages: { role: string; body: string }[]
}): string {
  const parts = [`Customer: ${conversation.customer}`]

  parts.push(`\nConversation thread:`)
  parts.push(`Customer: ${conversation.firstMessage}`)

  for (const msg of conversation.messages) {
    if (!msg.body.trim()) continue
    const label =
      msg.role === "admin"
        ? "Agent"
        : msg.role === "ai"
          ? "AI helper"
          : "Customer"
    parts.push(`${label}: ${msg.body}`)
  }

  parts.push(
    `\nNow take the **approved macro from the system message** and rewrite it so it fits this conversation, anchored on the latest Customer message. Agent and AI helper messages are context only; do not treat them as customer requests. Always output a complete customer-facing message. Your reply MUST be built from the macro's content — keep its facts, policy, steps and links, and tailor the wording to this case. Do NOT write a fresh, unrelated reply, and do NOT add anything the macro and thread don't support. Output only the customer-facing message.`
  )
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
- **Write in English only.** The Slack thread may be in any language, but your reply must always be in English.

## Internal Slack thread (from #${channelName})
${threadLines.join("\n")}

Write the customer-facing reply now:`
}

// ── Macro adaptation prompt ────────────────────────────────────────────────
// Used by /api/draft/adapt-macro — takes an approved (Intercom-synced) macro's
// plain text and the conversation, and rewrites the macro to fit THIS specific
// case in Fanvue tone. Draft-only: the result is shown for review, never sent.
// See spec D9.

export function buildMacroAdaptSystemPrompt(
  macroBodyText: string,
  agentName: string
): string {
  return `You are a support copilot for ${agentName}, a senior support agent at Fanvue — a creator subscription platform (AI creators and human creators both use it).

Your task: **rewrite the approved macro below** so it fits this specific conversation. The macro is canned, approved text and it is your STARTING MATERIAL — you are tailoring it, **not** writing a fresh reply from scratch. Reshape it so it reads as a natural reply to what THIS customer actually asked, but every claim must come from the macro (or the thread).

## How to adapt
- Keep the macro's **facts, policy, requirements, steps, and links exactly** — do not change, soften, or embellish what it states.
- **Do not invent** any policy, requirement, timeline, refund, or exception that is not already in the approved macro or the conversation thread. If the macro doesn't say it, you don't say it.
- Rephrase the macro to address the customer's specific question and situation — drop parts that clearly don't apply, reorder so the most relevant point comes first, and connect it to what they actually wrote.
- Read the full thread: do not repeat greetings, policies, or steps the customer has already been given earlier. Pick up naturally where the conversation is.

## Tone rules
- Warm, personal, first-person. Light emoji (👋 😊 💛) — 1-2 max, never forced.
- Greet only if no agent has replied yet in the thread; otherwise continue naturally as the same agent.
- Never use the customer's real name.
- Use **bold** for the key requirements or action steps.
- Use short bullet lists when listing multiple steps (4 max).
- End with exactly one clear call-to-action.
- No sign-off footer (no "Warm regards", no name, no title).

## Critical constraints
- Output ONLY the customer-facing message text (markdown) — ready to copy-paste.
- Never return an empty message. If the macro is thin, still produce a complete customer-facing reply grounded in the macro.
- No preamble like "Here's the adapted macro:", no markdown headers (no ##, no ###), no internal commentary.
- **Write in English only.** The conversation may be in any language, but your adapted reply must always be in English.

## Approved macro to adapt
${macroBodyText}`
}

export function selectModel(messages: OpenAIMessage[]): string {
  const hasImage = messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((part) => part.type === "image_url")
  )
  return hasImage ? "qwen3.6-27b" : "deepseek-v4-flash"
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
      model: selectModel(messages),
      max_tokens: 4096,
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
