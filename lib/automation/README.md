# Automation runtime — how triggers & monitors actually fire

This is the engineering reference for the `lib/automation/` module: the runtime
flow of trigger and monitor rules, the three entry points that invoke them, the
shared evaluation pipeline they all converge on, and the pitfalls that have
already bitten us so we don't pay them twice.

For the *what we set out to build* design doc, see
`FanvueSupport/Engineering/Code/Feature - Automation (triggers & monitors).md`.
This file documents what the code actually does.

---

## 1. The rule

A rule is a row in `automation_rules`:

| Column | Meaning |
|---|---|
| `kind` | `"trigger"` (event-driven via webhook) or `"monitor"` (time-swept via pg_cron) |
| `owner_id` | The agent who **gets notified** when this rule fires — *not* who must own the conversation. |
| `conditions` | DNF tree (OR of groups, AND within a group). Each leaf is `{field, op, value}`. |
| `actions` | Ordered list of action objects. `flow.stop` short-circuits remaining rules. |
| `on_events` | Trigger-only. Subset of Intercom topics (e.g. `conversation.user.created`). |
| `sweep_every_mins` | Monitor-only. Skips sweeps until cadence elapsed. |
| `priority` | Lower runs first. |
| `enabled` | Disabled rules are skipped at the SQL filter. |

The condition tree is the same shape for both kinds. The field catalogue
(`fields.ts`) marks which fields apply to which kind via `appliesTo: ("trigger"
| "monitor")[]` — the UI's `fieldsForKind(kind)` filters by this.

## 2. Entry points

There are **three** code paths that fire rules. They must produce
semantically identical results given the same conversation; if they diverge,
you have the bug we've debugged multiple times.

| Entry point | Kind it runs | File | Triggered by |
|---|---|---|---|
| Webhook handler | `trigger` | `app/api/webhooks/intercom/route.ts` → `webhook.ts` `runTriggerForEvent` | Intercom POST with HMAC sig |
| Cron sweep | `monitor` | `app/api/automation/sweep/route.ts` → `runner.ts` `runMonitorSweep` | Supabase `pg_cron` every 5 min |
| Manual "Run now" | `monitor` only | `app/api/automation/rules/[id]/run/route.ts` | UI button (signed-in agent) |

The manual-run endpoint is the **reference implementation**: it always
fetches the global open queue and evaluates the rule against every
conversation. The other two entry points have been refactored to match its
semantics.

## 3. The shared evaluation pipeline

All three entry points converge on this algorithm:

```
1. Load enabled rules of the right kind.
2. (Trigger only) Filter by topic matching payload.topic.
   (Monitor only) Filter by sweep_every_mins cadence.
3. Fetch the conversation(s) to evaluate:
   - Trigger: the single conversation from the webhook payload.
   - Monitor sweep / manual: searchOpenConversationsForAdmin() with NO admin ID
     → the FULL open queue (across all teammates). Never pass an admin ID here.
4. Build a lookup of intercom_admin_id → agents.id (for the case-row guard).
5. Group rules by owner_id.
6. For each conversation:
     For each (ownerId, ownerRules) group:
       a. Load case metadata scoped to (intercom_conversation_id, ownerId).
       b. buildContext(live, meta, topic | null, nowMs).
       c. plan = planCaseActions(ownerRules, ctx).  // engine.ts, pure.
       d. If plan is non-empty:
          - Lazy-upsert a cases row ONLY if conv.assignee resolves to ownerId
            (see §5 — cross-agent guard). Otherwise caseId stays null.
          - For each (rule, actions): runAction(...) + insert automation_runs.
```

The two non-obvious moves are at step 3 ("never per-agent") and step 5d
("lazy-upsert only when owner == assignee"). The history of bugs that
forced these is in §6.

## 4. owner_id semantics

**The rule's `owner_id` is the notification target, not the conversation's
owner.** A condition like `teammate is 6510758` is what scopes the rule to
*the assignee that matters*. This separation matters because:

- A support manager's rule "alert me when Fin (an AI teammate) gets any chat"
  has `owner_id = manager.id` and `conditions: teammate is Fin's intercom_admin_id`.
- The conversation will be assigned to Fin, who has no row in `agents`.
- The manager needs to receive the Slack DM, not Fin.

If the entry point scopes rules to "rules where owner_id matches the
conversation assignee" (the old pre-fix behaviour), this rule never fires.
The fix was to load ALL enabled rules with the right topic / kind, then let
the condition engine's `teammate is X` decide applicability.

## 5. Cross-agent guard for lazy-upsert

`cases` has a unique constraint on `intercom_conversation_id` alone — not
on `(intercom_conversation_id, owner_id)`. So if owner A's rule fires on a
conversation assigned to agent B, and we lazy-upsert a `cases` row owned by
A, the `ON CONFLICT` clause would clobber B's existing case row and reset
its `auto_tags` / `priority_hint`.

The guard, in all three entry points:

```ts
let caseId = meta.caseId
if (!caseId && assigneeAgentId === ownerId) {
  // upsert; safe because we are not stealing another owner's row
}
// otherwise caseId stays null
```

Consequences:
- `alert.in_app` / `alert.slack` — work fine with `caseId = null`. The DM fires.
- `case.flag` / `case.suggest_playbook` / `draft.prestage` — need a `caseId`;
  return `"no case id"` in `actions_taken[].detail` when fired cross-agent.
  Visible in `automation_runs` but no client row mutated.

If we ever need cross-agent rules to fully apply mutation actions, the right
fix is a composite unique constraint on `(intercom_conversation_id, owner_id)`
— not removing this guard.

## 6. Known pitfalls (kept here so we don't repeat them)

Each item is a real bug that fired in production today and the architectural
choice that prevents recurrence.

### 6a. Hardcoded default topics that don't exist in Intercom

`conversation.created` and `conversation.updated` are *not* Intercom topic
names. Real ones use `conversation.<actor>.<event>` (`.user.created`,
`.admin.assigned`, etc.). When defaults were the invalid pair, the rule's
`on_events.includes(topic)` filter never matched and the trigger silently
no-op'd. **Fix:** UI defaults, backend defaults, and `fields.ts` event
options are now sourced from the same set of real Intercom topics. New event
options must reference the [Intercom webhook topics
reference](https://developers.intercom.com/docs/references/webhooks/topics).

### 6b. Per-agent fetch of the live queue

`searchOpenConversationsForAdmin(intercomAdminId)` filters to a single
admin's queue. If the sweep loops over agents in our DB and fetches per
agent, conversations assigned to non-agents (Fin, other teammates) never get
evaluated — rule monitors silently skip cross-team SLA checks. **Fix:** both
sweep and trigger now fetch the *global* open queue. If you add a new entry
point, pass no admin id unless you genuinely need a personal scope.

### 6c. Per-assignee scope of rule loading in the trigger handler

The old webhook resolved `assignee → owner_id` first and only loaded
`automation_rules WHERE owner_id = thatOwner`. A rule owned by Vinicius
about Fin's queue never showed up. **Fix:** load all enabled trigger rules
with the matching topic; the condition engine handles personal scoping via
`teammate` conditions.

### 6d. UI offered actions with no params editor

`case.suggest_playbook` had no playbook-id picker, and `draft.prestage` had
no visible UI. Users could pick them from the dropdown, save, and the
handler returned `"no playbook_id"` in `actions_taken[].detail` — observable
but not surfaced. **Fix:** UI now renders a `PlaybookPicker` for the former
and an inline hint for the latter so the absence of params is intentional.

### 6e. Trigger ↔ monitor toggle preserved dead conditions

When switching trigger → monitor, conditions referencing `event` (a
trigger-only field) survived. In monitor mode `ctx.fields.event` is always
null, so the condition silently evaluated to false and the rule was dead.
**Fix:** `blankWithKind` in the rule editor now prunes conditions whose
field is not in `fieldsForKind(newKind)` and toasts the user about the drop.

### 6f. Manual "Run now" was incrementing the rule's last-fired timestamp

This made the next scheduled sweep think the rule had just been run and
skip it for `sweep_every_mins`. **Fix:** manual runs no longer touch the
cadence timer; they're for testing.

## 7. Where each piece of the pipeline lives

```
lib/automation/
  types.ts             Shared types: AutomationRule, Action, ConditionTree.
  fields.ts            Field × operator catalogue. SINGLE SOURCE for UI builder
                       AND evaluator. options[] for `event` MUST mirror the
                       real Intercom topic names.
  engine.ts            Pure evaluator: evaluateTree, evaluateCondition,
                       applyOperator, planCaseActions. No I/O.
  context.ts           Builds the EvalContext from a live conversation +
                       case metadata + topic. The keys here must match the
                       field.key values in fields.ts.
  actions.ts           Action dispatch. Handler map keyed by ActionKind.
                       The "draft-only safety boundary" lives here — no
                       handler may write to Intercom on behalf of the customer.
  runner.ts            Monitor sweep. runMonitorSweep loads rules + the
                       global open queue, groups rules by owner, evaluates.
  webhook.ts           Trigger handler. runTriggerForEvent loads all
                       matching-topic rules + the single payload conversation,
                       same grouping, same lazy-upsert guard.
  prestage.ts          draft.prestage action implementation.
```

The three entry points (`app/api/webhooks/intercom/route.ts`,
`app/api/automation/sweep/route.ts`,
`app/api/automation/rules/[id]/run/route.ts`) are thin shells around the
above. If you find yourself adding logic inside an entry point that another
entry point doesn't have, you are creating divergence — move it into the
shared module instead.

## 8. Audit trail

Every fire writes a row to `automation_runs`:

| Column | What's there |
|---|---|
| `rule_id`, `case_id`, `intercom_conversation_id` | Subject of the run |
| `matched` | `true` (we only insert on a match) |
| `actions_taken` | Per-action `{kind, applied, detail}` array — read this when an action looks like it ran but had no effect |
| `context` | Snapshot of every field in `ctx.fields` — invaluable for debugging "why didn't this match?" |
| `source` | `"sweep"` or `"manual"` (webhook does not yet stamp; treat null as webhook) |
| `ran_at` | UTC timestamp |

When debugging "rule didn't fire":
1. Did `automation_runs` get a row? If yes, condition matched — check
   `actions_taken[].detail` for the action-level failure.
2. If no row, the rule was filtered out before evaluation. Check rule
   `enabled`, `on_events`, `sweep_every_mins`, and — for triggers — that
   the topic in the webhook actually matches one of `on_events`.
3. If you suspect cross-agent scope, query `automation_runs` for the same
   conversation across a few rules to see who DID match.

## 9. Adding a new feature here

Checklist for sane extension:

- [ ] New field? Add to `fields.ts` with the right `appliesTo`, populate it
      in `context.ts`, and add operator handling in `engine.ts:applyOperator`
      if the type is new.
- [ ] New action kind? Add to `types.ts`, write a handler in `actions.ts`,
      register in `ACTION_HANDLERS`, add UI in `automation-client.tsx`
      `ActionsStep` (params editor) and `ACTION_KINDS` (dropdown). If the
      action needs a `caseId`, it will be unavailable for cross-agent rules
      — call that out in the UI hint.
- [ ] New entry point? Use the §3 pipeline verbatim. Fetch the global
      queue, group rules by owner, apply the §5 case-upsert guard. Do not
      filter rules by `owner_id` at the SQL level.
- [ ] New event topic? Add to `fields.ts` `event` options *and* the
      corresponding webhook subscription in the Intercom developer hub.
      Verify the topic name against the
      [Intercom topics reference](https://developers.intercom.com/docs/references/webhooks/topics).
