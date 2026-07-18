import "server-only"

// Triage sweep — classifies the open-but-unworked pool (unassigned, or held
// by a non-human admin like Fin) into `triage_items`. Deliberately LLM-free:
// classification reuses the same keyword playbook matcher the live dashboard
// tip uses (getTopMatches from lib/case-intelligence), never the Verboo
// gate/generation calls, so a cron running every few minutes can't burn LLM
// budget. Read Intercom, write only our own Supabase tables — this sweep
// never writes to Intercom, sends, or assigns anything (ADR-0003/0007/0011).
// nowMs is injected (not read from the clock) so the sweep stays deterministic.

import { searchOpenConversationsForAdmin, type SweepConversation } from "@/lib/intercom"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getPlaybooksDashboardData } from "@/lib/playbooks"
import { getTopMatches } from "@/lib/case-intelligence"
import { hasCapabilityGap } from "@/lib/reply-queue"
import { replaceTriagePool, type TriageItemRow } from "./store"

export type TriageSweepSummary = {
  pooled: number
  matched: number
  swept: number
  error: string | null
}

// triage_items.snippet cap — plenty for keyword matching / a UI preview, and
// bounds row size against an unusually long first message.
const SNIPPET_MAX_LENGTH = 2000

// Sweep-local HTML strip for the raw `source.body` field (lib/intercom.ts
// strips subject the same way, but keeps that helper private to the module —
// this is a small enough regex that duplicating it beats exporting a helper
// for one caller).
function stripHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function toWaitingSinceIso(waitingSinceSec: number | null): string | null {
  return waitingSinceSec != null ? new Date(waitingSinceSec * 1000).toISOString() : null
}

// Intercom marks an unassigned conversation with a null admin_assignee_id;
// some payloads use 0/"0" for the same "nobody" sentinel. Treat all three as
// unassigned.
function isUnassigned(conv: SweepConversation): boolean {
  return conv.adminAssigneeId == null || conv.adminAssigneeId === "0"
}

export async function runTriageSweep(nowMs: number): Promise<TriageSweepSummary> {
  const sweepStartedIso = new Date(nowMs).toISOString()
  const empty: TriageSweepSummary = { pooled: 0, matched: 0, swept: 0, error: null }

  const db = getSupabaseAdminClient()
  if (!db) return { ...empty, error: "no admin client" }

  // (a) Global open queue — no admin id means "every open conversation",
  // mirroring how runMonitorSweep fetches the full queue once rather than
  // per-agent.
  let allOpen: SweepConversation[]
  try {
    allOpen = await searchOpenConversationsForAdmin()
  } catch (e) {
    return { ...empty, error: `intercom search: ${(e as Error).message}` }
  }

  // (b) Pool = strictly UNASSIGNED open conversations (no admin assignee).
  // A conversation already assigned to any teammate — whether or not they use
  // this copilot — is that person's to work, so it stays out of the pool. This
  // is the Intercom "Unassigned" inbox, not "everything no copilot-agent owns".
  const pool = allOpen.filter(isUnassigned)

  // (c) Keyword-only playbook match — zero LLM calls. getPlaybooksDashboardData
  // loaded once and reused across every pooled conversation.
  const playbooks = await getPlaybooksDashboardData()

  let matched = 0
  const rows: TriageItemRow[] = pool.map((conv) => {
    const bodyText = stripHtml(conv.body)
    const ticketText = `${conv.subject ?? ""} ${bodyText}`.trim()
    const [topMatch] = getTopMatches(ticketText, playbooks.allRows, 1)
    if (topMatch) matched += 1

    return {
      intercom_conversation_id: conv.id,
      subject: conv.subject,
      customer_name: conv.customerName,
      snippet: bodyText.slice(0, SNIPPET_MAX_LENGTH),
      tags: conv.tags,
      priority: conv.priority === "priority",
      sla_status: conv.slaStatus,
      waiting_since: toWaitingSinceIso(conv.waitingSinceSec),
      conversation_created_at: conv.createdAt,
      admin_assignee_id: conv.adminAssigneeId,
      matched_playbook_id: topMatch?.playbook.id ?? null,
      matched_playbook_name: topMatch?.playbook.caseType ?? null,
      match_score: topMatch?.score ?? null,
      capability_gap: hasCapabilityGap(conv.tags),
      swept_at: sweepStartedIso,
    }
  })

  // (e) Full-replace pool refresh — see replaceTriagePool for why the delete
  // is conditioned on the upsert succeeding.
  const result = await replaceTriagePool(rows, sweepStartedIso)
  if (!result.ok) return { pooled: pool.length, matched, swept: 0, error: result.error }

  return { pooled: pool.length, matched, swept: rows.length, error: null }
}
