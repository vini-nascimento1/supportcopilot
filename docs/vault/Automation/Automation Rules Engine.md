---
title: Automation Rules Engine
tags: [automation, rules, intercom, engine]
updated: 2026-07-29
---

# Automation Rules Engine

The automation engine lets an individual agent define their own no-code rules over Intercom conversation events — to auto-flag a case, stage a draft, or get alerted — without any code changes. Rules are owned per-agent (`ownerId`), so each agent's automations only act on their own behalf (e.g. a Slack alert action DMs the rule's owner, not the whole team).

Two rule kinds cover the two ways a case can need attention:

- **Trigger** — event-based. Fires immediately when a matching Intercom webhook event arrives (`onEvents: ["conversation.user.created"]`, etc).
- **Monitor** — time-based. Runs on a cron sweep at a configurable interval (`sweepEveryMins: 5`), checking conditions that only become true as time passes (e.g. "still waiting after 15 minutes").

## UI

`components/automation-client.tsx` provides full CRUD for rules plus the condition/action builder — creating, editing, enabling/disabling, deleting, and manually running a rule.

## Condition tree

Conditions are expressed as a small DNF-style tree (`lib/automation/types.ts`), matching the shape used by the UI builder and the evaluator so the two can never drift:

```ts
type ConditionTree = {
  match: "all" | "any",   // AND across groups, or OR across groups
  groups: [{
    match: "all" | "any",
    conditions: [
      { field: "sla_status", op: "is", value: "sla_breach" },
      { field: "tags", op: "in", value: ["payout"] },
      { field: "time_waiting_seconds", op: "gt", value: 900 }
    ]
  }]
}
```

An empty tree (no groups) matches everything.

### Operators

Operators are grouped by field type (`OPERATORS_BY_TYPE` in `lib/automation/fields.ts`):

- **text**: `is`, `is_not`, `contains`, `not_contains`, `matches_regex`, `is_empty`, `not_empty`
- **enum**: `is`, `is_not`, `in` (array membership)
- **number**: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
- **duration**: `gt`, `gte`, `lt`, `lte` (durations are stored/evaluated in seconds; the UI enters minutes)
- **tags**: `contains`, `not_contains`, `in`, `is_empty`, `not_empty`
- **boolean**: `is_true`, `is_false`
- **event**: `is` (trigger rules only)

### Fields

The field catalogue (`lib/automation/fields.ts`) is grouped by category and each field declares which rule kinds it applies to:

- **Conversation**: `status` (open/snoozed/closed), `priority_hint` (internal urgent/normal/low), `priority` (Intercom's own priority flag), `subject`, `tags` (Intercom), `auto_tags` (set by rules), `teammate`, `human_assigned` (a human is assigned, Fin excluded)
- **Requester**: `is_creator`
- **Knowledge**: `matched_playbook`
- **Time** (monitor only): `time_since_update`, `time_since_created`
- **SLA**: `sla_status` (active/hit/missed/cancelled/none), `time_waiting_seconds`, `admin_replied` (a human has replied, Fin excluded)
- **Event** (trigger only): `event`, with option values matching Intercom's webhook topics exactly — `conversation.user.created`, `conversation.user.replied`, `conversation.admin.assigned`, `conversation.admin.replied`, `conversation.admin.closed`, `conversation.rating.added`

Anything outside these fields/topics is invisible to the engine — an `event` value that doesn't match an Intercom webhook topic string makes the trigger runner skip the rule silently.

## Actions

All actions are **draft-only** — none of them can act directly toward a customer. That boundary is enforced by the absence of any send-capable action kind, not by a runtime check:

- `alert.in_app` — in-app toast + sidebar badge
- `alert.slack` — DMs the rule's owner via [[Slack Integration]] (requires that agent's own Slack OAuth token from [[Settings and Profile]])
- `case.flag` — sets a hint flag on the case card
- `case.suggest_playbook` — links a playbook to the conversation
- `draft.prestage` — generates and caches an AI draft ahead of time (see [[Draft Verify Pipeline]])
- `draft.macro` — stages fixed macro text as a draft (never sends on its own)
- `flow.stop` — halts further rule processing for this event, so lower-priority rules don't also fire

## Evaluation and execution

Evaluation logic lives in `lib/automation/engine.ts` and is pure (no I/O):

- `evaluateTree()` — walks the condition tree, combining groups per its `match` mode
- `evaluateGroup()` — combines conditions within a group per its `match` mode
- `evaluateCondition()` — applies a single operator to a field value
- `planCaseActions()` — turns a matched rule's actions into a concrete action plan for a case

Execution is split across two files by trigger kind:

- `lib/automation/webhook.ts` — `runTriggerForEvent()`, invoked synchronously from the Intercom webhook handler; evaluates all of the event owner's trigger rules against the incoming payload. Also owns `verifyIntercomSignature()` for validating that webhook calls actually came from Intercom.
- `lib/automation/runner.ts` — `runMonitorSweep()`, invoked by the cron sweep; iterates conversations and evaluates each agent's monitor rules against current state.

Action side effects (writing the flag, prestaging the draft, sending the Slack DM, etc.) are carried out by `runAction()` in `lib/automation/actions.ts`.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/automation/rules` | GET / POST | List / create rules |
| `/api/automation/rules/{id}` | PATCH / DELETE | Update / delete a rule |
| `/api/automation/rules/{id}/run` | POST | Manually run a single rule on demand |
| `/api/automation/rules/test` | POST | Dry-run a rule's conditions without saving |
| `/api/automation/sweep` | POST | Cron entry point for `runMonitorSweep()`, authenticated via a `CRON_SECRET` header |
| `/api/automation/alerts` | POST | Fetch pending alerts for the Automation page's Alerts tab (see [[Notifications]]) |

## Key files

- `components/automation-client.tsx` — rules CRUD UI + condition/action builder
- `lib/automation/types.ts` — `ConditionTree`, `ConditionGroup`, `Condition`, `Action`, `AutomationRule`, `Operator`
- `lib/automation/fields.ts` — field catalogue + operators-by-type (shared source of truth for UI and engine)
- `lib/automation/engine.ts` — `evaluateTree()`, `evaluateGroup()`, `evaluateCondition()`, `planCaseActions()`, `applyOperator()`
- `lib/automation/webhook.ts` — `runTriggerForEvent()`, `verifyIntercomSignature()`
- `lib/automation/runner.ts` — `runMonitorSweep()`
- `lib/automation/actions.ts` — `runAction()`
- `lib/automation/context.ts`, `lib/automation/prestage.ts`, `lib/automation/rules.ts` — supporting context-building, draft prestaging, and rule persistence helpers
- `app/api/automation/rules/route.ts`, `app/api/automation/rules/[id]/route.ts`, `app/api/automation/rules/[id]/run/route.ts`, `app/api/automation/rules/test/route.ts`, `app/api/automation/sweep/route.ts`, `app/api/automation/alerts/route.ts`

## Data flow

```
Trigger path (event-driven):
Intercom webhook → verifyIntercomSignature() → runTriggerForEvent(payload)
  → load owner's enabled trigger rules whose onEvents includes this topic
  → evaluateTree() per rule → matched rules → planCaseActions() → runAction() per action
    (alert.in_app / alert.slack / case.flag / case.suggest_playbook / draft.prestage / draft.macro / flow.stop)

Monitor path (time-driven):
Cron → POST /api/automation/sweep (CRON_SECRET) → runMonitorSweep(nowMs)
  → for each agent, load enabled monitor rules
  → for each open conversation, build EvalContext → evaluateTree() → planCaseActions() → runAction()
```

## Related pages

[[Tech Stack]] · [[Intercom Integration]] · [[Notifications]] · [[Slack Integration]] · [[Draft Verify Pipeline]] · [[Triage System]] · [[Settings and Profile]] · [[Database Schema Reference]]
