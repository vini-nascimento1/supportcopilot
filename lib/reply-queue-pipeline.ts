import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getConversationDetail, searchArticles } from "@/lib/intercom"
import { getPlaybooksDashboardData, getResponsesForPlaybookIds } from "@/lib/playbooks"
import type { PlaybookListItem } from "@/lib/playbooks"
import { classifyPlaybookMatch, GATE_CONFIDENCE_THRESHOLD } from "@/lib/playbook-gate"
import { getTopMatches } from "@/lib/case-intelligence"
import { retrieveNotionSnippets } from "@/lib/notion-retrieval-server"
import type { NotionSnippet } from "@/lib/notion-retrieval"
import {
  buildSystemPrompt,
  buildNotionAwareSystemPrompt,
  buildUserMessage,
  streamChatCompletion,
  type OpenAIMessage,
} from "@/lib/draft-ai"
import {
  classifyWebhookTopic,
  hasCapabilityGap,
  deriveRiskBand,
  type RiskBand,
} from "@/lib/reply-queue"
import {
  upsertPendingSuggestion,
  resolveSuggestionOnReply,
  type SuggestionSource,
} from "@/lib/reply-queue-store"

// The always-on reply-queue pipeline — runs off the Intercom webhook (in the
// background via `after()`). Composes the existing brain: gate -> Notion
// ai_search -> deepseek generation -> persist a suggestion. ASSIGNED-ONLY: it
// only drafts for conversations owned by one of our agents (the unassigned
// workspace firehose is skipped — see the gate in computeAndPersistSuggestion).
// DRAFT-ONLY: it ONLY writes a suggested_replies row. It never sends, never
// assigns, never writes to Intercom. See
// FanvueSupport/Engineering/Plan - Autonomous non-read reply queue.md.

type WebhookItem = {
  id?: string | number
}
type WebhookPayload = {
  topic?: string
  data?: { item?: WebhookItem }
}

type Owner = { id: string | null; email: string | null }

// Map the Intercom admin assignee to one of our agents (id + email). The email
// is what drives the per-user Notion token (D10); a null owner = unassigned pool.
async function resolveOwner(adminAssigneeId: string | null): Promise<Owner> {
  if (!adminAssigneeId) return { id: null, email: null }
  const db = getSupabaseAdminClient()
  if (!db) return { id: null, email: null }
  const { data } = await db
    .from("agents")
    .select("id, email")
    .eq("intercom_admin_id", adminAssigneeId)
    .maybeSingle()
  return { id: (data?.id as string | undefined) ?? null, email: (data?.email as string | undefined) ?? null }
}

async function getAgentFirstName(email: string | null): Promise<string> {
  if (!email) return "the support team"
  const db = getSupabaseAdminClient()
  if (!db) return "the support team"
  const { data } = await db.from("agents").select("name").eq("email", email).maybeSingle()
  return (data?.name as string | undefined)?.split(" ")[0] ?? "the support team"
}

// Deterministic card tooltip: why this suggestion, what grounded it, what to
// watch for. No extra LLM call — built from the routing metadata + sources.
function buildJustification(args: {
  band: RiskBand
  capabilityGap: boolean
  matchedName: string | null
  gateConfidence: number | null
  snippets: NotionSnippet[]
}): string {
  const lines: string[] = []
  if (args.capabilityGap) {
    lines.push(
      "⚠️ Sensitive category (payout/KYC/media/ban) — verify in fadmin before sending; send is locked."
    )
  }
  if (args.matchedName) {
    const conf = args.gateConfidence != null ? ` (confidence ${args.gateConfidence.toFixed(2)})` : ""
    lines.push(`Matched playbook: ${args.matchedName}${conf}.`)
  } else {
    lines.push("No confident playbook match — drafted from live knowledge.")
  }
  const citable = args.snippets.filter((s) => !s.isInternalSource)
  if (citable.length > 0) {
    lines.push(`Grounded in ${citable.length} Notion source(s): ${citable.map((s) => s.title).join("; ")}.`)
  } else if (args.snippets.length > 0) {
    lines.push(
      `${args.snippets.length} internal source(s) informed the reasoning (not quoted to the customer).`
    )
  }
  if (args.band === "low_confidence") {
    lines.push("Low confidence — review carefully before sending.")
  }
  return lines.join(" ")
}

export type PipelineOutcome = {
  handled: boolean
  action: "suggested" | "resolved" | "ignored" | "skipped"
  reason?: string
  suggestionId?: string
  band?: RiskBand
}

// Compute and persist the live suggestion for a single conversation (the
// customer-branch brain): resolve the owner from the conversation's current
// assignee -> fetch conversation + playbooks -> gate -> Notion ai_search
// (assigned only) -> deepseek generation -> upsert the suggestion row.
//
// Shared by BOTH the webhook pipeline (`runReplyQueuePipeline`, customer branch)
// and the assign endpoint (`/api/reply-queue/assign`). On the assign path the
// conversation now has an admin_assignee_id, so `resolveOwner` finds the owner
// email and the Notion deep search runs with the assignee's token (D10).
//
// DRAFT-ONLY: only writes a suggested_replies row — never sends, never assigns.
export async function computeAndPersistSuggestion(
  conversationId: string,
  origin: string
): Promise<PipelineOutcome> {
  const [conversation, playbooksData] = await Promise.all([
    getConversationDetail(conversationId),
    getPlaybooksDashboardData(),
  ])
  if (!conversation) return { handled: false, action: "skipped", reason: "no conversation detail" }

  // Resolve the owner from the conversation's CURRENT assignee. On the webhook
  // path this matches the incoming event; on the assign path it reflects the
  // assignment we just wrote, so the per-user Notion token kicks in.
  const owner = await resolveOwner(conversation.adminAssigneeId)

  // ASSIGNED-ONLY GATE. Only draft for conversations owned by one of our agents.
  // Previously every inbound customer message across the whole Intercom
  // workspace produced an unassigned suggestion (owner_id = null) — a firehose
  // that buried each agent's own work and burned an LLM generation per message.
  // The queue is now a per-agent worklist (getPendingQueue is owner-scoped), so
  // an ownerless suggestion would never be seen by anyone. Bail before the gate
  // /Notion/generation work. The assign endpoint reaches here with the assignee
  // already written, so its recompute still resolves an owner and proceeds.
  if (!owner.id) {
    return { handled: true, action: "skipped", reason: "unassigned (assigned-only gate)" }
  }

  const capabilityGap = hasCapabilityGap(conversation.tags)

  const ticketText = [
    conversation.subject,
    conversation.firstMessage,
    ...conversation.messages.filter((m) => m.role === "customer").map((m) => m.body),
  ]
    .filter(Boolean)
    .join(" ")

  // Gate — reuse the canvas-bootstrap routing (Verboo error → keyword fallback).
  const gate = await classifyPlaybookMatch(ticketText, playbooksData.allRows)
  const matched: PlaybookListItem | null =
    gate.reason === "error"
      ? getTopMatches(ticketText, playbooksData.allRows, 1)[0]?.playbook ?? null
      : gate.playbookId && gate.confidence >= GATE_CONFIDENCE_THRESHOLD
        ? playbooksData.allRows.find((p) => p.id === gate.playbookId) ?? null
        : null
  const gateMatched = Boolean(matched)

  // Notion deep search ONLY for an assigned conversation (per-user token, D10).
  // Unassigned → cheap precompute (gate + band); the deep search fires later on
  // [Assign to me].
  let snippets: NotionSnippet[] = []
  if (owner.email) {
    snippets = await retrieveNotionSnippets(owner.email, origin, ticketText)
  }
  const notionHadHits = snippets.length > 0

  const band = deriveRiskBand({ capabilityGap, gateMatched, notionHadHits })

  // Generate the reply (reuse the draft brain). Even a capability-gap card gets a
  // drafted safe part — only the SEND is locked, not the drafting.
  const responseTemplates = matched
    ? (await getResponsesForPlaybookIds([matched.id])).get(matched.id) ?? []
    : []
  const [agentName, articles] = await Promise.all([
    getAgentFirstName(owner.email),
    searchArticles(ticketText),
  ])
  const systemPrompt = notionHadHits
    ? buildNotionAwareSystemPrompt(matched ?? undefined, responseTemplates, agentName, articles, snippets)
    : buildSystemPrompt(matched ?? undefined, responseTemplates, agentName, articles)
  const messages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildUserMessage(conversation) },
  ]

  let body = ""
  try {
    for await (const chunk of streamChatCompletion(messages)) body += chunk
  } catch {
    return { handled: false, action: "skipped", reason: "generation failed" }
  }
  if (!body.trim()) return { handled: false, action: "skipped", reason: "empty generation" }

  const sources: SuggestionSource[] = snippets
    .filter((s) => !s.isInternalSource)
    .map((s) => ({ title: s.title, url: s.url, kind: s.source }))

  const res = await upsertPendingSuggestion({
    intercomConversationId: conversationId,
    ownerId: owner.id,
    customerName: conversation.customer ?? null,
    subject: conversation.subject ?? null,
    body: body.trim(),
    justification: buildJustification({
      band,
      capabilityGap,
      matchedName: matched?.caseType ?? null,
      gateConfidence: gate.reason === "error" ? null : gate.confidence,
      snippets,
    }),
    sources,
    confidence: gate.reason === "error" ? null : gate.confidence,
    gateReason: gate.reason,
    riskBand: band,
  })

  return { handled: true, action: "suggested", suggestionId: res?.id, band }
}

export async function runReplyQueuePipeline(
  payload: WebhookPayload,
  origin: string
): Promise<PipelineOutcome> {
  const topic = payload.topic ?? null
  const item = payload.data?.item
  const conversationId = item?.id != null ? String(item.id) : null
  if (!conversationId) return { handled: false, action: "skipped", reason: "no conversation id" }

  const kind = classifyWebhookTopic(topic)

  // An agent answered → the conversation leaves the non-read queue.
  if (kind === "agent_reply") {
    await resolveSuggestionOnReply(conversationId, "stale")
    return { handled: true, action: "resolved" }
  }
  // Only a customer message drives a (re)compute.
  if (kind !== "customer") return { handled: true, action: "ignored", reason: topic ?? "" }

  // Delegate to the shared compute helper (also used by the assign endpoint).
  return computeAndPersistSuggestion(conversationId, origin)
}
