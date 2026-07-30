import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getAgentContext, createRule, updateRule, deleteRule, listRules, testRule } from "@/lib/automation/rules"
import { searchOpenConversations, searchOpenConversationsForAdmin, getConversationDetail, searchArticles } from "@/lib/intercom"
import { getPlaybooksDashboardData, getResponsesForPlaybookIds } from "@/lib/playbooks"
import { getFreshNotionMcpToken } from "@/lib/notion-mcp-auth-server"
import { searchNotionViaMcp } from "@/lib/notion-mcp-client"
import { classifyNotionSnippetUse, type NotionSnippet } from "@/lib/notion-retrieval"
import { getAgentNameAndAdminId } from "@/lib/auth"
import { resolveProviderForAgentEmail } from "@/lib/ai-provider"
import { resolveToneForAgentEmail } from "@/lib/agent-tone"
import {
  buildSystemPrompt,
  buildNotionAwareSystemPrompt,
  buildUserMessage,
  hasAgentPersonallyReplied,
  streamChatCompletion,
  buildVerifierGroundingContext,
  buildDraftVerifierMessages,
  REPLY_STYLE_NUDGE,
  type OpenAIMessage,
} from "@/lib/draft-ai"
import type { ConditionTree } from "@/lib/automation/types"

export const dynamic = "force-dynamic"
// research_ticket can chain an Intercom fetch + a Notion MCP search + a
// multi-round tool-calling reply inside one request — well past the ~15s a
// quick automation reply needs. Vercel hard-caps this per plan regardless of
// the number here (Hobby ~60s, Pro up to 300s by default); raise the plan's
// function timeout too if research requests still get cut off in prod.
export const maxDuration = 90

// ── Error handling contract ──────────────────────────────────────────────────
//
// Every path in this route must return one of:
//   1. { message: string }      — success (200), the AI's reply
//   2. { error: string }        — client error (4xx), the user sees a toast
//   3. { message: string }      — partial success (200), tools ran but summary failed
//
// Tool errors → { error: "friendly message" } in the tool response content,
// which the model reads natively as a failure and explains to the user.
//
// Provider timeouts → 504 "The AI took too long…"
// Unknown errors    → 500 "report this to Vinicius"
// Network/config    → 500 with specific detail (missing API key, auth, etc.)
// Intercom failures → included as _warnings in the tool data, not silently dropped
//───────────────────────────────────────────────────────────────────────────────

const VERBOO_API_KEY = process.env.VERBOO_API_KEY
const VERBOO_BASE_URL = process.env.VERBOO_BASE_URL ?? "https://code.verboo.ai/router/v1"
// Research (research_ticket + a couple of follow-up lookups + synthesis) needs
// more rounds and more per-call thinking time than a quick "create this rule"
// exchange — both were previously tuned only for the latter.
const MAX_TOOL_ROUNDS = 6
const AI_TIMEOUT_MS = 45_000

// ── Tool definitions ───────────────────────────────────────────────────────

type ToolDef = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_rules",
      description: "List all automation rules for the current agent",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rule",
      description: "Get details of a specific automation rule by ID",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Rule UUID" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_rule",
      description: "Create a new automation rule (monitor or trigger)",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Human-readable rule name" },
          kind: { type: "string", enum: ["monitor", "trigger"] },
          enabled: { type: "boolean", description: "Whether the rule is active" },
          conditions: {
            type: "object",
            description: 'ConditionTree: { match: "all"|"any", groups: [{ match: "all"|"any", conditions: [{ field, op, value?, sla? }] }] }',
          },
          actions: {
            type: "array",
            description: 'Array of actions. alert.in_app: { kind, params: { text } }. alert.slack: { kind, params: { text } }. case.flag: { kind, params: { priority_hint?, add_tags?, needs_attention_in_mins? } }. case.suggest_playbook: { kind, params: { playbook_id } }. flow.stop: { kind }. Supports placeholders in text: {{customer}} {{intercom_url}} {{subject}} {{status}} {{teammate}} {{rule_name}}.',
            items: { type: "object" },
          },
          onEvents: {
            type: "array",
            description: 'Required for triggers. Events that fire this rule: ["conversation.created"] for new conversations, or ["conversation.created", "conversation.updated"] for updates too. Omit or null for monitors.',
            items: { type: "string" },
          },
        },
        required: ["name", "kind", "conditions", "actions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_rule",
      description: "Update an existing automation rule (name, enabled, conditions, actions, priority, etc.)",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Rule UUID" },
          patch: {
            type: "object",
            description: "Partial rule fields to update",
          },
        },
        required: ["id", "patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_rule",
      description: "Delete an automation rule by ID",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Rule UUID" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "test_rule",
      description: "Dry-run test a condition tree against live Intercom conversations. Returns match count and details.",
      parameters: {
        type: "object",
        properties: {
          conditions: {
            type: "object",
            description: 'ConditionTree to test',
          },
        },
        required: ["conditions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_insights",
      description: "Get quick stats about the agent's current open conversations and rules",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_playbooks",
      description: "Search support playbooks by keyword (matches case type, aliases, and recognition text). Use this to find a playbook's real ID before referencing one in case.suggest_playbook, or to answer 'what playbook covers X?'",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: 'Keyword or phrase, e.g. "payout on hold" or "KYC stuck"' },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_cases",
      description: "Search open Intercom conversations by keyword (matches subject/tags) and/or SLA status. Use for questions like 'how many open payout cases am I missing SLA on?' or 'show me my urgent tickets'. Searches OPEN conversations only.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional keyword to match against the conversation subject or tags" },
          slaStatus: { type: "string", enum: ["active", "hit", "missed", "cancelled", "none"], description: "Optional exact SLA status filter" },
          scope: {
            type: "string",
            enum: ["mine", "workspace"],
            description: '"mine" (default) searches only the agent\'s own assigned open conversations. "workspace" searches every open conversation — slower, only use when the user explicitly asks about the whole team/queue.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description: "Search the agent's connected knowledge base (Notion pages, plus Slack/Linear/Google Drive via the Notion connector) directly — no ticket needed. Use this for a standalone question like \"what does the W-8BEN article say about submission errors?\" or \"what's our policy on X?\". Only reach for research_ticket instead when there's an actual Intercom ticket to read alongside the knowledge search.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The question or keywords to search for." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_ticket",
      description: "Deep research on ONE specific Intercom ticket: fetches its full conversation thread, then searches the agent's connected knowledge (Notion pages, plus Slack/Linear/Google Drive via the Notion connector) for anything relevant to the question. This is deliberately slower and more thorough than the other tools — use it when the agent pastes an Intercom conversation ID/URL, or explicitly asks you to look into, research, or dig into a specific ticket. Requires Notion connected in Settings for the knowledge search to return anything; the ticket thread itself works regardless.",
      parameters: {
        type: "object",
        properties: {
          conversationId: {
            type: "string",
            description: "The Intercom conversation ID. If the agent pasted a full Intercom URL (e.g. https://app.intercom.com/.../conversation/12345), extract the numeric/alphanumeric ID from it.",
          },
          question: {
            type: "string",
            description: "What the agent actually wants to know or resolve about this ticket — used as the knowledge-base search query alongside the ticket's own content.",
          },
        },
        required: ["conversationId", "question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_reply",
      description: "Generate an actual customer-facing reply draft for one Intercom ticket, using the same grounded-generation and grounding-verifier pipeline the rest of the app uses (customer-safe knowledge only — internal Slack/Linear/Drive context, if any, is firewalled out of the customer text). Returns a draft to show the agent — it is NEVER sent automatically, no confirmation needed since nothing goes out. Call search_playbooks first and pass its id as playbookId if a playbook clearly applies; omit it otherwise.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string", description: "The Intercom conversation ID to draft a reply for." },
          playbookId: { type: "string", description: "A playbook id from search_playbooks, if one clearly applies to this ticket. Omit if none does — never invent one." },
          guidance: { type: "string", description: "Optional extra instruction specific to this draft, e.g. \"mention we'll follow up within 48h\" or \"keep it to two sentences\"." },
        },
        required: ["conversationId"],
      },
    },
  },
]

// Write tools mutate real automation rules — the client must get explicit
// user confirmation before these actually run (see processToolCalls below).
// Every other tool is read-only and executes immediately.
const WRITE_TOOLS = new Set(["create_rule", "update_rule", "delete_rule"])

function summarizeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "create_rule":
      return `Create a new ${(args.kind as string) ?? ""} rule "${(args.name as string) ?? "Untitled"}"`
    case "update_rule":
      return `Update rule ${(args.id as string) ?? "?"}${
        args.patch && typeof args.patch === "object" && (args.patch as Record<string, unknown>).name
          ? ` → "${(args.patch as Record<string, unknown>).name}"`
          : ""
      }`
    case "delete_rule":
      return `Delete rule ${(args.id as string) ?? "?"}`
    default:
      return `Run ${name}`
  }
}

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the support assistant inside the Fanvue Support Copilot. You can look up playbooks and open cases, and you can create, edit, test, and explain automation rules — all in natural language. You use the available tools to do so. Keep responses concise and friendly — think Slack-style, not formal docs.

## Looking things up (read-only, no confirmation needed)

- **search_playbooks(query)** — find a playbook by keyword. ALWAYS call this before using the case.suggest_playbook action so you have a real playbook id — never invent or guess one.
- **search_cases(query?, slaStatus?, scope?)** — search open conversations for questions like "how many open payout cases am I missing SLA on?" or "show me my urgent tickets". Defaults to the agent's own queue (scope: "mine"); only use scope: "workspace" if the user explicitly asks about the whole team.
- **search_knowledge(query)** — a standalone question against the connected knowledge base (Notion/Slack/Linear/Drive), no ticket involved. Use this whenever the agent just wants to know something ("what does the W-8BEN article say about X?", "what's our refund policy?") — don't make them invent a ticket ID just to ask a question.
- **research_ticket(conversationId, question)** — the deep-dive tool for when there IS an actual ticket: reads its full thread AND searches the knowledge base together. Use it when the agent pastes an Intercom conversation ID/URL, or explicitly asks you to look into a specific ticket — not for a standalone knowledge question (use search_knowledge for that instead) and not for quick automation questions. This is allowed to take longer than the other tools: read the full thread it returns, actually use the knowledge results (cite each one by title and source, e.g. "per the Notion page 'Payout SLAs'" or "a Slack thread from #payments mentions..."), and say plainly when nothing relevant turned up rather than filling the gap with a guess.
- **draft_reply(conversationId, playbookId?, guidance?)** — once you (or the agent) know enough about a ticket to actually respond to the customer, offer to draft the reply and call this on request (or proactively ask "want me to draft a reply?" after researching a ticket — don't assume yes). It runs the same grounded generation + grounding-verifier pipeline the rest of the app uses, so the result is already customer-safe (internal sources are firewalled out during generation, not by you). Call search_playbooks first and pass its id as playbookId ONLY if one clearly applies; never invent an id. When the tool returns, present the draft field back to the agent VERBATIM in a quoted block — do not paraphrase, shorten, or "clean up" wording the verifier already checked — and always say plainly that it's a draft they still need to review and send themselves. Never claim or imply that it was sent.

## Creating, editing, or deleting a rule requires user confirmation

create_rule, update_rule, and delete_rule do NOT execute immediately — the user sees a Yes/No confirmation card with exactly what you're about to do before it runs. You'll get the result (confirmed or declined) as the tool's response. This means you don't need to over-hedge in your own text before calling them — the app itself gates the actual write — but you should still gather the right details first (see below) so the confirmation card is accurate and the user isn't confirming something half-specified.

## TRIGGER vs MONITOR — choose the right kind

- **trigger** — EVENT-BASED. Fires IMMEDIATELY when a webhook arrives (conversation.created, conversation.updated). Use when the user says "whenever X happens", "as soon as", "when a conversation starts/is created/gets a reply". Best for instant actions.
- **monitor** — SWEEP-BASED. Periodically (every N minutes) scans ALL open conversations and evaluates conditions. Use for time-based checks, SLA countdowns, periodic flagging, catching things that change over time.

Examples:
- "send me a Slack when a conversation is started by a creator" → TRIGGER (event: conversation.created)
- "alert me if a conversation has been open for 2+ hours" → MONITOR (sweep checks time_since_created)
- "flag urgent when a high-priority ticket comes in" → TRIGGER (event-based)

When creating a trigger, set onEvents: ["conversation.created"] or ["conversation.created", "conversation.updated"] depending on what the user wants. For triggers, sweep_every_mins is null. For monitors, sweep_every_mins defaults to 5.

## Ask clarifying questions FIRST

Before calling create_rule or update_rule, ask the user clarifying questions to nail down exactly what they want. Examples:

1. "Is this a trigger (fires immediately) or a monitor (periodic check)?"
2. "Which specific creator? We can filter by is_creator = true, or do you have specific criteria?"
3. "What should the Slack message say? You can use placeholders like {{customer}}, {{subject}}, {{intercom_url}}."
4. "Any other conditions? (tags, subject text, priority, etc.)"
5. "Should it run on new conversations only, or also on updates?"

Only proceed to create/update after the user has confirmed. Summarise what was configured.

## Placeholders for action messages

When creating alert.slack or alert.in_app actions, you can include placeholders in params.text that get replaced at runtime:

- {{customer}} — customer name
- {{intercom_url}} — link to the Intercom conversation
- {{subject}} — conversation subject
- {{status}} — conversation status (open/snoozed/closed)
- {{teammate}} — assigned teammate ID
- {{rule_name}} — name of this rule

Example: { kind: "alert.slack", params: { text: "🚨 {{customer}} needs help with {{subject}} — {{intercom_url}}" } }

## Available condition fields

- status (enum: open, snoozed, closed) — conversation state in Intercom
- subject (text) — conversation subject/snippet
- tags (tags) — Intercom-side tags on the conversation
- auto_tags (tags) — tags set by rule actions themselves
- teammate (text) — Intercom admin_assignee_id; omit for global rules, use "is_empty" for unassigned conversations
- is_creator (boolean) — whether the conversation has the CREATOR_TAG (derived from Intercom tags)
- priority_hint (enum: urgent, normal, low) — internal priority set by rules
- priority (enum: priority, not_priority) — Intercom's own priority flag
- matched_playbook (text) — playbook case_type matched to this case
- time_since_update (number, seconds) — seconds since last Intercom update
- time_since_created (number, seconds) — seconds since conversation opened
- sla_status (enum: active, hit, missed, cancelled, none) — Intercom's native SLA state for this conversation
- time_waiting_seconds (number, seconds) — seconds since the SLA clock started waiting; null when sla_status != "active"

## Operators by field type

- text: is, is_not, contains, not_contains, matches_regex
- enum: is, is_not, in
- number/duration: eq, neq, gt, gte, lt, lte
- tags: contains, not_contains, in, is_empty, not_empty
- boolean: is_true, is_false
- event: is

## Available actions

- alert.in_app — in-app notification. params: { text: "message with {{placeholders}}" }
- alert.slack — Slack DM to you. params: { text: "message with {{placeholders}}" }
- case.flag — set priority_hint (urgent/normal/low), add_tags, needs_attention_in_mins
- case.suggest_playbook — params: { playbook_id: "uuid" }
- draft.prestage — pre-stage an AI-written reply draft for review. No params. Never sends.
- draft.macro — pre-stage a fixed macro reply as a draft for review. params: { text: "exact macro text" }. Stored verbatim (no placeholders), never sends.
- flow.stop — stop further rule evaluation

## SLA rules

Use Intercom's native SLA state. The clock is "active" while someone is waiting,
flips to "hit" the moment the admin replies, and to "missed" on breach.

Example — alert when SLA is active AND we've been waiting ≥ 15 minutes:
  conditions: [
    { field: "sla_status", op: "is", value: "active" },
    { field: "time_waiting_seconds", op: "gte", value: 900 },
  ]

**Important:** time_waiting_seconds is in SECONDS (15 min = 900). Don't pair
this with a "sla" parameter — that legacy approach was removed because it
fired alerts after the admin had already replied.

## Global rules

Rules WITHOUT a teammate condition apply to ALL agents' queues.
Rules WITH "teammate is <intercom_admin_id>" are scoped to that specific agent.

Ask clarifying questions first so the conditions/actions you propose are fully specified — the user still confirms the actual write via the Yes/No card, but a vague or half-guessed rule makes that confirmation meaningless. After a create/update/delete tool result comes back, tell the user plainly whether they confirmed or declined it, and summarise what happened.`

// ── Tool result type ────────────────────────────────────────────────────────

type ToolResult = { success: true; data: unknown } | { success: false; friendly: string; debug: string }

function toolSuccess(data: unknown): ToolResult {
  return { success: true, data }
}

function toolError(friendly: string, debug: string): ToolResult {
  return { success: false, friendly, debug }
}

// ── Input validation ────────────────────────────────────────────────────────

function validateRuleInput(args: Record<string, unknown>): string | null {
  const kind = args.kind as string | undefined
  if (kind && !["monitor", "trigger"].includes(kind)) {
    return `The rule kind must be "monitor" or "trigger", not "${kind}".`
  }
  if (args.conditions) {
    const cond = args.conditions as Record<string, unknown>
    if (!cond.match || !Array.isArray(cond.groups)) {
      return "The conditions field should have a 'match' (all/any) and a 'groups' array. Please check the format."
    }
  }
  // sweepEveryMins and onEvents have sensible defaults in toRow() —
  // no need to require them explicitly from the AI.
  return null
}

// ── Tool handlers ──────────────────────────────────────────────────────────

// research_ticket/draft_reply need to know WHY a Notion search came back
// empty — "nothing connected", "needs re-consent", and "the MCP call itself
// failed" are three very different situations, but the shared
// lib/notion-retrieval-server.ts::retrieveNotionSnippets() used by the draft
// pipeline collapses all of them (by design, for that pipeline — a customer
// reply must never break just because Notion is unreachable) into the same
// empty array. That's exactly the ambiguity that made "the AI says it can't
// reach Notion" impossible to diagnose from the chat's own output — this
// calls the lower-level pieces directly to surface the real error instead.
async function searchKnowledgeWithDiagnostics(
  email: string,
  origin: string,
  query: string,
  limit: number
): Promise<{ snippets: NotionSnippet[]; warning: string | null }> {
  try {
    const tokenResult = await getFreshNotionMcpToken(email, origin)
    if (!tokenResult.accessToken) {
      if (tokenResult.needsReconsent) {
        return {
          snippets: [],
          warning: "Notion's connection has expired and needs to be reconnected — Settings → Integrations → Notion → Reconnect.",
        }
      }
      return {
        snippets: [],
        warning: `Notion isn't connected for this agent${"error" in tokenResult && tokenResult.error ? ` (${tokenResult.error})` : ""} — connect it in Settings → Integrations.`,
      }
    }
    const result = await searchNotionViaMcp(tokenResult.accessToken, query, limit)
    if (result.backend !== "ai_search") {
      return {
        snippets: [],
        warning: `Notion is connected, but the search call itself failed: ${result.error ?? "unknown error"}. This is a real error, not "nothing found" — worth reporting to Vinicius if it keeps happening.`,
      }
    }
    return {
      snippets: result.snippets,
      warning: result.snippets.length === 0 ? "The knowledge search ran successfully and found nothing relevant." : null,
    }
  } catch (e) {
    return { snippets: [], warning: `Notion search threw an error: ${(e as Error).message}` }
  }
}

// Shared per-request context threaded through handleToolCall/processToolCalls/
// continueConversation — bundled once here rather than growing an ever-longer
// positional parameter list as tools need more than just (agentId, db).
type AgentCtx = {
  agentId: string
  db: NonNullable<ReturnType<typeof getSupabaseAdminClient>>
  email: string
  origin: string
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentCtx
): Promise<ToolResult> {
  const { agentId, db, email, origin } = ctx
  try {
    switch (name) {
      case "list_rules": {
        const rules = await listRules(agentId, db)
        return toolSuccess(rules.map((r) => ({ id: r.id, name: r.name, kind: r.kind, enabled: r.enabled, priority: r.priority, conditions: r.conditions, actions: r.actions })))
      }

      case "get_rule": {
        const rules = await listRules(agentId, db)
        const rule = rules.find((r) => r.id === args.id)
        if (!rule) return toolError("I couldn't find a rule with that ID. Check the ID and try again.", "Rule not found")
        return toolSuccess(rule)
      }

      case "create_rule": {
        const validationMsg = validateRuleInput(args)
        if (validationMsg) return toolError(validationMsg, `Validation failed: ${validationMsg}`)
        const rule = await createRule(agentId, db, args as Parameters<typeof createRule>[2])
        return toolSuccess(rule)
      }

      case "update_rule": {
        const { id, patch } = args as { id: string; patch: Record<string, unknown> }
        const validationMsg = validateRuleInput(patch)
        if (validationMsg) return toolError(validationMsg, `Validation failed: ${validationMsg}`)
        const rule = await updateRule(agentId, db, id, patch)
        return toolSuccess(rule)
      }

      case "delete_rule": {
        const { id } = args as { id: string }
        await deleteRule(agentId, db, id)
        return toolSuccess({ deleted: true })
      }

      case "test_rule": {
        const { conditions } = args as { conditions: ConditionTree }
        if (!conditions || !conditions.match || !conditions.groups) {
          return toolError(
            "The conditions format seems wrong — it needs a 'match' field (all/any) and a 'groups' array. Please check and try again.",
            "Invalid conditions structure"
          )
        }
        const result = await testRule(agentId, db, { conditions, actions: [] }, Date.now())
        return toolSuccess(result)
      }

      case "get_insights": {
        const rules = await listRules(agentId, db)
        const monitorCount = rules.filter((r) => r.kind === "monitor" && r.enabled).length
        const triggerCount = rules.filter((r) => r.kind === "trigger" && r.enabled).length

        const { data: agent } = await db
          .from("agents")
          .select("intercom_admin_id")
          .eq("id", agentId)
          .maybeSingle()
        let openConvs: number | null = null
        let intercomError: string | null = null
        if (agent?.intercom_admin_id) {
          try {
            const convs = await searchOpenConversationsForAdmin(String(agent.intercom_admin_id))
            openConvs = convs.length
          } catch (e) {
            intercomError = "Could not reach Intercom to count open conversations."
          }
        }

        return toolSuccess({
          totalRules: rules.length,
          enabledMonitors: monitorCount,
          enabledTriggers: triggerCount,
          openConversations: openConvs,
          ...(intercomError ? { _warnings: [intercomError] } : {}),
        })
      }

      case "search_playbooks": {
        const { query } = args as { query: string }
        const q = (query ?? "").trim().toLowerCase()
        if (!q) return toolError("Give me a keyword to search playbooks with.", "Empty query")
        const { allRows } = await getPlaybooksDashboardData()
        const matches = allRows
          .filter(
            (p) =>
              p.caseType.toLowerCase().includes(q) ||
              p.aliases.some((a) => a.toLowerCase().includes(q)) ||
              (p.recognize?.toLowerCase().includes(q) ?? false)
          )
          .slice(0, 10)
        if (matches.length === 0) {
          return toolSuccess({ matches: [], note: "No playbook matched that keyword — try a different word, or tell the user none exists rather than guessing an ID." })
        }
        return toolSuccess({
          matches: matches.map((p) => ({
            id: p.id,
            caseType: p.caseType,
            source: p.source,
            aliases: p.aliases,
            recognize: p.recognize,
          })),
        })
      }

      case "search_cases": {
        const { query, slaStatus, scope } = args as {
          query?: string
          slaStatus?: string
          scope?: "mine" | "workspace"
        }
        let adminId: string | undefined
        if (scope !== "workspace") {
          const { data: agent } = await db
            .from("agents")
            .select("intercom_admin_id")
            .eq("id", agentId)
            .maybeSingle()
          adminId = agent?.intercom_admin_id ? String(agent.intercom_admin_id) : undefined
          if (!adminId) {
            return toolError(
              "This agent doesn't have an Intercom admin ID on file, so I can't search their personal queue. Try again with scope: workspace.",
              "No intercom_admin_id for agent"
            )
          }
        }
        const { conversations, complete } = await searchOpenConversations(
          scope === "workspace" ? {} : { adminId }
        )
        const q = query?.trim().toLowerCase()
        const filtered = conversations.filter((c) => {
          if (slaStatus && c.slaStatus !== slaStatus) return false
          if (q) {
            const haystack = `${c.subject ?? ""} ${c.tags.join(" ")}`.toLowerCase()
            if (!haystack.includes(q)) return false
          }
          return true
        })
        return toolSuccess({
          matchCount: filtered.length,
          totalOpenSearched: conversations.length,
          resultsTruncated: !complete,
          cases: filtered.slice(0, 15).map((c) => ({
            id: c.id,
            customer: c.customerName,
            subject: c.subject,
            tags: c.tags,
            slaStatus: c.slaStatus,
            priority: c.priority,
          })),
        })
      }

      case "search_knowledge": {
        const { query } = args as { query?: string }
        if (!query?.trim()) {
          return toolError("Give me a question or keywords to search the knowledge base with.", "Empty query")
        }
        const { snippets, warning } = await searchKnowledgeWithDiagnostics(email, origin, query, 12)
        return toolSuccess({
          results: snippets.map((s) => ({
            title: s.title,
            source: s.source,
            url: s.url,
            excerpt: s.text,
          })),
          ...(warning ? { _warnings: [warning] } : {}),
        })
      }

      case "research_ticket": {
        const { conversationId, question } = args as { conversationId?: string; question?: string }
        const id = conversationId?.trim()
        if (!id) {
          return toolError(
            "I need an Intercom conversation ID to research a ticket — paste the conversation ID or its Intercom URL.",
            "Missing conversationId"
          )
        }
        if (!question?.trim()) {
          return toolError("Tell me what you actually want to know about this ticket.", "Missing question")
        }

        const convo = await getConversationDetail(id)
        if (!convo) {
          return toolError(
            `I couldn't find an Intercom conversation with ID "${id}". Double-check the ID, or paste the full Intercom conversation URL.`,
            "Conversation not found"
          )
        }

        // Cap how much thread text feeds the knowledge-base search query —
        // this is a search query, not the model's actual reading of the
        // thread (the full thread goes back in ticketSummary below).
        const threadForSearch = [convo.subject, convo.firstMessage, ...convo.messages.map((m) => m.body)]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 4000)

        const { snippets: knowledge, warning: notionWarning } = await searchKnowledgeWithDiagnostics(
          email,
          origin,
          `${question}\n\n${threadForSearch}`,
          12
        )

        return toolSuccess({
          ticket: {
            id: convo.id,
            subject: convo.subject,
            customer: convo.customer,
            email: convo.email,
            state: convo.state,
            tags: convo.tags,
            intercomUrl: convo.intercomUrl,
            messages: convo.messages.map((m) => ({ role: m.role, author: m.author, body: m.body, createdAt: m.createdAt })),
          },
          knowledgeResults: knowledge.map((s) => ({
            title: s.title,
            source: s.source,
            url: s.url,
            excerpt: s.text,
          })),
          ...(notionWarning ? { _warnings: [notionWarning] } : {}),
        })
      }

      case "draft_reply": {
        const { conversationId, playbookId, guidance } = args as {
          conversationId?: string
          playbookId?: string
          guidance?: string
        }
        const id = conversationId?.trim()
        if (!id) {
          return toolError("I need an Intercom conversation ID to draft a reply.", "Missing conversationId")
        }

        const convo = await getConversationDetail(id)
        if (!convo) {
          return toolError(
            `I couldn't find an Intercom conversation with ID "${id}". Double-check the ID or paste the full Intercom conversation URL.`,
            "Conversation not found"
          )
        }

        const [playbooksData, agentInfo, provider, toneResolution] = await Promise.all([
          getPlaybooksDashboardData(),
          getAgentNameAndAdminId(email),
          resolveProviderForAgentEmail(email),
          resolveToneForAgentEmail(email),
        ])
        const { name: agentName, intercomAdminId } = agentInfo
        const playbook = playbookId ? playbooksData.allRows.find((p) => p.id === playbookId) : undefined
        const responseTemplates = playbookId
          ? (await getResponsesForPlaybookIds([playbookId])).get(playbookId) ?? []
          : []

        const searchQuery = [convo.subject, convo.firstMessage].filter(Boolean).join(" ")
        const [articles, { snippets, warning: notionWarning }] = await Promise.all([
          searchArticles(searchQuery),
          searchKnowledgeWithDiagnostics(email, origin, searchQuery, 10),
        ])

        const hasAgentReplied = hasAgentPersonallyReplied(convo.messages, intercomAdminId)
        const hasKnownEmail = Boolean(convo.email)

        let systemPrompt =
          snippets.length > 0
            ? buildNotionAwareSystemPrompt(playbook, responseTemplates, agentName, articles, snippets, hasAgentReplied, false, toneResolution.instruction)
            : buildSystemPrompt(playbook, responseTemplates, agentName, articles, hasAgentReplied, false, toneResolution.instruction)
        if (guidance?.trim()) {
          systemPrompt += `\n\n## Extra instruction for this specific draft\n${guidance.trim()}`
        }
        systemPrompt += `\n\n${REPLY_STYLE_NUDGE}`

        const userMessage = buildUserMessage(convo, undefined, null, hasAgentReplied, hasKnownEmail)
        const draftMessages: OpenAIMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ]

        let draft = ""
        try {
          for await (const chunk of streamChatCompletion(draftMessages, { provider: provider ?? undefined })) {
            draft += chunk
          }
        } catch (e) {
          return toolError("Draft generation failed — try again in a moment.", (e as Error).message)
        }
        if (!draft.trim()) {
          return toolError("The model returned an empty draft — try again, maybe with more guidance.", "Empty generation")
        }

        // Same grounding-verifier pass the autonomous reply-queue pipeline runs
        // before a draft is ever shown for send — strips claims the source
        // material doesn't actually support (e.g. "I've checked your account").
        try {
          const verifierSourceMessages: OpenAIMessage[] = [
            { role: "system", content: buildVerifierGroundingContext(playbook, articles, snippets) },
            { role: "user", content: userMessage },
          ]
          let verified = ""
          for await (const chunk of streamChatCompletion(buildDraftVerifierMessages(verifierSourceMessages, draft), {
            maxTokens: 4096,
            temperature: 0,
            model: provider?.auxModel,
            provider: provider ?? undefined,
          })) {
            verified += chunk
          }
          if (verified.trim()) draft = verified.trim()
        } catch {
          // Verifier is best-effort — keep the unverified draft rather than failing the tool.
        }

        return toolSuccess({
          conversationId: convo.id,
          draft,
          groundedOnPlaybook: playbook?.caseType ?? null,
          customerSafeSourcesUsed: snippets.filter((s) => classifyNotionSnippetUse(s) === "customerSafe").length,
          note: "This is a DRAFT ONLY — it has not been sent. Present it to the agent verbatim (don't paraphrase it), clearly marked as a draft to review before they send it themselves.",
          ...(notionWarning ? { _warnings: [notionWarning] } : {}),
        })
      }

      default:
        return toolError(
          `I tried to use an unknown tool "${name}". Please try again or report this to Vinicius if it persists.`,
          `Unknown tool: ${name}`
        )
    }
  } catch (e) {
    const msg = (e as Error).message
    return toolError(
      `Something went wrong while running "${name}". Please try again or report this to Vinicius if it persists.`,
      msg
    )
  }
}

// ── Verboo Router helper ────────────────────────────────────────────────────

async function callVerboo(
  messages: Array<Record<string, unknown>>,
  options?: { tool_choice?: "auto" | "none" }
): Promise<{
  content: string | null
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

  try {
    const res = await fetch(`${VERBOO_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VERBOO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        max_tokens: 4096,
        stream: false,
        messages,
        tools: TOOLS,
        tool_choice: options?.tool_choice ?? "auto",
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown")
      throw new Error(`AI provider error (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content?: string | null
          tool_calls?: Array<{
            id: string
            type: "function"
            function: { name: string; arguments: string }
          }>
        }
      }>
    }

    const choice = data.choices?.[0]?.message
    if (!choice) throw new Error("No AI response (empty choices)")

    return {
      content: choice.content ?? null,
      tool_calls: choice.tool_calls,
    }
  } finally {
    clearTimeout(timeout)
  }
}

// ── Resumable tool-call processing (write tools pause for confirmation) ────

type RawToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }

// Serialized across the pause/resume round-trip — the client holds this
// opaquely and sends it back verbatim on confirm/decline. Nothing here is
// secret (it's the same messages the client already saw plus in-flight tool
// scaffolding), so it's fine to round-trip through the client rather than
// keeping server-side session state.
type PendingState = {
  messages: Array<Record<string, unknown>>
  toolCalls: RawToolCall[]
  resolved: Array<Record<string, unknown>>
  index: number
  assistantContent: string | null
  round: number
  // Every tool name actually executed so far this turn (across rounds and
  // across a confirm/decline pause) — surfaced to the client at the end so
  // the agent can see what the assistant actually looked at, not just its
  // final prose. Not deduped here; the client/response layer dedupes for display.
  toolsUsed: string[]
}

type ProcessOutcome =
  | { done: true; messages: Array<Record<string, unknown>>; round: number; toolsUsed: string[] }
  | {
      done: false
      confirmation: { toolCallId: string; name: string; args: Record<string, unknown>; summary: string }
      pendingState: PendingState
    }

// Walks `state.toolCalls` from `state.index`, executing read-only tools
// immediately and stopping (without executing) the moment it reaches one in
// WRITE_TOOLS — the caller returns that as a confirmation request. Passing
// `decision` resumes from a paused write tool: applies the user's yes/no,
// then keeps walking (which may pause again on a second write tool later in
// the same round).
async function processToolCalls(
  state: PendingState,
  ctx: AgentCtx,
  decision?: { toolCallId: string; confirmed: boolean }
): Promise<ProcessOutcome> {
  const { toolCalls, resolved } = state
  let index = state.index
  const toolsUsed = [...state.toolsUsed]

  if (decision) {
    const tc = toolCalls[index]
    if (!tc || tc.id !== decision.toolCallId) {
      throw new Error("Stale or out-of-order confirmation — please retry your message.")
    }
    if (decision.confirmed) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments)
      } catch {
        resolved.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: "The AI generated an invalid response. Please try again." }),
        })
        index++
        return processToolCalls({ ...state, index, toolsUsed }, ctx)
      }
      const result = await handleToolCall(tc.function.name, args, ctx)
      toolsUsed.push(tc.function.name)
      resolved.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result.success ? result.data : { error: result.friendly }),
      })
    } else {
      resolved.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify({
          error: "The user declined this action in the confirmation card. Do not retry it — ask what they'd like to do instead.",
        }),
      })
    }
    index++
  }

  while (index < toolCalls.length) {
    const tc = toolCalls[index]
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.function.arguments)
    } catch {
      resolved.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify({ error: "The AI generated an invalid response. Please try again." }),
      })
      index++
      continue
    }

    if (WRITE_TOOLS.has(tc.function.name)) {
      return {
        done: false,
        confirmation: {
          toolCallId: tc.id,
          name: tc.function.name,
          args,
          summary: summarizeToolCall(tc.function.name, args),
        },
        pendingState: { ...state, index, toolsUsed },
      }
    }

    const result = await handleToolCall(tc.function.name, args, ctx)
    toolsUsed.push(tc.function.name)
    resolved.push({
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify(result.success ? result.data : { error: result.friendly }),
    })
    index++
  }

  return {
    done: true,
    round: state.round,
    toolsUsed,
    messages: [
      ...state.messages,
      { role: "assistant", content: state.assistantContent, tool_calls: state.toolCalls },
      ...resolved,
    ],
  }
}

// Drives the actual Verboo round-trip loop once `messages` has no pending
// confirmation in flight — either a fresh user turn, or resumed right after
// a confirm/decline resolved the previous round's tool calls.
function dedupeToolsUsed(names: string[]): string[] {
  return Array.from(new Set(names))
}

async function continueConversation(
  messages: Array<Record<string, unknown>>,
  startRound: number,
  ctx: AgentCtx,
  initialToolsUsed: string[] = []
): Promise<Response> {
  let rounds = startRound
  let toolsUsed = initialToolsUsed

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++
    const response = await callVerboo(messages)

    if (!response.tool_calls || response.tool_calls.length === 0) {
      return NextResponse.json({
        message: response.content ?? "I'm not sure how to respond.",
        toolsUsed: dedupeToolsUsed(toolsUsed),
      })
    }

    const outcome = await processToolCalls(
      {
        messages,
        toolCalls: response.tool_calls,
        resolved: [],
        index: 0,
        assistantContent: response.content ?? null,
        round: rounds,
        toolsUsed,
      },
      ctx
    )

    if (!outcome.done) {
      return NextResponse.json({
        confirmation: outcome.confirmation,
        pendingState: outcome.pendingState,
      })
    }

    messages = outcome.messages
    toolsUsed = outcome.toolsUsed
  }

  // Max tool rounds reached — ask for a final summary without tool access.
  try {
    const finalResponse = await callVerboo(messages, { tool_choice: "none" })
    return NextResponse.json({
      message: finalResponse.content ?? "I completed the actions but couldn't generate a summary.",
      toolsUsed: dedupeToolsUsed(toolsUsed),
    })
  } catch {
    return NextResponse.json({
      message: `I ran out of steps for this turn. The AI couldn't summarise the results — try asking "what did you just do?" to get a recap.`,
      toolsUsed: dedupeToolsUsed(toolsUsed),
    })
  }
}

// ── Route ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { db, agentId, email } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    messages?: Array<{ role: string; content: string }>
    pendingState?: PendingState
    toolCallId?: string
    confirmed?: boolean
  } | null
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })

  if (!VERBOO_API_KEY) return NextResponse.json({ error: "VERBOO_API_KEY not configured" }, { status: 500 })

  const { origin } = new URL(req.url)
  const ctx: AgentCtx = { db, agentId, email: email ?? "", origin }

  try {
    // Resuming after the user clicked Yes/No on a write-tool confirmation card.
    if (body.pendingState && body.toolCallId && typeof body.confirmed === "boolean") {
      const outcome = await processToolCalls(body.pendingState, ctx, {
        toolCallId: body.toolCallId,
        confirmed: body.confirmed,
      })
      if (!outcome.done) {
        return NextResponse.json({ confirmation: outcome.confirmation, pendingState: outcome.pendingState })
      }
      return await continueConversation(outcome.messages, outcome.round, ctx, outcome.toolsUsed)
    }

    // Fresh user turn.
    if (!body.messages) return NextResponse.json({ error: "messages required" }, { status: 400 })
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: SYSTEM_PROMPT },
      ...body.messages.map((m) => ({ role: m.role, content: m.content })),
    ]
    return await continueConversation(messages, 0, ctx)
  } catch (e) {
    const err = e as Error & { name: string }
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return NextResponse.json({
        error: "The AI took too long to respond. Try a simpler request or try again.",
      }, { status: 504 })
    }
    return NextResponse.json({
      error: err.message?.startsWith("Stale or out-of-order")
        ? err.message
        : "Something went wrong with the AI assistant. Please try again or report this to Vinicius if it persists.",
    }, { status: 500 })
  }
}
