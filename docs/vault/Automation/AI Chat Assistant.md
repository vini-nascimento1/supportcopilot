---
title: AI Chat Assistant
tags: [ai, automation, chat]
updated: 2026-07-29
---

# AI Chat Assistant

A floating chat panel (bottom-right FAB, [[Canvas Workflow]]-adjacent but global to the whole app)
that lets an agent manage automation rules, look up playbooks, and check their open cases in
natural language — backed by tool-calling against a small, explicit set of server-side functions.

It is deliberately narrow, not a general Q&A bot: everything it can do is one of the tools listed
below. If a request falls outside them, the model will say so rather than improvise — see
[[System Prompt Architecture]] for the equivalent design philosophy applied to the draft pipeline.

## Key files

- `components/ai-chat.tsx` — the floating panel, message list, and the Yes/No confirmation card
- `app/api/ai/chat/route.ts` — system prompt, tool definitions, tool handlers, the pause/resume loop

## Transparency: what did it actually check?

Every tool name actually executed this turn is tracked in `PendingState.toolsUsed` — accumulated
across rounds and across a confirm/decline pause (see below), deduped, and returned alongside the
final `message` as `toolsUsed: string[]`. The client renders it as a small "🔎 Checked: …" line under
the reply (`TOOL_LABELS` in `ai-chat.tsx` maps tool names to human-readable labels). This is an
end-of-response summary, not live progress — true "Searching Notion now…" step-by-step status would
need the route to stream (like `/api/draft` already does), which wasn't done here to keep the
confirmation-pause protocol (a plain JSON request/response) simple; worth reconsidering if research
requests are common enough that the silent wait matters more than it does today.

## Tools

Read-only (execute immediately, no confirmation):

- `list_rules`, `get_rule`, `test_rule`, `get_insights` — inspect [[Automation Rules Engine]] rules
  and dry-run a condition tree against live Intercom conversations
- `search_playbooks(query)` — keyword search over playbooks (case type, aliases, recognition text);
  the model is instructed to always call this before referencing a playbook in a
  `case.suggest_playbook` action, so it has a real ID instead of guessing one
- `search_cases(query?, slaStatus?, scope?)` — keyword/SLA-status search over open Intercom
  conversations, defaulting to the agent's own queue (`scope: "mine"`); `scope: "workspace"` searches
  every open conversation instead, only used when the user asks about the whole team
- `research_ticket(conversationId, question)` — the deep-dive tool: fetches one Intercom
  conversation's full thread (`lib/intercom.ts::getConversationDetail`) and searches the agent's
  connected knowledge via `lib/notion-retrieval-server.ts::retrieveNotionSnippets` — Notion pages
  plus Slack/Linear/Google Drive through the same hosted-MCP connector search the draft pipeline
  uses (see [[Notion MCP Integration]]). Unlike the draft pipeline, results here are **not** filtered
  to `customerSafe` sources — this tool is agent-facing, so Slack/Linear/Drive hits are exactly what
  it's for, not something to hide. Requires the agent to have Notion connected (Settings →
  Integrations); the ticket-thread half works regardless.
- `draft_reply(conversationId, playbookId?, guidance?)` — generates an actual customer-facing reply,
  reusing [[Draft Verify Pipeline]]'s own building blocks rather than a new ad-hoc prompt:
  `buildNotionAwareSystemPrompt`/`buildSystemPrompt` + `buildUserMessage` for generation, then the
  same grounding-verifier pass (`buildVerifierGroundingContext` + `buildDraftVerifierMessages`) the
  autonomous reply-queue pipeline runs before a draft is ever shown for send. Because it goes through
  those exact prompt builders, internal-only Notion/Slack/Linear/Drive sources are firewalled out of
  the generated text automatically — this tool doesn't need to (and doesn't) re-filter anything
  itself. Still 100% read-only from the app's perspective: it returns a draft string, nothing is
  ever sent to Intercom from here. The system prompt tells the model to relay the draft back
  verbatim (not paraphrase it) and always call it out as unsent.

Write tools (see below — these pause for explicit confirmation, they never execute silently):

- `create_rule`, `update_rule`, `delete_rule`

## Confirm-before-write

`create_rule`, `update_rule`, and `delete_rule` mutate real automation rules, so the API never runs
them on the model's say-so alone. Instead of the old "loop until no more tool calls, then return"
design, the round-processing loop (`processToolCalls` in `route.ts`) walks each round's tool calls
in order, executes read-only ones immediately, and **stops** the moment it reaches a write tool —
returning `{ confirmation: { toolCallId, name, args, summary }, pendingState }` to the client instead
of a normal `{ message }`.

`pendingState` is an opaque snapshot (the in-flight messages array, the full tool-call list, what's
already been resolved, and which index execution paused at) — the client holds it and posts it back
verbatim along with the user's yes/no. The server resumes exactly where it left off, which also
means a second write tool later in the same round pauses again rather than being silently skipped.

```
Model calls [get_insights, create_rule]
  → get_insights executes immediately
  → create_rule is a write tool → STOP, return confirmation + pendingState
Client renders "Confirm this action: Create a new monitor rule "SLA breach alert"" with Yes/No
  → Yes:  POST { pendingState, toolCallId, confirmed: true }  → rule is actually created
  → No:   POST { pendingState, toolCallId, confirmed: false } → tool result = "user declined"
Either way, the loop continues (more rounds, or a final summary reply)
```

Declining doesn't get silently retried — the tool result fed back to the model explicitly says the
user declined, so it has to ask what to do instead rather than looping on the same action.

## Restructured for slower, deeper requests

`research_ticket` can chain an Intercom fetch, a Notion MCP search, and several rounds of follow-up
tool calls into one request — well past what a "create this rule" exchange needs. To accommodate
that without changing the request/response shape (still one HTTP round trip, no background job):

- `AI_TIMEOUT_MS` (per-call LLM timeout) raised from 15s to 45s
- `MAX_TOOL_ROUNDS` raised from 3 to 6
- `export const maxDuration = 90` added (Vercel route-segment config — the serverless function
  itself would otherwise get killed by the platform regardless of the app's own timeouts; raise the
  Vercel plan's function timeout too if research requests still get cut off in prod)
- The client (`ai-chat.tsx`) swaps the loading indicator's text after ~6s and ~20s so a slow research
  reply doesn't read as stuck behind the same three dots the whole time

This is a deliberate middle ground, not the full "background job + notification" design that was
considered and set aside — see [[Notifications]] for the bell this could eventually report through
if research ever needs to run longer than a single request comfortably allows.

## Known gaps

- No usage logging/analytics — there's no record of how often, or for what, the assistant gets
  used. Worth adding before further investing in its scope, so decisions are based on real usage
  rather than guesswork.
- `search_cases` only searches OPEN conversations (matching the underlying
  `lib/intercom.ts::searchOpenConversations` it's built on) — it cannot look up a closed/resolved
  conversation.
- The FAB icon and general framing ("AI Assistant") still reads as a general helper; the tool
  surface is scoped to automation + playbook/case lookup, not a full support Q&A. Keep this in mind
  before advertising it more broadly — either narrow the copy or keep expanding the tool set to
  match.
