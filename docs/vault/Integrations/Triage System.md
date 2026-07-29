---
title: Triage System
tags: [triage, intercom, automation]
updated: 2026-07-29
---

The Triage System periodically sweeps Intercom's open-and-unassigned conversations into a ranked pool, so agents aren't limited to working only what's directly assigned to them. Each agent can filter the shared pool by keyword and audience and claim ("Assign to me") whatever best matches their own strengths, rather than waiting for a manual assignment.

It is deliberately LLM-free: classification reuses the same keyword playbook matcher the live dashboard tip uses (`getTopMatches()` in `lib/case-intelligence.ts`), never a Verboo gate/generation call, so a cron running every few minutes can't burn LLM budget. The sweep only reads Intercom and writes to the app's own `triage_items` table — it never sends, assigns, or otherwise writes back to Intercom itself.

## The sweep (`lib/triage/sweep.ts`)

`runTriageSweep()` runs every 5 minutes via `POST /api/cron/triage-sweep`, and can also be triggered manually ("Sweep now" in the Triage panel). For each run:

1. Fetch open conversations from Intercom filtered server-side to `admin_assignee_id = 0` (Intercom's "unassigned" sentinel) via `searchOpenConversations({ unassignedOnly: true })`. This keeps the fetch scoped to just the pool being kept (roughly one page in practice) instead of the whole workspace's open queue.
2. Filter again client-side (`isUnassigned()`) as a belt-and-braces check — a conversation already assigned to any teammate, whether or not they use the copilot, stays out of the pool.
3. Score each conversation's subject + first-message text against every playbook's aliases/case_type using `scorePlaybook()` (`lib/case-intelligence.ts`), keeping the top match.
4. Compute Intercom's native SLA status and priority flag, and check for a capability gap (`hasCapabilityGap()`).
5. Upsert one row per conversation into `triage_items` (`onConflict: intercom_conversation_id`).
6. Prune stale rows — but only when the sweep was **complete** (paged through the entire unassigned set without hitting the page cap or erroring). A partial sweep only saw a subset of the pool, so it upserts what it saw and leaves everything else untouched; pruning on a partial run would wrongly evict conversations that are still genuinely unassigned. Real-time removal (see below) covers the gap in between complete sweeps.

## Matching logic

The actual scoring function, `scorePlaybook()`, lives in `lib/case-intelligence.ts` (shared with the live dashboard tip, not duplicated in the triage module). For each candidate playbook it checks the case text against the playbook's aliases and main `case_type`:

- An exact phrase match scores by the matched phrase's length.
- Each individual matching token adds +8.
- A token match against the playbook's own `case_type` (not just an alias) adds +6.
- The best-scoring playbook's raw score is bucketed into a confidence band: `> 24` = high, `> 12` = medium, otherwise low.

`lib/triage/match.ts` is the second, separate layer: pure filtering/ranking logic (no I/O) applied to whatever is already in the pool, driven by each agent's saved preferences. Its `urgencyScore()` computes a deterministic 0–7 score — +3 for a missed SLA, +2 for an active SLA clock, +2 for Intercom's native priority flag, plus up to +2 for wait time (linear up to a 240-minute cap). `filterAndRank()` applies `priorityOnly`, audience, and keyword filters (AND'd together) and then sorts by urgency descending, then longest-waiting, then oldest ticket, as tiebreakers.

## Agent filters (`lib/triage/store.ts`)

Each agent's filter preferences are stored as `agents.triage_prefs` (jsonb): `{ keywords, expand, expandedTerms, expandedFor, audiences, priorityOnly }`. Keywords are capped at 20 entries and matched as case/diacritic-insensitive substrings against subject + snippet + tags; audiences are a fixed set (`creator`, `fan`, `agency`) matched by tag substring. These prefs are applied client-side (well, server-side in the `/api/triage` handler) when rendering the list, so each agent effectively sees their own curated slice of the one shared unassigned pool — the underlying `triage_items` table itself is not filtered per agent.

## Endpoints

- `POST /api/cron/triage-sweep` — runs the sweep (also invocable manually).
- `GET /api/triage` — returns the pool, filtered and ranked by the calling agent's `triage_prefs`.
- `POST /api/triage/prefs` — updates an agent's keyword/audience filters.

## Real-time pool reconcile

Because the sweep only runs every 5 minutes, a conversation that gets claimed or closed in between sweeps would otherwise linger in the pool until the next run. The Intercom webhook handler (`app/api/webhooks/intercom/route.ts`) reads the assignee/state straight off each incoming event and calls `removeTriageItems()` (`lib/triage/store.ts`) immediately whenever a conversation becomes assigned or closed — covering every assignment source, not just the app's own "Assign to me" button. See [[Intercom Integration]] for the full webhook flow.

## UI

The Triage tab lives in the Canvas left sidebar, alongside Inbox and Queue (see [[Canvas Workflow]]). It shows the ranked pool best-match-first, offers one-click "Assign to me" (`app/api/cases/assign/`), and opening a triage item into the Canvas auto-triggers the background draft-generation pipeline described in [[Draft Verify Pipeline]].

## Data flow

```
cron (every 5 min) or manual "Sweep now"
  -> POST /api/cron/triage-sweep
  -> runTriageSweep()
       -> searchOpenConversations({ unassignedOnly: true })   (lib/intercom.ts)
       -> filter to unassigned, score against playbooks       (scorePlaybook, lib/case-intelligence.ts)
       -> compute SLA status / priority / capability gap
       -> replaceTriagePool()  upsert + conditional prune      (lib/triage/store.ts)

agent opens Triage tab
  -> GET /api/triage
       -> listTriageItems()            (raw pool)
       -> getTriagePrefs(agentId)       (agents.triage_prefs)
       -> filterAndRank()               (lib/triage/match.ts)
  -> ranked list rendered, best match first

webhook event (assignment/close) arrives at any time
  -> app/api/webhooks/intercom/route.ts
  -> removeTriageItems([id])   (immediate eviction, independent of the sweep cadence)
```

## Key files

- `lib/triage/sweep.ts` — `runTriageSweep()`, the periodic classify-and-upsert job.
- `lib/case-intelligence.ts` — `scorePlaybook()`, `getTopMatches()`, `getLiveTipForText()` (shared keyword-matching engine).
- `lib/triage/match.ts` — `TriageItem`/`TriagePrefs` types, `normalizeTriagePrefs()`, `matchesKeywords()`, `matchesAudience()`, `urgencyScore()`, `filterAndRank()`.
- `lib/triage/store.ts` — Supabase persistence: `replaceTriagePool()`, `removeTriageItems()`, `listTriageItems()`, `getTriagePrefs()`, `saveTriagePrefs()`, sweep status tracking.
- `app/api/cron/triage-sweep/route.ts` — cron entry point.
- `app/api/triage/route.ts` — list endpoint (applies prefs and ranking).
- `app/api/triage/prefs/route.ts` — update an agent's filter prefs.
- `app/api/webhooks/intercom/route.ts` — real-time pool reconcile on assignment/close events.

## See also

- [[Intercom Integration]] — `searchOpenConversations()` and the webhook that feeds real-time reconcile.
- [[Draft Verify Pipeline]] — triggered when a triage item is opened into the Canvas.
- [[Canvas Workflow]] — the Triage tab's place in the sidebar alongside Inbox and Queue.
- [[Automation Rules Engine]] — a separate trigger system also driven off the same webhook events.
- [[Database Schema Reference]] — `triage_items`, `agents.triage_prefs`.
