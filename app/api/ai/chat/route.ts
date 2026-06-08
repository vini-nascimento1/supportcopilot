import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getAgentContext, createRule, updateRule, deleteRule, listRules, testRule } from "@/lib/automation/rules"
import { searchOpenConversationsForAdmin } from "@/lib/intercom"
import type { ConditionTree } from "@/lib/automation/types"

export const dynamic = "force-dynamic"

const VERBOO_API_KEY = process.env.VERBOO_API_KEY
const VERBOO_BASE_URL = process.env.VERBOO_BASE_URL ?? "https://code.verboo.ai/router/v1"

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
            description: 'Array of actions: [{ kind: "alert.in_app"|"alert.slack"|"case.flag"|"case.suggest_playbook"|"flow.stop", params?: {} }]',
            items: { type: "object" },
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
]

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a support automation assistant inside the Fanvue Support Copilot. Users ask you in natural language to create, edit, or explain automation rules. You use the available tools to do so. Keep responses concise and friendly — think Slack-style, not formal docs.

Available condition fields:
- status (enum: open, snoozed, closed) — conversation state in Intercom
- subject (text) — conversation subject/snippet
- tags (tags) — Intercom-side tags on the conversation
- auto_tags (tags) — tags set by rule actions themselves
- teammate (text) — Intercom admin_assignee_id; omit for global rules
- is_creator (boolean) — whether customer is a creator
- is_ai_creator (boolean) — whether customer is an AI creator
- priority_hint (enum: urgent, normal, low) — internal priority set by rules
- priority (enum: priority, not_priority) — Intercom's own priority flag
- matched_playbook (text) — playbook case_type matched to this case
- time_since_update (number, seconds) — seconds since last Intercom update
- time_since_created (number, seconds) — seconds since conversation opened
- first_response_minutes (number, minutes) — minutes elapsed since conversation opened; use with sla parameter

Operators by field type:
- text: is, is_not, contains, not_contains, matches_regex
- enum: is, is_not, in
- number/duration: eq, neq, gt, gte, lt, lte
- tags: contains, not_contains, in, is_empty, not_empty
- boolean: is_true, is_false
- event: is

Available actions:
- alert.in_app — in-app notification with customizable text
- alert.slack — Slack DM to you with customizable text
- case.flag — set priority_hint (urgent/normal/low)
- case.suggest_playbook — suggest a playbook for the case
- flow.stop — stop further rule evaluation

SLA rules: use first_response_minutes with a "sla" parameter.
Example: { field: "first_response_minutes", op: "lte", value: 300, sla: 30 }
This means "alert when ≤ 5 minutes remaining on a 30-minute SLA".
IMPORTANT: cond.value is in SECONDS (5 min = 300), cond.sla is in MINUTES (30).

Global rules: rules WITHOUT a teammate condition apply to ALL agents' queues.
Rules WITH "teammate is <intercom_admin_id>" are scoped to that specific agent.

When users ask you to create a rule, always explain what you're about to do, then ask confirmation before creating it. After creating or updating, summarise what was done.`

// ── Tool handlers ──────────────────────────────────────────────────────────

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  agentId: string,
  db: NonNullable<ReturnType<typeof getSupabaseAdminClient>>
): Promise<{ result: unknown; error?: string }> {
  try {
    switch (name) {
      case "list_rules": {
        const rules = await listRules(agentId, db)
        return { result: rules.map((r) => ({ id: r.id, name: r.name, kind: r.kind, enabled: r.enabled, priority: r.priority, conditions: r.conditions, actions: r.actions })) }
      }

      case "get_rule": {
        const rules = await listRules(agentId, db)
        const rule = rules.find((r) => r.id === args.id)
        if (!rule) return { result: null, error: "Rule not found" }
        return { result: rule }
      }

      case "create_rule": {
        const rule = await createRule(agentId, db, args as Parameters<typeof createRule>[2])
        return { result: rule }
      }

      case "update_rule": {
        const { id, patch } = args as { id: string; patch: Record<string, unknown> }
        const rule = await updateRule(agentId, db, id, patch)
        return { result: rule }
      }

      case "delete_rule": {
        const { id } = args as { id: string }
        await deleteRule(agentId, db, id)
        return { result: { deleted: true } }
      }

      case "test_rule": {
        const { conditions } = args as { conditions: ConditionTree }
        const result = await testRule(agentId, db, { conditions, actions: [] }, Date.now())
        return { result }
      }

      case "get_insights": {
        const rules = await listRules(agentId, db)
        const monitorCount = rules.filter((r) => r.kind === "monitor" && r.enabled).length
        const triggerCount = rules.filter((r) => r.kind === "trigger" && r.enabled).length

        // Try to fetch open conversation counts for this agent.
        const { data: agent } = await db
          .from("agents")
          .select("intercom_admin_id")
          .eq("id", agentId)
          .maybeSingle()
        let openConvs = 0
        if (agent?.intercom_admin_id) {
          try {
            const convs = await searchOpenConversationsForAdmin(String(agent.intercom_admin_id))
            openConvs = convs.length
          } catch { /* skip */ }
        }

        return {
          result: {
            totalRules: rules.length,
            enabledMonitors: monitorCount,
            enabledTriggers: triggerCount,
            openConversations: openConvs,
          },
        }
      }

      default:
        return { result: null, error: `Unknown tool: ${name}` }
    }
  } catch (e) {
    return { result: null, error: (e as Error).message }
  }
}

// ── Route ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    messages: Array<{ role: string; content: string }>
  } | null
  if (!body?.messages) return NextResponse.json({ error: "messages required" }, { status: 400 })

  if (!VERBOO_API_KEY) return NextResponse.json({ error: "VERBOO_API_KEY not configured" }, { status: 500 })

  try {
    // Call Verboo Router with function calling.
    const routerMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...body.messages.map((m) => ({ role: m.role, content: m.content })),
    ]

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
        messages: routerMessages,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown")
      return NextResponse.json({ error: `AI provider: ${res.status} ${errText}` }, { status: 502 })
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
    if (!choice) return NextResponse.json({ error: "No AI response" }, { status: 502 })

    // Process tool calls if the model requested any.
    if (choice.tool_calls && choice.tool_calls.length > 0) {
      // Execute each tool call.
      const toolResults = await Promise.all(
        choice.tool_calls.map(async (tc) => {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.function.arguments) } catch { /* empty */ }
          const { result, error } = await handleToolCall(tc.function.name, args, agentId, db)
          return {
            role: "tool",
            tool_call_id: tc.id,
            content: error ? JSON.stringify({ error }) : JSON.stringify(result),
          }
        })
      )

      // Send tool results back to the model for the final answer.
      const followUpRes = await fetch(`${VERBOO_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VERBOO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          max_tokens: 4096,
          stream: false,
          messages: [
            ...routerMessages,
            { role: "assistant", content: choice.content ?? null, tool_calls: choice.tool_calls },
            ...toolResults,
          ],
        }),
      })

      if (!followUpRes.ok) {
        const errText = await followUpRes.text().catch(() => "unknown")
        return NextResponse.json({ error: `AI follow-up: ${followUpRes.status} ${errText}` }, { status: 502 })
      }

      const followUpData = (await followUpRes.json()) as {
        choices: Array<{ message: { content?: string | null } }>
      }
      const reply = followUpData.choices?.[0]?.message?.content ?? "Done."
      return NextResponse.json({ message: reply })
    }

    // No tool calls — direct reply.
    const reply = choice.content ?? "I'm not sure how to respond."
    return NextResponse.json({ message: reply })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
