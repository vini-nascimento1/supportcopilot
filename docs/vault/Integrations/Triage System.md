---
title: Triage System
tags: [triage, intercom, automation]
updated: 2026-09-12
---

The Triage System periodically sweeps Intercom's open-and-unassigned conversations into a ranked pool, so agents aren't limited to working only what's directly assigned to them. Each agent can filter the shared pool by keyword, audience and Intercom tag (including a hard "never show me these tags" exclusion) and claim ("Assign to me") whatever best matches their own strengths, rather than waiting for a manual assignment.

It is deliberately LLM-free: classification reuses the same keyword playbook matcher the live dashboard tip uses (`getTopMatches()` in `lib/case-intelligence.ts`), never a model gate/generation call, so a cron running every few minutes can't burn LLM budget. The sweep only reads Intercom and writes to the app's own `triage_items` table — it never sends, assigns, or otherwise writes back to Intercom itself.

## The sweep (`lib/triage/sweep.ts`)

`runTriageSweep()` runs every 5 minutes via `POST /api/cron/triage-sweep`, and can also be triggered manually ("Sweep now" in the Triage panel). For each run:

> [!warning] The scheduled half of this only started working on 2026-08-12.
> `proxy.ts` allowlisted machine routes by exact path and `/api/cron/triage-sweep` was never on the list, so every pg_cron run was redirected to `/login` before reaching the handler. Both layers reported success (pg_cron logs the queued request; pg_net logs a 200 for the login page HTML), so `triage_items` sat empty and the pool only ever filled when somebody pressed "Sweep now". Fixed by matching `/api/cron/` as a prefix — see INC-002 in `INCIDENTS.md`.

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

`lib/triage/match.ts` is the second, separate layer: pure filtering/ranking logic (no I/O) applied to whatever is already in the pool, driven by each agent's saved preferences. Its `urgencyScore()` computes a deterministic 0–7 score — +3 for a missed SLA, +2 for an active SLA clock, +2 for Intercom's native priority flag, plus up to +2 for wait time (linear up to a 240-minute cap). `filterAndRank()` applies the tag include/exclude filter, `priorityOnly`, audience, and keyword filters (AND'd together) and then sorts by urgency descending, then longest-waiting, then oldest ticket, as tiebreakers.

## Agent filters (`lib/triage/store.ts`)

Each agent's filter preferences are stored as `agents.triage_prefs` (jsonb): `{ keywords, expand, expandedTerms, expandedFor, audiences, priorityOnly, tags, excludeTags }`. Keywords are capped at 20 entries and matched as case/diacritic-insensitive substrings against subject + snippet + tags; audiences are a fixed set (`creator`, `fan`, `agency`) matched by tag substring. These prefs are applied client-side (well, server-side in the `/api/triage` handler) when rendering the list, so each agent effectively sees their own curated slice of the one shared unassigned pool — the underlying `triage_items` table itself is not filtered per agent.

### Tag filters (`tags` / `excludeTags`)

Keyword matching reads ticket *text*, which drifts — a Fin-handled or oddly-phrased ticket slips through, which is why "filter by keyword" was never a reliable way to avoid a whole category of work. Intercom's own tags don't drift, so `matchesTagFilters()` is an exact filter on top:

- `tags` — an OR include list. Non-empty means only tickets carrying at least one of them show; an untagged ticket drops out.
- `excludeTags` — a never-show list. **Exclusion wins over inclusion and over every other filter**: a ticket tagged both `AGENCY_TAG` and `PAYOUTS_TAG` stays hidden under an `AGENCY_TAG` exclusion even while `PAYOUTS_TAG` is included. This is the "never give me agency tickets" switch, and a half-agency ticket is still an agency ticket.

Both lists store *comparison keys* (`tagFilterKey()` — trimmed, lowercased, accent-stripped), not raw tag names, so a saved filter survives the workspace re-casing or renaming a tag. Matching is exact on that key, never substring: a filter on `fan` must not swallow a hypothetical `FANVUE_STAFF`.

The chips themselves are built from live data, not a hardcoded vocabulary: `collectTagFacets()` returns every tag present in the pool with a per-conversation count (most common first), `GET /api/triage` returns it as `tagFacets`, and the panel renders one tri-state chip per tag — click cycles **keep → hide → off**. Facets are computed over the *whole* pool rather than the filtered result, so the chip list doesn't reshuffle while the agent narrows things down and a tag you just excluded stays visible to be un-excluded. A filter whose tag has temporarily left the pool is re-added as a count-0 chip for the same reason. Active tag filters also render outside the popover, above the keyword chips — a filter that silently hides tickets is one you forget you set.

## Endpoints

- `POST /api/cron/triage-sweep` — runs the sweep (also invocable manually).
- `GET /api/triage` — returns the pool, filtered and ranked by the calling agent's `triage_prefs`, plus `tagFacets` (the pool's live tag vocabulary with counts).
- `POST /api/triage/prefs` — updates an agent's keyword/audience/tag filters.

## Real-time pool reconcile

Because the sweep only runs every 5 minutes, a conversation that gets claimed or closed in between sweeps would otherwise linger in the pool until the next run. The Intercom webhook handler (`app/api/webhooks/intercom/route.ts`) reads the assignee/state straight off each incoming event and calls `removeTriageItems()` (`lib/triage/store.ts`) immediately whenever a conversation becomes assigned or closed — covering every assignment source, not just the app's own "Assign to me" button. See [[Intercom Integration]] for the full webhook flow.

## UI

The Triage tab lives in the Canvas left sidebar, alongside Inbox and Queue (see [[Canvas Workflow]]). It shows the ranked pool best-match-first, offers one-click "Assign to me" (`POST /api/reply-queue/assign`) and a multi-select "Assign N + draft" (`POST /api/reply-queue/assign-bulk`) for claiming several rows at once, and opening a triage item into the Canvas auto-triggers the background draft-generation pipeline described in [[Draft Verify Pipeline]].

Assigning used to be able to fail silently on the drafting half: the toast claimed a reply was being generated even when it wasn't, and nothing recorded why. Since 2026-08-12, a failed or killed draft attempt is recorded (`reply_queue_attempts.outcome`/`reason`) and picked back up by a periodic recovery sweep (`app/api/cron/draft-recovery/route.ts`) instead of vanishing — see [[Draft Verify Pipeline]] for the full mechanism. The single-row "Assign to me" toast now reflects the real outcome; the bulk "Assign N + draft" action still reports assignment counts only and relies on the recovery sweep for any draft that fails in the background.

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
- `lib/triage/match.ts` — `TriageItem`/`TriagePrefs` types, `normalizeTriagePrefs()`, `matchesKeywords()`, `matchesAudience()`, `matchesTagFilters()`, `tagFilterKey()`, `collectTagFacets()`, `urgencyScore()`, `filterAndRank()`.
- `lib/conversation-tags.ts` + `components/canvas/conversation-tags.tsx` — the shared tag badge (label, colour family, display order) used by both the Triage and Inbox rows; see [[Canvas Workflow]].
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
