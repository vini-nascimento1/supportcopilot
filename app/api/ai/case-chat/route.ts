import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getConversationDetail } from "@/lib/intercom"
import { getTopMatches } from "@/lib/case-intelligence"
import { getPlaybooksDashboardData } from "@/lib/playbooks"

export const dynamic = "force-dynamic"

const VERBOO_API_KEY = process.env.VERBOO_API_KEY
const VERBOO_BASE_URL =
  process.env.VERBOO_BASE_URL ?? "https://code.verboo.ai/router/v1"
const AI_TIMEOUT_MS = 20_000
const MAX_THREAD_CHARS = 6_000

type ChatMessage = { role: "user" | "assistant"; content: string }

// Case copilot — an AI assistant scoped to ONE open ticket. Unlike
// /api/ai/chat (the automation assistant), its entire context is the current
// conversation + the matched playbooks, so "give me a case summary" means
// THIS case, not the queue.
export async function POST(request: Request) {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  if (!VERBOO_API_KEY) {
    return NextResponse.json({ error: "AI is not configured (missing key)" }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  const conversationId: string | undefined = body?.conversationId
  const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : []
  if (!conversationId || messages.length === 0) {
    return NextResponse.json(
      { error: "conversationId and messages are required" },
      { status: 400 },
    )
  }

  const [conversation, playbooksData] = await Promise.all([
    getConversationDetail(conversationId),
    getPlaybooksDashboardData(),
  ])
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
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
        `[${m.role === "customer" ? "CUSTOMER" : "AGENT"}] ${m.author}: ${m.body}`,
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

  const systemPrompt = `You are the Fanvue support copilot embedded in the canvas for ONE open ticket. Fanvue is a British creator-subscription platform. You assist the support agent working THIS case — every question ("summarise the case", "what can it be?", "what should I check?") refers to this ticket unless the agent clearly says otherwise.

## The open case
- Customer: ${conversation.customer}${conversation.email ? ` <${conversation.email}>` : ""}
- State: ${conversation.state} · Topic: ${conversation.topic ?? "—"} · Tags: ${conversation.tags.join(", ") || "—"}
- Subject: ${conversation.subject ?? "—"}

## Conversation thread
${thread || "(empty)"}

## Matched playbooks (source of truth for policy — cite them by name)
${playbookSection}

## How to behave
- Be concise and practical: summaries, likely root causes, the internal checks to run (e.g. fadmin paths from the playbook), and what to reply.
- Never invent policy (KYC rules, payout thresholds, limits). If the playbooks don't cover it, say so explicitly.
- You are draft-only: you never act on external systems — the agent sends every reply themselves.
- Use UK English. Plain text or light markdown (bold, short bullets); no headers.
- When asked for a customer-facing reply, follow Fanvue's tone: warm, first-person, "Hey! 👋 thanks for reaching out…", bold key steps, one clear call-to-action.`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
    const res = await fetch(`${VERBOO_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VERBOO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(-12),
        ],
        stream: false,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      return NextResponse.json(
        { error: `AI provider error (${res.status})` },
        { status: 502 },
      )
    }
    const data = await res.json()
    const message = data?.choices?.[0]?.message?.content
    if (!message) {
      return NextResponse.json({ error: "Empty AI response" }, { status: 502 })
    }
    return NextResponse.json({ message })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json(
        { error: "The AI took too long — try again" },
        { status: 504 },
      )
    }
    return NextResponse.json({ error: "AI request failed" }, { status: 500 })
  }
}
