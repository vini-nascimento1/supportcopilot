import "server-only"

// Automation engine — action dispatch (DRAFT-ONLY).
//
// ⛔ SAFETY BOUNDARY (ADR-0003 / ADR-0007): no handler here may send, reply, close,
// assign, or otherwise act toward a customer in Intercom/email. The only outbound
// is `alert.slack` — a system-generated message to the rule OWNER'S OWN DM, never a
// customer reply. Everything else writes to our own Supabase rows.
//
// Status: in_app / case.flag / case.suggest_playbook implemented (M3).
// alert.slack + draft.prestage are scaffolded no-ops (M6). flow.stop is resolved by
// the planner (planCaseActions) and never reaches here.

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sendSlackMessage } from "@/lib/slack"
import { prestageDraft } from "./prestage"
import type { Action, ActionKind } from "./types"

export type ActionResult = {
  kind: ActionKind
  applied: boolean
  detail: string
}

export type ActionTarget = {
  ruleId: string
  ownerId: string
  caseId?: string | null
  intercomConversationId?: string | null
  /** injected for determinism (sweeps/tests pass their own clock) */
  nowMs: number
  // Conversation context for template placeholders in action text.
  customer?: string | null
  subject?: string | null
  intercomState?: string | null
  adminAssigneeId?: string | null
  ruleName?: string
}

type Handler = (action: Action, target: ActionTarget) => Promise<ActionResult>

const params = (action: Action): Record<string, unknown> => action.params ?? {}
const asString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null)

// ── Template placeholders ──────────────────────────────────────────────────
// Action text may contain {{placeholder}} tokens. resolveTemplate() replaces
// them with values from the target context. Unknown placeholders stay as-is.
type TemplateVars = Record<string, string | null | undefined>

function resolveTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

function buildTemplateVars(target: ActionTarget): TemplateVars {
  return {
    intercom_url:
      target.intercomConversationId && process.env.INTERCOM_APP_ID
        ? `https://app.intercom.com/a/apps/${process.env.INTERCOM_APP_ID}/conversations/${target.intercomConversationId}`
        : null,
    customer: target.customer,
    subject: target.subject,
    status: target.intercomState,
    teammate: target.adminAssigneeId,
    rule_name: target.ruleName,
  }
}

// ── alert.in_app ─────────────────────────────────────────────────────────────
// Insert an alert into the agent's inbox. De-duped by the unique (rule,case,kind)
// constraint so re-running monitors every 5 min doesn't pile up duplicates.
const alertInApp: Handler = async (action, target) => {
  const db = getSupabaseAdminClient()
  if (!db) return { kind: action.kind, applied: false, detail: "no admin client" }
  const raw = asString(params(action).text) ?? "Automation matched this case."
  const body = resolveTemplate(raw, buildTemplateVars(target))
  const { error } = await db
    .from("automation_alerts")
    .upsert(
      { rule_id: target.ruleId, case_id: target.caseId ?? null, kind: "alert.in_app", body },
      { onConflict: "rule_id,case_id,kind", ignoreDuplicates: true }
    )
  return error
    ? { kind: action.kind, applied: false, detail: error.message }
    : { kind: action.kind, applied: true, detail: "alert queued" }
}

// ── case.flag ──────────────────────────────────────────────────────────────
// Annotate OUR cases row (never Intercom). params: { priority_hint?, add_tags?,
// needs_attention_in_mins? }.
const caseFlag: Handler = async (action, target) => {
  const db = getSupabaseAdminClient()
  if (!db) return { kind: action.kind, applied: false, detail: "no admin client" }
  if (!target.caseId) return { kind: action.kind, applied: false, detail: "no case id" }

  const p = params(action)
  const patch: Record<string, unknown> = {}
  const priority = asString(p.priority_hint)
  if (priority && ["urgent", "normal", "low"].includes(priority)) patch.priority_hint = priority

  const addTags = Array.isArray(p.add_tags) ? p.add_tags.map(String) : []
  if (addTags.length) {
    const { data: row } = await db.from("cases").select("auto_tags").eq("id", target.caseId).maybeSingle()
    const existing: string[] = (row?.auto_tags as string[] | null) ?? []
    patch.auto_tags = Array.from(new Set([...existing, ...addTags]))
  }

  const mins = typeof p.needs_attention_in_mins === "number" ? p.needs_attention_in_mins : null
  if (mins !== null) patch.needs_attention_at = new Date(target.nowMs + mins * 60_000).toISOString()

  if (Object.keys(patch).length === 0) {
    return { kind: action.kind, applied: false, detail: "no flag params" }
  }
  const { error } = await db.from("cases").update(patch).eq("id", target.caseId)
  return error
    ? { kind: action.kind, applied: false, detail: error.message }
    : { kind: action.kind, applied: true, detail: `flagged: ${Object.keys(patch).join(", ")}` }
}

// ── case.suggest_playbook ────────────────────────────────────────────────────
// Attach a matched playbook to the case so the tip is ready when the agent opens it.
// params: { playbook_id }.
const caseSuggestPlaybook: Handler = async (action, target) => {
  const db = getSupabaseAdminClient()
  if (!db) return { kind: action.kind, applied: false, detail: "no admin client" }
  if (!target.caseId) return { kind: action.kind, applied: false, detail: "no case id" }
  const playbookId = asString(params(action).playbook_id)
  if (!playbookId) return { kind: action.kind, applied: false, detail: "no playbook_id" }
  const { error } = await db.from("cases").update({ playbook_id: playbookId }).eq("id", target.caseId)
  return error
    ? { kind: action.kind, applied: false, detail: error.message }
    : { kind: action.kind, applied: true, detail: "playbook suggested" }
}

// ── alert.slack ──────────────────────────────────────────────────────────────
// System-generated alert to the rule OWNER'S OWN Slack DM — the single sanctioned
// outbound in this system (ADR-0007 carve-out). Never a customer reply, never a
// public/shared channel. Always system-stamped.
//
// Two delivery modes:
//   1. PREFERRED — a Slack BOT token (SLACK_BOT_TOKEN, `xoxb-`): the message arrives
//      AS THE BOT in the owner's DM, with a real push notification. The owner's
//      Slack user id is resolved by their email via users.lookupByEmail.
//   2. FALLBACK — the owner's personal `xoxp-` token: posts to the owner's own
//      self-DM (no push, "from you"). Used only when no bot token is configured.
// If neither works, degrade to an in-app alert so nothing is lost.
const alertSlack: Handler = async (action, target) => {
  const db = getSupabaseAdminClient()
  if (!db) return { kind: action.kind, applied: false, detail: "no admin client" }

  const { data: agent } = await db
    .from("agents")
    .select("email, slack_token")
    .eq("id", target.ownerId)
    .maybeSingle()
  const userToken = (agent?.slack_token as string | null) ?? null
  const email = (agent?.email as string | null) ?? null
  const botToken = process.env.SLACK_BOT_TOKEN ?? null

  const raw = asString(params(action).text) ?? "a rule matched a case."
  const text = "🤖 Automation: " + resolveTemplate(raw, buildTemplateVars(target))

  // Resolve the owner's Slack user id. Preferred path needs no special bot scope:
  // the owner's own token (auth.test) returns their user id. Optional fallback uses
  // the bot's users.lookupByEmail (only if the bot has users:read.email).
  let userId: string | null = null
  if (userToken) {
    const auth = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    })
      .then((r) => r.json() as Promise<{ ok?: boolean; user_id?: string }>)
      .catch(() => null)
    userId = auth?.ok ? (auth.user_id ?? null) : null
  }
  if (!userId && botToken && email) {
    const lookup = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${botToken}` } }
    )
      .then((r) => r.json() as Promise<{ ok?: boolean; user?: { id?: string } }>)
      .catch(() => null)
    userId = lookup?.ok ? (lookup.user?.id ?? null) : null
  }

  // Couldn't resolve a target → keep the alert in-app so it isn't lost.
  if (!userId) return alertInApp({ kind: "alert.in_app", params: { text } }, target)

  // Send AS THE BOT when a bot token is configured (real DM from the app, with push);
  // otherwise via the owner's own token (self-DM, no push). Never a public channel.
  const sendToken = botToken ?? userToken
  if (!sendToken) return alertInApp({ kind: "alert.in_app", params: { text } }, target)

  const res = await sendSlackMessage(sendToken, userId, text)
  if (!res.ok) return { kind: action.kind, applied: false, detail: res.error ?? "slack send failed" }
  return {
    kind: action.kind,
    applied: true,
    detail: botToken ? "slack bot DM sent" : "slack self-DM sent (no bot token)",
  }
}

// ── draft.prestage ───────────────────────────────────────────────────────────
// Generate + store a reply draft ahead of review. Draft-only; never sends.
const draftPrestage: Handler = async (action, target) => {
  const res = await prestageDraft(target.intercomConversationId ?? null)
  return { kind: action.kind, applied: res.applied, detail: res.detail }
}

export const ACTION_HANDLERS: Record<ActionKind, Handler> = {
  "alert.in_app": alertInApp,
  "case.flag": caseFlag,
  "case.suggest_playbook": caseSuggestPlaybook,
  "alert.slack": alertSlack, // owner DM only — ADR-0007 carve-out
  "draft.prestage": draftPrestage,
  // flow.stop is resolved by planCaseActions and never dispatched; keep a safe no-op.
  "flow.stop": async () => ({ kind: "flow.stop", applied: true, detail: "handled by planner" }),
}

export async function runAction(action: Action, target: ActionTarget): Promise<ActionResult> {
  const handler = ACTION_HANDLERS[action.kind]
  if (!handler) return { kind: action.kind, applied: false, detail: "unknown action kind" }
  return handler(action, target)
}
