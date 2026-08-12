---
title: Draft Verify Pipeline
tags: [ai, drafting, intercom, reply-queue]
updated: 2026-08-12
---

# Draft Verify Pipeline

This is the subsystem that turns an Intercom conversation into a customer-facing support reply — grounded in playbooks, the internal knowledge base, and live Notion retrieval, and checked for factual accuracy before it ever reaches a human's "Send" button. It has three entry points that share the same building blocks (`lib/draft-ai.ts`) but assemble them differently depending on whether a human is watching in real time.

## Three drafting paths

### 1. Manual Draft

`POST /api/draft` (`mode: "generate"`, the default). The agent is looking at a case in the Canvas (see [[Canvas Workflow]]) and clicks "Generate." The route builds the full system prompt via `buildSystemPrompt()` — playbook match, knowledge-base articles, the agent's tone preference, agent identity rules, all of it — and streams the completion straight to the UI token-by-token via `streamChatCompletion()`. This path returns the **raw, unverified draft**: there is no verifier pass. The agent is expected to read and edit it inline before sending, so the safety net here is the human, not a second model call.

### 2. Improve Draft

Same route, `POST /api/draft` with `mode: "improve"`. The agent already has a draft — pasted in, or a prior generation — and clicks "Improve." This swaps in `buildImproveSystemPrompt()`, a deliberately lighter prompt: no playbook injection, no greeting rules, no knowledge-base retrieval. It's tuned for iterative line-editing of text that's already grounded, not for re-deriving the case from scratch. Also streamed live, also unverified — same reasoning as path 1.

### 3. Autonomous Queue Pipeline

The only path that runs without an agent watching. The shared compute step, `computeAndPersistSuggestion()` in `lib/reply-queue-pipeline.ts`, is reached from four places:

- `app/api/webhooks/intercom/route.ts` → `runReplyQueuePipeline()` — real-time, on events like `conversation.admin.assigned` / `conversation.user.replied`.
- `app/api/reply-queue/assign/route.ts` and `app/api/reply-queue/assign-bulk/route.ts` — right after the human-gated Intercom assignment write (foreground for a single assign, background `after()` for a bulk batch).
- `app/api/reply-queue/route.ts` — a background backfill that runs while an agent has the Queue tab open and polling.
- `app/api/cron/draft-recovery/route.ts` (added 2026-08-12) — a periodic sweep, independent of any agent's browser, that catches whatever the three paths above missed. See Reliability below.

Whichever path calls it, `computeAndPersistSuggestion()`:

- Only processes **assigned** conversations — the unassigned/triage pool is explicitly skipped (see [[Triage System]]).
- Skips conversations the agent (or Fin) has already replied to since the triggering event.
- Runs the full chain: playbook gate → Notion retrieval → generation → **verifier** → persist.
- Writes a row to `suggested_replies` via `upsertPendingSuggestion()`. It **never auto-sends** — the result is always a draft sitting in the agent's Queue tab, waiting for approval.

Because this path runs unattended, it's the only one of the three drafting *paths* with a verifier pass — there's no human in the loop yet to catch an ungrounded claim, so the pipeline has to catch it itself.

## Key library: `lib/draft-ai.ts`

This ~1000-line file is the shared toolbox all three paths draw from:

- **`buildSystemPrompt()`** — the full draft prompt: playbook, KB articles, tone preference, agent identity rules. Used by Manual Draft and the Queue pipeline.
- **`buildNotionAwareSystemPrompt()`** — a variant for tail cases (no playbook match), grounded only in customer-safe Notion hits rather than the full playbook set.
- **`buildImproveSystemPrompt()`** — the light prompt for iterative editing (path 2).
- **`buildUserMessage()`** — assembles thread context and images into the user turn; enforces a privacy rule that the customer's real name is never leaked into the model input (see [[System Prompt Architecture]]).
- **`buildVerifierGroundingContext()`** / **`buildDraftVerifierMessages()`** — build the lightweight verifier prompt: a grounding check only, with none of the behavioral/tone rules the drafting prompt carries.
- **`streamChatCompletion()`** — the shared streaming client: timeouts, bounded retry, throttling, and abort-signal handling (detailed below).

## Playbook gate: `lib/playbook-gate.ts`

Before generating a reply, the pipeline needs to know whether the case matches a known playbook. `buildGatePrompt()` builds a classification prompt, and `classifyPlaybookMatch()` sends it to the LLM to get a confidence score. A match is accepted at a threshold of `GATE_CONFIDENCE_THRESHOLD = 0.6`. If the LLM call itself fails (timeout, provider error), the gate falls back to plain keyword matching rather than blocking the pipeline entirely.

## Risk banding: `lib/reply-queue.ts`

Once a draft exists, it's classified into a `RiskBand` (`"ready" | "needs_check" | "low_confidence"`) by `deriveRiskBand()`:

- A **capability gap** — the conversation touches a locked category (financial, KYC, media, ban — see `LOCKED_CATEGORIES`, checked via `hasCapabilityGap()` against Intercom tags) — forces `needs_check`, meaning the send action is locked until a human explicitly approves.
- A playbook match or usable Notion hits produce `ready`.
- A tail case with no grounding at all (no playbook, no Notion) produces `low_confidence`.

`isSendLocked(band)` is the gate the UI (and any send route) checks before allowing a suggestion to go out unattended — in practice this pipeline never sends unattended at all, but the band still drives what the Queue UI surfaces and how urgently.

## Autonomous entry point: `lib/reply-queue-pipeline.ts`

`computeAndPersistSuggestion()` is the main function for the autonomous path. It runs generation + verification, builds a **justification** — a short explanation surfaced as a tooltip in the Queue UI explaining *why* this particular suggestion was generated (playbook matched, Notion hits found, etc.) — and calls `upsertPendingSuggestion()` (in `lib/reply-queue-store.ts`) to write the row into `suggested_replies` (see [[Database Schema Reference]]). `runReplyQueuePipeline()` is the thin wrapper the webhook calls: it classifies the incoming event's topic (agent reply vs. customer message) and, for a customer message, calls `computeAndPersistSuggestion()` for that one conversation. The assign routes, the `/api/reply-queue` backfill, and the recovery sweep all call `computeAndPersistSuggestion()` directly instead, since each already has a specific conversation id in hand and doesn't need the webhook's topic routing.

It resolves the conversation's owner from Intercom's current `admin_assignee_id` via `resolveOwner()`. Since 2026-08-12 it also accepts an explicit `opts.owner = { id, email }`, used only as a **fallback** when that resolve comes back empty — which happens when the assignment went out under the shared `INTERCOM_ADMIN_ID` env fallback rather than the agent's own Intercom id, or when Intercom's read simply lags the assignment write that was just made. Both assign routes and the `/api/reply-queue` backfill pass their own agent in as this fallback, since they either just wrote the assignment themselves or are actively reconciling it and already know whose draft it is. Before this fix, the assigned-only gate below would skip forever with nothing explaining why, and the Queue card sat on "Drafting…" indefinitely.

## Reliability: budgets, the recovery sweep, and attempt outcomes (2026-08-12)

Before this pass, every drafting path was opportunistic: the assign routes drafted in the foreground or in `after()` (both bounded by the platform's function-duration limit), and the `/api/reply-queue` backfill only ran while an agent had the Queue tab open and polling. A conversation could be assigned, sit non-read with the customer waiting, and simply never get a draft — with nothing anywhere reporting it. The fix touched four things:

**Duration limits.** `app/api/reply-queue/assign/route.ts`, `app/api/reply-queue/assign-bulk/route.ts`, and `app/api/reply-queue/route.ts` now all set `maxDuration = 300` (previously unset, so the platform default killed a background `after()` drafting loop partway through — a 15-conversation bulk batch at p90 generation speed needed far longer than the default allowed). Each loop also stops itself at a self-imposed wall-clock budget under that limit — `DRAFT_BUDGET_MS` (assign-bulk) and `BACKFILL_BUDGET_MS` (the reply-queue backfill), both `240_000`ms — and leaves anything it doesn't reach completely untouched (no attempt marker), so the recovery sweep below picks it up cleanly rather than finding a half-written attempt.

**Stale grace period.** The `/api/reply-queue` reconciler marks a pending draft stale when its conversation is missing from `getNonReadAssignedConversations()`. That set comes from Intercom's SEARCH index, which is only eventually consistent — right after an assignment the conversation is often not indexed yet, so a draft generated seconds earlier was destroyed, and the attempt marker then blocked regeneration for the backfill's own `BACKFILL_WINDOW_MS` (5 min). `STALE_GRACE_MS` (10 min) now protects a freshly-created draft from this race: a pending row younger than the grace period is left alone and simply reappears on the next poll instead of being staled and re-blocked.

**Explicit owner fallback.** Covered above — `computeAndPersistSuggestion()`'s `opts.owner`.

**Attempt outcomes.** `reply_queue_attempts` (see [[Database Schema Reference]]) gained three columns. `recordSuggestionAttempts()` clears `outcome` / `reason` / `settled_at` back to null at the start of every attempt, before the LLM call; `settleSuggestionAttempt()` (`lib/reply-queue-store.ts`) fills them in at every terminal branch of `computeAndPersistSuggestion()` — generation failed, empty generation, persist failed, and success. `persist failed` is a newly-caught case: `upsertPendingSuggestion()`'s supersede-then-insert isn't a DB transaction, so a lost race can return `null` with no row actually written, which previously reported success to the caller anyway.

### The recovery sweep (`app/api/cron/draft-recovery/route.ts`)

A cron endpoint, authenticated the same `x-cron-secret` way as [[Triage System|the triage sweep]], `maxDuration = 300`. For each agent with an `intercom_admin_id`, it fetches `getNonReadAssignedConversations()`, finds non-read conversations with no pending draft, runs the candidates through `filterRecoveryCandidates()` (`lib/reply-queue-store.ts`), and calls `computeAndPersistSuggestion()` for each survivor. Two independent cooloff clocks decide what counts as a candidate:

- `RETRY_AFTER_MS` (15 min) — skip anything attempted more recently than this; it's either still in flight or was just handled by one of the client-driven paths.
- `FAILURE_COOLOFF_MS` (6 hours) — a conversation whose last attempt ended in a terminal `'skipped'` outcome waits this long before being retried, so a permanently un-draftable ticket can't burn a generation on every single sweep. A killed-mid-flight attempt (`outcome` still `null`) deliberately does **not** get this long cooloff — that's exactly the case recovery exists to rescue.

The run is bounded by `RUN_BUDGET_MS` (240s, under the 300s `maxDuration`) and a hard cap, `MAX_DRAFTS_PER_RUN` (12), and dedupes conversations across agents within the same run (two agents sharing an Intercom admin id, or the env fallback, would otherwise both draft the same conversation). Strictly draft-only, like every other path here: it never sends, assigns, or writes to Intercom. The response is counts only (`agentsScanned`, `candidates`, `drafted`, `failed`, `intercomErrors`, `budgetExhausted`) — no conversation ids or customer data — and returns HTTP 207 when the run was partial (an Intercom error, or the budget/cap ran out with work still queued).

**Not yet scheduled.** The route exists but is not yet registered in Supabase `pg_cron` — do that **after** the deploy that ships the route, or it will 404 every 5 minutes. The intended cadence matches the triage sweep. Register it with the snippet below, which lifts `CRON_SECRET` from an existing job rather than having anyone paste the secret into a query:

```sql
select cron.schedule(
  'draft-recovery-5min',
  '*/5 * * * *',
  format(
    $job$
    select net.http_post(
      url     := 'https://project-z4cpw.vercel.app/api/cron/draft-recovery',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', %L
      ),
      body    := '{}'::jsonb
    );
    $job$,
    (select (regexp_match(command, '''x-cron-secret'',\s*''([^'']+)'''))[1]
     from cron.job where jobname = 'triage-sweep-5min')
  )
);
```

Note that `pg_net` gives up waiting after its default 5s and logs a timeout, while the function keeps running to completion server-side. That is normal here (the automation sweep already behaves this way) — a timeout row in `net._http_response` means the response wasn't captured, not that the sweep didn't run. To confirm a run really happened, check `drafted`/`candidates` counts in the response when one is captured, or the `reply_queue_attempts` rows it settled.

### Honest client toasts

`/api/reply-queue/assign` now returns `{ ok, drafted, suggestionOutcome, draftError }` instead of just `{ ok: true }`. `components/canvas/triage-panel.tsx`, `components/canvas/queue-panel.tsx`, and `components/canvas/inbox-panel.tsx` (which loops the same single-assign endpoint for its own bulk action) all read `drafted` and show a warning toast — "Assigned to you, but the draft didn't generate/regenerate — retrying in the background." — instead of unconditionally claiming a draft is on its way. Previously all three claimed success even when the draft had already failed. `app/api/reply-queue/assign-bulk/route.ts` (the Triage panel's own multi-select "Assign N + draft") still reports assignment counts only, not per-conversation draft success — a bulk-assigned conversation whose draft fails is caught by the recovery sweep rather than surfaced in that toast.

## Retrieval is being replaced (2026-08-09)

The playbook gate + Notion-MCP grounding described below is measurably
net-negative: playbook-matched drafts were approved 57.6% of the time versus
67.5% when nothing matched (n=1,201 `reply_queue_events`). A chunked corpus with
hybrid search, an explicit abstain, and evidence-based risk banding is built and
sits behind `RETRIEVAL_V2` (default off) until the frozen eval set clears it.

Read [[Retrieval Architecture]] for the replacement. The sections below still
describe the **live default** path.

## Verifier flow

The verifier is what makes the unattended path safe to leave to `suggested_replies` without a human watching generation happen live. It's a second, cheaper model call whose only job is to strip claims the draft can't actually back up.

```
Generated draft (from buildSystemPrompt + streamChatCompletion)
        │
        ▼
buildVerifierGroundingContext()
   — resolves: playbook text + KB articles + customer-safe-only Notion hits
        │
        ▼
buildDraftVerifierMessages()
   — lightweight verifier prompt: grounding check only, no behavioral/tone rules
        │
        ▼
streamChatCompletion()  — routed to the cheaper "aux" model
        │
        ▼
Verifier rewrites the draft to remove unsupported claims
   e.g. "I've checked your account"  →  "I'll look into your account"
        │
        ▼
upsertPendingSuggestion()  — persists verified body + risk_band to suggested_replies
```

The example rewrite ("I've checked your account" → "I'll look into your account") is exactly the class of claim the Capability Boundary Rules in the system prompt try to prevent upstream (see [[System Prompt Architecture]]) — the verifier is the second layer of defense when the drafting model slips past that rule anyway.

Since 2026-08-09 the verifier also enforces the payment-dispute rule as a hard delete, not a softening: any instruction to dispute, reverse, or "report as unauthorised" a charge with a bank, card issuer, or wallet is cut outright, and a draft that treats a **pending** charge as money taken is corrected to an authorisation hold. This one is a delete rather than a rewrite because the advice is actively harmful — Fanvue's zero-tolerance chargeback policy bans the account of a customer who follows it. See [[System Prompt Architecture]] §3b for the upstream rule and its Notion sources.

## Reply style nudge

`REPLY_STYLE_NUDGE` is appended by all three drafting paths (`app/api/draft/route.ts`, `lib/reply-queue-pipeline.ts`, and `draft_reply` in `app/api/ai/chat/route.ts`). It exists to suppress gpt-5-family verbal tics that read as machine-generated:

- narrating an internal action plan as a checklist instead of just writing the reply
- ending by asking the customer to approve internal checks
- **(added 2026-08-09)** gating an action behind a magic word — "Reply 'cancel it' and I'll…", "Say 'yes' to proceed", "Type CONFIRM". A support agent asking a customer to send back an exact keyword reads as an automated bot, which undercuts the whole [[System Prompt Architecture]] identity layer. The replacement is an ordinary question that leaves the wording to the customer: "Just confirm you'd like me to go ahead and I'll get it sorted."

## Models & routing

Everything runs on OpenAI, on **one Fanvue org key** (`OPENAI_API_KEY`, configured server-side). There is no per-agent key and no per-agent model: the personal-AI-key feature was removed on 2026-08-03 once Fanvue provisioned a key for the whole team. Model choice is an env var, not a user setting.

- **Default text model**: `gpt-5.6-luna` (`OPENAI_TEXT_MODEL`). It's multimodal, so there is **no separate vision model any more** — the same model handles text turns and pasted screenshots. The old `deepseek-v4-flash` / `qwen3.6-27b` split and the `selectModel()` helper that chose between them are gone.
- **Aux model**: `gpt-5.6-luna` by default (`OPENAI_AUX_MODEL`), used for the narrow non-creative calls — the draft verifier, screenshot-evidence extraction, the playbook gate and triage keyword expansion. Kept as its own knob so cost can be cut there without touching reply quality.
- **No temperature**: the gpt-5.x family rejects `temperature` outright (400) and requires `max_completion_tokens` instead of `max_tokens`. `reasoning_effort` replaced it — `low` for reply generation (`OPENAI_REASONING_EFFORT`), `none` for the aux/JSON calls. Reasoning tokens are billed as output **and** count against the completion budget, so too small a cap gets spent thinking and returns an empty body; that's why the default budget is 8192 rather than 4096.
- **Structured outputs** replaced `temperature: 0` where determinism mattered: `GATE_RESPONSE_SCHEMA` in `lib/playbook-gate.ts` and the expansion schema in `lib/triage/expand.ts` pin the JSON shape via `response_format`. Both keep their defensive parsers as a fallback and still degrade to the keyword matcher on any failure.
- **Throttle** (`lib/ai-throttle.ts`): bounds in-flight requests (`AI_MAX_CONCURRENCY`) and starts per rolling window (`AI_MAX_PER_WINDOW` / `AI_WINDOW_MS`), so bulk drafting, the webhook pipeline and the queue backfill can't stampede the org's rate limit. Every call in the app passes through it — with one shared key there is no longer any path that bypasses it. On OpenAI the real ceiling is tokens-per-minute for the org's usage tier; the defaults are conservative placeholders, meant to be raised once the actual limits for the key are read off the OpenAI dashboard.
- **Removed 2026-08-03 — the personal AI key.** Agents used to be able to paste their own OpenAI key in Settings to get off a rate-limited shared router. Fanvue now provides one org key for everyone, so the whole feature is gone: `lib/ai-provider.ts`, `lib/provider-crypto.ts`, `app/api/agent/provider/`, the Settings card, the `PROVIDER_ENCRYPTION_KEY` env var, and the `agents.personal_ai_*` columns. `streamChatCompletion()` no longer takes a `provider` option. If a per-agent key is ever wanted again, it's a rebuild, not a flag flip.

## Timeouts & reliability

`streamChatCompletion()` wraps every call with:

- **Connect timeout**: 30s to first byte.
- **Stall timeout**: 30s max gap between stream chunks (catches a connection that opened but then went silent).
- **Retries**: up to 2 retries (3 attempts total), exponential backoff at 600ms → 1.2s → 2.4s.
- **429 handling**: honors the provider's `Retry-After` header, capped at a 20s ceiling so a single throttled request can't stall the UI indefinitely.
- **Client-side safety net**: the Canvas has both a manual Cancel button and a 45s inactivity watchdog that auto-aborts a generation that's stopped producing output, so "Generating…" can never hang forever (see [[Canvas Workflow]]).

## Reply send flow

Sending is deliberately split across two calls so the human approval step and the actual customer-facing send are separately auditable. The agent reviews a suggestion card in the Queue tab, optionally edits the body, and approves it:

```
Agent approves/edits a Queue card
        │
        ├──▶ POST /api/draft/send  {conversationId, body, html?, attachmentFiles?}
        │        │
        │        ├─ resolveIntercomAdminId(email) — verify agent identity → Intercom admin id
        │        ├─ sendIntercomReply()  →  Intercom POST /conversations/{id}/parts
        │        └─ 200 on success, surfaces Intercom status/attempts on failure
        │
        └──▶ POST /api/reply-queue/resolve  {conversationId, suggestionId, action, bodyChanged, finalBody}
                 │
                 ├─ logReplyQueueEvent()  →  reply_queue_events (audit trail: approve/edit/reject)
                 └─ resolveSuggestionOnReply(conversationId, "approved" | "stale")
                        →  flips suggested_replies.status, removing it from the Queue
```

The actual customer send happens through `/api/draft/send` (the same human-gated route used for a plain manual reply); `/api/reply-queue/resolve` only updates the queue's own bookkeeping — the suggestion's status and the `reply_queue_events` audit row — after that send has already gone out. This keeps a hard separation between "a message left our system" and "a suggestion was consumed," so the two can be reasoned about (and re-audited) independently.

## Key files

- `lib/draft-ai.ts` — prompt builders, `streamChatCompletion()`, `getTextDraftModel()` / `getAuxDraftModel()` / `getDefaultReasoningEffort()`
- `lib/playbook-gate.ts` — `buildGatePrompt()`, `classifyPlaybookMatch()`, `GATE_CONFIDENCE_THRESHOLD`
- `lib/reply-queue.ts` — `deriveRiskBand()`, `isSendLocked()`, `hasCapabilityGap()`, `LOCKED_CATEGORIES`
- `lib/reply-queue-pipeline.ts` — `computeAndPersistSuggestion()`, `runReplyQueuePipeline()`
- `lib/reply-queue-store.ts` — `upsertPendingSuggestion()`, `resolveSuggestionOnReply()`, `logReplyQueueEvent()`, `getPendingSuggestionsForAgent()`, `recordSuggestionAttempts()`, `settleSuggestionAttempt()`, `filterRecoveryCandidates()`
- `lib/ai-throttle.ts` — shared-key throttle + the shared OpenAI client (`openaiFetch()`, `openaiApiKey()`, `openaiBaseUrl()`)
- `app/api/draft/route.ts` — manual Generate/Improve endpoint
- `app/api/draft/send/route.ts` — human-gated Intercom send
- `app/api/reply-queue/route.ts` — Queue GET endpoint; reconciles cached suggestions against live Intercom, backfills missing drafts in the background (`STALE_GRACE_MS`, `BACKFILL_BUDGET_MS`)
- `app/api/reply-queue/assign/route.ts` — human-gated Intercom assignment + inline draft generation; returns `{ drafted, suggestionOutcome, draftError }`
- `app/api/reply-queue/assign-bulk/route.ts` — bulk assignment + background draft generation (`DRAFT_BUDGET_MS`)
- `app/api/reply-queue/resolve/route.ts` — queue bookkeeping after a send
- `app/api/cron/draft-recovery/route.ts` — recovery sweep cron; catches drafts the other paths missed (not yet scheduled in `pg_cron`)
- `app/api/webhooks/intercom/route.ts` — webhook trigger for the autonomous pipeline

See also: [[System Prompt Architecture]], [[Canvas Workflow]], [[Triage System]], [[Intercom Integration]], [[Database Schema Reference]], [[Settings and Profile]], [[Automation Rules Engine]].
