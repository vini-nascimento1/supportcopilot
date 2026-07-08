import "server-only"

// Automation engine — draft.prestage.
// Generates a customer-facing reply DRAFT ahead of time and stores it (drafts table)
// so the agent opens the case to a ready-to-review reply. DRAFT-ONLY: this only
// writes to our DB — it never sends anything. Reuses the same model router as
// /api/draft, non-streaming. Incurs one LLM call per match (opt-in per rule, no cap).

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getConversationDetail, type ConversationDetail } from "@/lib/intercom"
import { getPlaybooksDashboardData } from "@/lib/playbooks"
import { withVerbooSlot } from "@/lib/verboo-throttle"

const VERBOO_API_KEY = process.env.VERBOO_API_KEY
const VERBOO_BASE_URL = process.env.VERBOO_BASE_URL ?? "https://code.verboo.ai/router/v1"

const TONE = `You are a support copilot for a senior Fanvue support agent. Write a warm, first-person customer reply, ready to copy-paste.
Rules: open with "Hey! 👋 Thanks for reaching out to Fanvue Support…" (do NOT use the customer's real name, and never guess or invent one); light emoji (1-2 max); **bold** key steps; short bullet lists (max 4); exactly one call-to-action; no sign-off and NO signature of any kind (never write your own name, initials, or a "- <name>" closing); never promise timelines/refunds/exceptions not in the playbook. **Write in English only — always:** no matter what language the customer wrote in (Portuguese, Spanish, French, anything), your reply MUST be in English; never mirror the customer's language. Output ONLY the message text — no preamble, no headers.`

function buildUserMessage(c: ConversationDetail, playbook?: { caseType: string; resolution?: string | null }): string {
  // Withhold the customer's real name/email from the model (privacy). The thread
  // body still gives the model everything it needs to answer.
  const parts = [
    `Customer identity: withheld for privacy — never address the customer by name.`,
    `\nOriginal message:\n${c.firstMessage}`,
  ]
  const followUps = c.messages.filter((m) => m.role === "customer" && m.body.trim()).slice(0, 3)
  if (followUps.length) {
    parts.push(`\nFollow-up messages:`)
    followUps.forEach((m) => parts.push(`- ${m.body}`))
  }
  if (playbook) {
    parts.push(`\nPlaybook: ${playbook.caseType}`)
    if (playbook.resolution) parts.push(`Resolution guidance:\n${playbook.resolution}`)
  }
  parts.push(`\nDraft a reply following the playbook and tone rules.`)
  parts.push(`\n⚠️ Write the entire reply in English, regardless of the language the customer used above. Never reply in the customer's language.`)
  return parts.join("\n")
}

async function generate(system: string, user: string): Promise<string> {
  // Shares the process-wide Verboo throttle with the gate + reply-queue pipeline
  // so automation prestage can't contribute to a 429 stampede.
  return withVerbooSlot(async () => {
    const res = await fetch(`${VERBOO_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VERBOO_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        max_tokens: 1024,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    })
    if (!res.ok) throw new Error(`AI API error (${res.status})`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content?.trim() ?? ""
  })
}

export type PrestageResult = { applied: boolean; detail: string }

/**
 * Persist a reply body as the next draft version for a conversation. DRAFT-ONLY:
 * writes to the drafts table, never sends. Ensures a case row exists first (fetching
 * the customer name from Intercom only when the row is missing). Shared by the AI
 * pre-stage path and the fixed-macro path so both version + attach identically.
 */
async function persistDraft(conversationId: string, replyBody: string): Promise<PrestageResult> {
  const db = getSupabaseAdminClient()
  if (!db) return { applied: false, detail: "no admin client" }

  const { data: caseRow } = await db
    .from("cases")
    .select("id")
    .eq("intercom_conversation_id", conversationId)
    .maybeSingle()

  let caseId = caseRow?.id as string | undefined
  if (!caseId) {
    // Only reach out to Intercom for the customer name when we must create the row.
    const conversation = await getConversationDetail(conversationId)
    const { data: created } = await db
      .from("cases")
      .upsert(
        { intercom_conversation_id: conversationId, customer_name: conversation?.customer ?? null },
        { onConflict: "intercom_conversation_id" }
      )
      .select("id")
      .single()
    caseId = created?.id as string | undefined
  }
  if (!caseId) return { applied: false, detail: "could not resolve case" }

  const { data: latest } = await db
    .from("drafts")
    .select("version")
    .eq("case_id", caseId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await db.from("drafts").insert({
    case_id: caseId,
    version: ((latest?.version as number | undefined) ?? 0) + 1,
    reply_body: replyBody,
  })
  return error ? { applied: false, detail: error.message } : { applied: true, detail: "draft staged" }
}

/**
 * Generate + persist a draft for a conversation. Skips quietly (applied:false) if
 * the model isn't configured or the conversation can't be fetched — never throws
 * to the action runner.
 */
export async function prestageDraft(conversationId: string | null): Promise<PrestageResult> {
  if (!VERBOO_API_KEY) return { applied: false, detail: "VERBOO_API_KEY not set" }
  if (!conversationId) return { applied: false, detail: "no conversation id" }
  const db = getSupabaseAdminClient()
  if (!db) return { applied: false, detail: "no admin client" }

  // Find the local case (for playbook context).
  const { data: caseRow } = await db
    .from("cases")
    .select("id, playbook_id, customer_name")
    .eq("intercom_conversation_id", conversationId)
    .maybeSingle()

  const [conversation, playbooks] = await Promise.all([
    getConversationDetail(conversationId),
    getPlaybooksDashboardData(),
  ])
  if (!conversation) return { applied: false, detail: "conversation not found" }

  const playbook = caseRow?.playbook_id
    ? playbooks.allRows.find((p) => p.id === caseRow.playbook_id)
    : undefined

  let reply: string
  try {
    reply = await generate(TONE, buildUserMessage(conversation, playbook))
  } catch (e) {
    return { applied: false, detail: (e as Error).message }
  }
  if (!reply) return { applied: false, detail: "empty draft" }

  const res = await persistDraft(conversationId, reply)
  return res.applied ? { applied: true, detail: "draft pre-staged" } : res
}

/**
 * Stage a fixed macro reply as a draft — NO LLM call, the exact text is what the
 * agent will review and send. DRAFT-ONLY: never messages the customer. Used by the
 * `draft.macro` action so a rule can queue e.g. a "Quick Acknowledgement" macro.
 * The text is stored verbatim (no {{placeholder}} resolution) so no internal field
 * can leak into a customer-facing draft.
 */
export async function stageMacroDraft(
  conversationId: string | null,
  text: string | null
): Promise<PrestageResult> {
  if (!conversationId) return { applied: false, detail: "no conversation id" }
  const body = (text ?? "").trim()
  if (!body) return { applied: false, detail: "no macro text" }
  const res = await persistDraft(conversationId, body)
  return res.applied ? { applied: true, detail: "macro draft staged" } : res
}
