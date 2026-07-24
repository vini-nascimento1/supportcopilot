import type { IntercomArticle } from "@/lib/intercom"
import type { PlaybookListItem, ResponseItem } from "@/lib/playbooks"
import {
  classifyNotionSnippetUse,
  type NotionSnippet,
} from "@/lib/notion-retrieval"
import {
  acquireVerbooSlot,
  releaseVerbooSlot,
  parseRetryAfterMs,
  verbooBaseUrl,
  verbooApiKey,
} from "@/lib/verboo-throttle"
import type { AiProvider } from "@/lib/ai-provider"

// Where an outbound completion is sent. Defaults to the shared Verboo router;
// a personal AiProvider overrides base URL + key so an agent's own quota is used.
type StreamEndpoint = { baseUrl: string; apiKey: string | undefined }

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

export type OpenAIMessage = {
  role: "system" | "user" | "assistant"
  content: string | OpenAIContentPart[]
}

const DEFAULT_TEXT_MODEL = "deepseek-v4-flash"
const DEFAULT_VISION_MODEL = "qwen3.6-27b"
const DEFAULT_DRAFT_TEMPERATURE = 0.2

// Reliability guards for the upstream streaming call. Historically a stalled or
// rate-limited Verboo request had no timeout, no retry, and no abort path — the
// stream reader blocked forever, so the Canvas "Generating…" state (and the
// background reply-queue pipeline) hung with no way to cancel. All three are
// overridable via env for ops tuning.
const CONNECT_TIMEOUT_MS = 30_000 // max wait for the response headers (time-to-first-byte)
const STALL_TIMEOUT_MS = 30_000 // max gap allowed between streamed chunks
const MAX_RETRIES = 2 // extra attempts on a transient PRE-stream failure (3 total)
const RETRY_BASE_MS = 600 // exponential backoff base: 600ms, 1.2s, 2.4s… (capped)
const RETRY_MAX_MS = 5_000
// A 429 is a per-minute window, not a millisecond blip — the 5s network cap is
// too short to clear it. When the router sends Retry-After we honour it up to
// this ceiling (the client watchdog is 45s and the pipeline runs in the
// background, so a longer wait is safe and beats failing the draft outright).
const RATE_LIMIT_MAX_MS = 20_000

type DraftConversation = {
  customer: string
  firstMessage: string
  messages: { role: string; body: string }[]
}

type DraftImage = { name: string; dataUri: string }

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getTextDraftModel(): string {
  return process.env.VERBOO_TEXT_MODEL ?? DEFAULT_TEXT_MODEL
}

export function getVisionDraftModel(): string {
  return process.env.VERBOO_VISION_MODEL ?? DEFAULT_VISION_MODEL
}

// ── Output-language lock ───────────────────────────────────────────────────
// Customer threads are frequently in another language, and that pull is strong:
// a single buried "write in English" line was not enough — drafts still mirrored
// the customer. So we state it emphatically in the system prompt AND repeat it as
// the very last thing in the user turn (recency, right after a wall of foreign
// text). Fanvue Support replies are ALWAYS in English. Keep the literal phrase
// "English only" — a test asserts on it.
const ENGLISH_ONLY_RULE =
  "**Write in English only — always.** No matter what language the customer wrote in (Portuguese, Spanish, French, German, Italian, Arabic — anything), your reply MUST be in English. Never mirror or match the customer's language. Understand their message in whatever language it is, then write your reply in English. Fanvue Support always replies in English."

const ENGLISH_ONLY_REMINDER =
  "⚠️ Language: write your ENTIRE reply in English, regardless of the language used above. Do NOT reply in the customer's language — translate your response into English."

// ── Privacy: never leak the customer's real identity ────────────────────────
// The customer label from Intercom is the contact's REAL name (or email) — never
// the Fanvue creator alias. Feeding it to the model caused replies to address
// people by their legal name, breaking the de-anonymisation rule. We now withhold
// it entirely: the thread turns are still labelled "Customer:"/"Agent:" so the
// model can follow the exchange, but the actual name never enters the prompt.
//
// Withholding the value ALSO withheld the fact that we have one on file — the
// model, with zero signal either way, defaulted to the generic "what's the
// email you use to log in?" ask even when the agent can see the contact's
// email right there in the queue card. Pass whether we have one (never the
// value itself, so the anonymisation guarantee above is unchanged) so the
// model can skip that redundant ask.
function customerPrivacyHeader(hasKnownEmail: boolean): string {
  const emailNote = hasKnownEmail
    ? " This customer's account email is already on file for this conversation — do NOT ask them to share their email or account email. If you need to look into their account, just say you'll check the account on file."
    : ""
  return `Customer identity: withheld for privacy. Never address the customer by name, never guess or invent a name, and never repeat any real name or email that appears inside the thread.${emailNote}`
}

// ── Greeting logic ──────────────────────────────────────────────────────────
// "Has an agent replied" is not the right question — most threads already carry
// a reply from SOME teammate (another agent's holding message, or the bot's
// assignment greeting), which made the model think a greeting had already
// happened even when THIS agent had never personally said a word. The label in
// the thread text is a generic "Agent:" for every teammate, so the model can't
// tell them apart from wording alone — this has to be computed in code from the
// Intercom author id and handed down as an explicit fact.
export type MessageForGreetingCheck = { role: string; authorId?: string | null }

export function hasAgentPersonallyReplied(
  messages: MessageForGreetingCheck[],
  agentAdminId: string | null | undefined
): boolean {
  if (!agentAdminId) return false
  return messages.some((m) => m.role === "admin" && m.authorId === agentAdminId)
}

// The mandatory opening line for a reply where THIS agent has not spoken in the
// thread yet (feedback: Vincenzo greeting rule). The reply-queue pipeline injects
// this deterministically AFTER generation rather than trusting the model to
// reproduce it, so the exact wording AND the agent's name are guaranteed on every
// draft. When there is no real agent name (generic fallback), the "I'm X" clause
// is dropped rather than reading "I'm the support team".
export function buildAgentGreeting(agentName: string): string {
  const name = agentName && agentName !== "the support team" ? agentName.trim() : ""
  return name
    ? `Hey! 👋 Thanks for reaching out to Fanvue Support, I'm ${name}. I'll do my best to assist you today! 😊`
    : `Hey! 👋 Thanks for reaching out to Fanvue Support. I'll do my best to assist you today! 😊`
}

// greetingInjected = the caller (the reply-queue pipeline) will prepend
// buildAgentGreeting() itself, so the model must NOT write its own greeting or it
// would double up. Left false for the manual/macro-adapt/improve paths, which
// have no code-side injection and still want the model to open warmly.
function greetingToneRule(hasAgentReplied: boolean, greetingInjected: boolean): string {
  if (hasAgentReplied) {
    return `- **Do not greet or thank again.** You (this agent) have already sent at least one message earlier in this thread — pick up naturally as the same agent continuing the conversation, even if a greeting hasn't been used since.`
  }
  if (greetingInjected) {
    return `- **Do not write any opening greeting, thanks line, or your own name.** A standard greeting (already carrying your name) is added automatically before your text — begin directly with the substantive answer to the customer's latest message.`
  }
  return `- **Open with a warm greeting.** You have not personally sent any message in this thread yet — even if a teammate or the AI bot already replied, this is your first message here. Open with a warm greeting + thanks (e.g. "Hey! 👋 Thanks for reaching out to Fanvue Support...") before the actual answer.`
}

// You ARE the agent. The drafts kept reading like a BOT triaging the ticket —
// "our team will review", "I'll escalate to a real agent", "send an email to
// support@fanvue.com" — which is wrong twice over: the agent sending this IS
// the team/human, and an email to support@fanvue.com just becomes another
// ticket in this very queue (a dead-end loop). These rules force the reply to
// read as the human agent who is already handling it.
const AGENT_IDENTITY_RULES = `## You ARE the agent handling this — not a bot routing it
- You are the human support agent working this conversation. Never speak as an intermediary who hands the customer off to "a real agent", "a human agent", "our team", or "the support team" as if that were someone else — that someone is YOU, and you are already on it.
- **Never tell the customer to email support@fanvue.com, "open a ticket", "contact support", or "reach out to our team".** THIS conversation already IS their support ticket, and any email to support@fanvue.com lands right back in this same queue — a pointless loop. Resolve it here, or tell them the one concrete next step.
- Never offer to "help draft an email" for the customer to send to support — there is nothing for them to send; you're the one who acts on it.
- When a case genuinely needs another internal team (payments, compliance, moderation), frame it as something YOU do on your side and report back — e.g. "I'll raise this with our payments team and follow up here." Never phrase it as the customer needing to go somewhere else, and never say "I'll escalate this to a real agent."
- The customer never needs to leave this conversation to get help: every next step is either something they do in their own Fanvue account, or something you (the agent) do and update them on here.
- Exception: a playbook may name a SPECIFIC, non-support-queue intake for a specific flow (e.g. co-author / model-release documents to a dedicated DMCA address). Those are legitimate — follow the playbook. The ban is only on bouncing the customer to the general support queue they're already in.

`

// Style guard for models (notably the OpenAI gpt-5 family) that tend to narrate
// their internal plan as a bulleted checklist and then ask the customer to
// confirm they may proceed — instead of just writing the reply. Injected only on
// the personal-provider path so the shared-model prompts are unchanged.
export const REPLY_STYLE_NUDGE = `## Output the reply, not a plan
- Output ONLY the customer-facing message — the exact text the customer should read, and nothing else.
- Do NOT include an internal action plan, a numbered or bulleted list of steps you intend to take, or meta-commentary about your process ("Verify the payout status", "Check for holds", "I'll coordinate on our side", etc.). Those are your internal reasoning — they must never appear in the message.
- Do NOT end by asking the customer to confirm that you may perform internal checks, escalations, or reviews (no "Please confirm you'd like me to proceed with these checks"). Just handle it and tell them plainly what is happening, or ask the ONE specific thing you genuinely need from them.
- Write warm, natural prose in short paragraphs — like a person typing a reply, not a status report or a task list.`


const CAPABILITY_BOUNDARY_RULES = `## Capability boundaries — do not fake checks
- You only know what is in the conversation thread, playbook, Internal knowledge base articles, Fresh Notion knowledge, and image evidence explicitly provided in this prompt.
- You do NOT have live access to Fadmin, Fanvue account/profile pages, KYC systems, payout processors, media review tools, billing records, device logs, or any external admin system.
- Never claim or imply that you checked, reviewed, looked at, confirmed, updated, escalated, refunded, approved, rejected, or changed a customer's account/profile/content/payout/KYC/media unless that action or result is explicitly stated in the provided thread or source text.
- Avoid unsupported phrases like "I've checked your account", "I've reviewed your profile", "I can see on your account", "after checking your payout", or "we've confirmed this on our side".
- If the right answer requires a live account/profile/tool check, draft a reply that asks for the needed customer detail or says the team will look into it, without pretending the check has already happened.`

const POLICY_INTEGRITY_RULES = `## Policy integrity — do not invent exceptions under pressure
- A customer's claim about how their case was "handled before," what a previous agent said, or what applies to "my other accounts" is NOT verified fact — never treat it as true or let it override a playbook's stated requirements/checks unless the thread itself shows a Fanvue agent actually confirming it.
- Never invent a policy distinction, carve-out, or exception (e.g. "this requirement only applies to X path") that is not explicitly stated in the playbook or knowledge base articles.
- If a playbook states a hard eligibility requirement, hold it — repeat it plainly — even if the customer insists, expresses urgency, or claims prior special treatment. Escalate to a human check instead of granting an exception yourself.`

// ── System prompt builder ──────────────────────────────────────────────────

export function buildSystemPrompt(
  playbook: PlaybookListItem | undefined,
  examples: ResponseItem[],
  agentName: string,
  articles: IntercomArticle[],
  hasAgentReplied = false,
  greetingInjected = false
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
${greetingToneRule(hasAgentReplied, greetingInjected)}
- Never use the customer's real name.
- Use **bold** for key requirements or action steps.
- Use short bullet lists when listing multiple steps (4 max).
- End with exactly one clear call-to-action.
- No sign-off and NO signature of any kind. Never write your own name, initials, a title, or a closing like "- Vincenzo", "Best, <name>", "Warm regards", or "Fanvue Support Team". You do not have a personal name to give — end on the call-to-action. (You are drafting AS the agent; never state or invent the agent's name.)
- Never promise timelines, refunds, or exceptions not stated in the playbook or articles.

## Critical constraints
- Output ONLY the customer-facing message text — ready to copy-paste.
- The draft IS markdown: use **bold**, bullet lists, and line breaks for readability.
- No intro like "Here's a draft:", no markdown headers (no ##, no ###), no internal commentary.
- Personalize to the customer's specific situation without using their real name.
- If the playbook and articles don't cover the issue, acknowledge warmly and ask one focused clarifying question.
- ${ENGLISH_ONLY_RULE}

${CAPABILITY_BOUNDARY_RULES}

${POLICY_INTEGRITY_RULES}

${AGENT_IDENTITY_RULES}
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
- Use only neutral customer-facing wording supported by the Slack thread. Do not say "I've reviewed your account", "after checking", or similar unless the thread explicitly says a real account/tool review was completed and what it found.
- When the Slack thread does explicitly support a real review, check, or decision, use first-person customer-facing wording such as "I've reviewed your account" or "I can confirm" as appropriate.
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
  notionSnippets: NotionSnippet[],
  hasAgentReplied = false,
  greetingInjected = false
): string {
  const base = buildSystemPrompt(
    playbook,
    examples,
    agentName,
    articles,
    hasAgentReplied,
    greetingInjected
  )
  if (notionSnippets.length === 0) return base

  const citable = notionSnippets.filter((s) => classifyNotionSnippetUse(s) === "customerSafe")
  const internal = notionSnippets.filter((s) => classifyNotionSnippetUse(s) === "internalOnly")
  const transientExpired = notionSnippets.filter((s) => classifyNotionSnippetUse(s) === "transientExpired")

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

  if (transientExpired.length > 0) {
    const lines = transientExpired.map((s) => `- (${s.source}; timestamp: ${s.timestamp ?? "unknown"}) ${s.title}: ${s.text}`)
    sections.push(
      `### Expired or unverified transient context — DO NOT assert to the customer\nThese results mention temporary states such as outages, incidents, degraded service, known bugs, or workarounds, but they are too old or lack a usable timestamp for customer-facing claims. Use them only as an internal hint to verify current status before sending.\n${lines.join("\n")}`
    )
  }

  sections.push(`## Firewall rules for the Notion knowledge above
- The customer-facing reply must be **your own paraphrase** in Fanvue tone — never paste a snippet verbatim.
- Ground the reply only on the **Support knowledge** items, the knowledge base articles, and the playbook. Treat the **Internal context** items as background reasoning only.
- Never reveal: internal plans/roadmap, other users' data or flags, Slack channel names, staff names, document names, system/tool names, or that any internal source exists.
- Notion snippets are knowledge/search context, not live account data. Never treat a Notion result as proof that this customer's profile, payout, KYC, or media was checked.
- Never tell a customer that Fanvue is currently in an outage, incident, degraded state, or active bug based on **Internal context** or **Expired or unverified transient context**. Ask the agent to verify current status instead.
- If the only relevant information is in the Internal context, do not invent a customer answer — acknowledge warmly and ask one focused clarifying question, or hold the policy line.`)

  return base + sections.join("\n\n")
}

// ── User message builder ───────────────────────────────────────────────────

export function buildUserMessage(
  conversation: DraftConversation,
  images?: DraftImage[],
  imageEvidence?: string | null,
  hasAgentReplied = false,
  hasKnownEmail = false
): string | OpenAIContentPart[] {
  const parts = [customerPrivacyHeader(hasKnownEmail)]

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

  if (imageEvidence?.trim()) {
    parts.push(`\nCustomer image evidence (internal vision analysis):`)
    parts.push(imageEvidence.trim())
    parts.push(
      `Use the image evidence only as factual context from the customer's attachment(s). Do not mention internal vision analysis, and do not infer policy from the image.`
    )
  }

  parts.push(
    `\nThe latest Customer message above is what you are replying to. Agent and AI helper messages are context about what has already been said or suggested; do not treat them as customer requests. Write the next message in this conversation, anchored on the latest customer message and the context already exchanged. Follow the tone and context rules above (${hasAgentReplied ? "you have already personally replied earlier in this thread — do not greet again" : "you have not personally replied in this thread yet — open with a greeting"}), and do not repeat anything already said earlier in the thread.`
  )
  parts.push(`\n${ENGLISH_ONLY_REMINDER}`)
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

export function buildVisionEvidenceMessages(
  conversation: DraftConversation,
  images: DraftImage[]
): OpenAIMessage[] {
  const thread = buildUserMessage(conversation)
  const text = [
    "Extract only factual evidence from the customer's attached image(s) for a support agent.",
    "Return concise bullets. Include visible error messages, amounts, dates, account/status labels, document fields, IDs, and what screen/page is shown.",
    "Do not guess policy, do not decide the reply, and do not invent anything not visible.",
    "Use the conversation only to disambiguate what matters.",
    "",
    typeof thread === "string" ? thread : "",
  ].join("\n")

  return [
    {
      role: "system",
      content:
        "You are a vision evidence extractor for Fanvue Support. You only describe what is visible in attached customer images.",
    },
    {
      role: "user",
      content: [
        { type: "text", text },
        ...images.map((img) => ({
          type: "image_url" as const,
          image_url: { url: img.dataUri },
        })),
      ],
    },
  ]
}

export async function buildGroundedDraftUserMessage(
  conversation: DraftConversation,
  images: DraftImage[],
  hasAgentReplied = false,
  hasKnownEmail = false,
  provider?: AiProvider
): Promise<string | OpenAIContentPart[]> {
  if (images.length === 0) return buildUserMessage(conversation, undefined, undefined, hasAgentReplied, hasKnownEmail)

  let imageEvidence = ""
  try {
    for await (const chunk of streamChatCompletion(buildVisionEvidenceMessages(conversation, images), {
      model: provider ? provider.visionModel : getVisionDraftModel(),
      maxTokens: 1536,
      temperature: 0,
      provider,
    })) {
      imageEvidence += chunk
    }
  } catch {
    return buildUserMessage(conversation, images, undefined, hasAgentReplied, hasKnownEmail)
  }

  if (!imageEvidence.trim()) return buildUserMessage(conversation, images, undefined, hasAgentReplied, hasKnownEmail)

  return buildUserMessage(conversation, [], imageEvidence, hasAgentReplied, hasKnownEmail)
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
- No signature: never add or keep your own name, initials, or a "- <name>" / "Best, <name>" sign-off. If the draft already has one, remove it.
- ${ENGLISH_ONLY_RULE}

${CAPABILITY_BOUNDARY_RULES}

${POLICY_INTEGRITY_RULES}

${AGENT_IDENTITY_RULES}`
}

export function buildImproveUserMessage(
  conversation: {
    customer: string
    firstMessage: string
    messages: { role: string; body: string }[]
  },
  currentDraft: string,
  hasKnownEmail = false
): string {
  const parts = [customerPrivacyHeader(hasKnownEmail), `\nConversation thread:`]
  parts.push(`Customer: ${conversation.firstMessage}`)
  for (const msg of conversation.messages) {
    if (!msg.body.trim()) continue
    parts.push(`${msg.role === "admin" ? "Agent" : "Customer"}: ${msg.body}`)
  }
  parts.push(`\n## Current draft to improve\n${currentDraft}`)
  parts.push(`\nRewrite the draft above per the rules. Output only the improved message.`)
  parts.push(`\n${ENGLISH_ONLY_REMINDER}`)
  return parts.join("\n")
}

// ── Macro adaptation user message ─────────────────────────────────────────
// The macro-adapt path must NOT reuse buildUserMessage: that ends with "Write
// the next message in this conversation…", which a flash model follows over the
// system instruction → it writes a generic draft and ignores the macro. This
// builder presents the thread but anchors the task on the macro instead.

export function buildMacroAdaptUserMessage(
  conversation: {
    customer: string
    firstMessage: string
    messages: { role: string; body: string }[]
  },
  hasKnownEmail = false
): string {
  const parts = [customerPrivacyHeader(hasKnownEmail)]

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
  parts.push(`\n${ENGLISH_ONLY_REMINDER}`)
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
- Use only neutral customer-facing wording supported by the Slack thread. Do not say "I've reviewed your account", "after checking", or similar unless the thread explicitly says a real account/tool review was completed and what it found.
- When the Slack thread does explicitly support a real review, check, or decision, use first-person customer-facing wording such as "I've reviewed your account" or "I can confirm" as appropriate.
- Do NOT mention that a Slack thread or workflow exists. The customer should never know about internal tools.
- If the thread contains conflicting opinions, use the most recent decision.
- If the thread contains instructions from senior staff, follow them but rephrase them.
- Maintain a warm, professional first-person tone.
- Output ONLY the customer-facing message — ready to copy-paste. No intro, no markdown headers, no internal commentary.
- Never promise timelines, refunds, or exceptions not stated in the thread.
- ${ENGLISH_ONLY_RULE}

${CAPABILITY_BOUNDARY_RULES}

${POLICY_INTEGRITY_RULES}

${AGENT_IDENTITY_RULES}
## Internal Slack thread (from #${channelName})
${threadLines.join("\n")}

${ENGLISH_ONLY_REMINDER}

Write the customer-facing reply now:`
}

// ── Macro adaptation prompt ────────────────────────────────────────────────
// Used by /api/draft/adapt-macro — takes an approved (Intercom-synced) macro's
// plain text and the conversation, and rewrites the macro to fit THIS specific
// case in Fanvue tone. Draft-only: the result is shown for review, never sent.
// See spec D9.

export function buildMacroAdaptSystemPrompt(
  macroBodyText: string,
  agentName: string,
  hasAgentReplied = false
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
${greetingToneRule(hasAgentReplied, false)}
- Never use the customer's real name.
- Use **bold** for the key requirements or action steps.
- Use short bullet lists when listing multiple steps (4 max).
- End with exactly one clear call-to-action.
- No sign-off and NO signature of any kind: never write your own name, initials, a title, or a closing like "- Vincenzo", "Best, <name>", or "Fanvue Support Team". End on the call-to-action.

## Critical constraints
- Output ONLY the customer-facing message text (markdown) — ready to copy-paste.
- Never return an empty message. If the macro is thin, still produce a complete customer-facing reply grounded in the macro.
- No preamble like "Here's the adapted macro:", no markdown headers (no ##, no ###), no internal commentary.
- ${ENGLISH_ONLY_RULE}

${CAPABILITY_BOUNDARY_RULES}

${POLICY_INTEGRITY_RULES}

${AGENT_IDENTITY_RULES}
## Approved macro to adapt
${macroBodyText}`
}

export function buildDraftVerifierMessages(
  sourceMessages: OpenAIMessage[],
  draft: string
): OpenAIMessage[] {
  const sourceText = sourceMessages
    .map((m) => {
      const content = Array.isArray(m.content)
        ? m.content
            .map((part) => (part.type === "text" ? part.text : "[image omitted from verifier]"))
            .join("\n")
        : m.content
      return `${m.role.toUpperCase()}:\n${content}`
    })
    .join("\n\n")

  return [
    {
      role: "system",
      content: `You are a strict grounding verifier for Fanvue Support drafts.

Rewrite the draft only as much as needed so every factual claim is supported by the provided source context.

Rules:
- Preserve the customer's language requirement: final output in English only.
- Output only the corrected customer-facing draft. No commentary.
- Remove or soften any claim that says the agent checked, reviewed, saw, confirmed, updated, escalated, refunded, approved, rejected, or changed an account/profile/content/payout/KYC/media unless the source context explicitly proves that action/result.
- Never invent Fanvue policy, account status, profile state, payout status, KYC result, media-review outcome, or timelines.
- If a live tool/profile/account check would be needed, phrase it as a future/needed check without claiming it already happened.
- Keep the warm support tone, markdown readability, and exactly one clear call-to-action.`,
    },
    {
      role: "user",
      content: `## Source context
${sourceText}

## Draft to verify
${draft}

Return the corrected draft now.`,
    },
  ]
}

function messagesHaveImage(messages: OpenAIMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((part) => part.type === "image_url")
  )
}

export function selectModel(messages: OpenAIMessage[]): string {
  return messagesHaveImage(messages) ? getVisionDraftModel() : getTextDraftModel()
}

// Transient statuses worth a retry (rate limit + upstream/gateway hiccups).
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError"
}

// Backoff sleep that resolves early (rejecting) if the caller aborts. When the
// server hands us an explicit Retry-After (a 429 window), honour it — clamped to
// [RETRY_BASE_MS, RATE_LIMIT_MAX_MS] — instead of the short network backoff.
function backoffDelay(
  attempt: number,
  signal?: AbortSignal,
  explicitMs?: number | null
): Promise<void> {
  const ms =
    explicitMs != null
      ? Math.min(Math.max(explicitMs, RETRY_BASE_MS), RATE_LIMIT_MAX_MS)
      : Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true }
    )
  })
}

// POST to Verboo with a connect (time-to-first-byte) timeout and bounded retry
// on transient PRE-stream failures. Never retries once bytes are flowing — a
// partial stream can't be safely replayed. Honours an external abort signal.
async function openVerbooStream(
  body: string,
  signal?: AbortSignal,
  endpoint?: StreamEndpoint
): Promise<Response> {
  const baseUrl = endpoint?.baseUrl ?? verbooBaseUrl()
  const apiKey = endpoint?.apiKey ?? verbooApiKey()
  let attempt = 0
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const connectController = new AbortController()
    const onAbort = () => connectController.abort()
    signal?.addEventListener("abort", onAbort, { once: true })
    const connectTimer = setTimeout(() => connectController.abort(), CONNECT_TIMEOUT_MS)

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: connectController.signal,
      })

      if (res.ok) return res

      const text = await res.text().catch(() => "unknown error")
      if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
        const retryAfterMs =
          res.status === 429 ? parseRetryAfterMs(res.headers.get("retry-after")) : null
        await backoffDelay(attempt++, signal, retryAfterMs)
        continue
      }
      throw new Error(`AI API error (${res.status}): ${text}`)
    } catch (err) {
      // A caller-driven abort is final — surface it, never retry.
      if (signal?.aborted) throw err
      // A connect-timeout or network error is retryable up to the cap.
      const timedOut = isAbortError(err) // our connect timer fired
      const isApiError = err instanceof Error && err.message.startsWith("AI API error")
      if (isApiError) throw err
      if (attempt < MAX_RETRIES) {
        await backoffDelay(attempt++, signal)
        continue
      }
      throw new Error(
        timedOut
          ? `AI API did not respond within ${CONNECT_TIMEOUT_MS}ms after ${attempt + 1} attempts`
          : `AI API unreachable after ${attempt + 1} attempts: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      clearTimeout(connectTimer)
      signal?.removeEventListener("abort", onAbort)
    }
  }
}

export async function* streamChatCompletion(
  messages: OpenAIMessage[],
  options?: {
    maxTokens?: number
    model?: string
    temperature?: number
    signal?: AbortSignal
    // When set, route through this agent's personal OpenAI-compatible key
    // instead of the shared Verboo router (and skip the shared-key throttle).
    provider?: AiProvider
  }
): AsyncGenerator<string> {
  const provider = options?.provider
  // Model precedence: explicit override → personal provider's model → shared default.
  const model =
    options?.model ??
    (provider
      ? messagesHaveImage(messages)
        ? provider.visionModel
        : provider.textModel
      : selectModel(messages))

  // Request shape differs by provider. The shared Verboo router (DeepSeek/Qwen)
  // takes the classic `max_tokens` + `temperature`. Personal keys target OpenAI,
  // whose gpt-5 / o-series models REJECT both: they require `max_completion_tokens`
  // and only accept the default temperature (sending any temperature → 400). So
  // for a personal provider we use the modern OpenAI contract and omit temperature.
  const maxTokens = options?.maxTokens ?? 4096
  const body = JSON.stringify(
    provider
      ? { model, max_completion_tokens: maxTokens, stream: true, messages }
      : {
          model,
          max_tokens: maxTokens,
          temperature:
            options?.temperature ??
            numberFromEnv("VERBOO_DRAFT_TEMPERATURE", DEFAULT_DRAFT_TEMPERATURE),
          stream: true,
          messages,
        }
  )

  const endpoint: StreamEndpoint | undefined = provider
    ? { baseUrl: provider.baseUrl, apiKey: provider.apiKey }
    : undefined
  // The shared-key throttle protects the shared Verboo quota only. A personal
  // key has its own quota, so it bypasses the limiter entirely.
  const useThrottle = !provider || provider.shared

  // Hold one throttle slot for the whole generation — from the request through
  // the last streamed byte — so concurrency is bounded by real in-flight streams,
  // not just request starts. Released in the finally below on every exit path
  // (done, stall, abort, throw).
  if (useThrottle) await acquireVerbooSlot(options?.signal)
  let slotReleased = false
  const releaseSlot = () => {
    if (useThrottle && !slotReleased) {
      slotReleased = true
      releaseVerbooSlot()
    }
  }

  let res: Response
  try {
    res = await openVerbooStream(body, options?.signal, endpoint)
  } catch (err) {
    releaseSlot()
    throw err
  }

  const reader = res.body?.getReader()
  if (!reader) {
    releaseSlot()
    throw new Error("No response body from AI API")
  }

  const decoder = new TextDecoder()
  let buffer = ""

  try {
    for (;;) {
      // Stall guard: if no chunk arrives within STALL_TIMEOUT_MS (or the caller
      // aborts), stop waiting instead of blocking forever.
      let stallTimer: ReturnType<typeof setTimeout> | undefined
      const guard = new Promise<never>((_, reject) => {
        stallTimer = setTimeout(
          () => reject(new Error(`AI stream stalled — no data for ${STALL_TIMEOUT_MS}ms`)),
          STALL_TIMEOUT_MS
        )
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        )
      })

      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await Promise.race([reader.read(), guard])
      } finally {
        clearTimeout(stallTimer)
      }

      const { done, value } = result
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
  } finally {
    // Release the upstream connection on stall/abort/early-return.
    reader.cancel().catch(() => {})
    releaseSlot()
  }
}
