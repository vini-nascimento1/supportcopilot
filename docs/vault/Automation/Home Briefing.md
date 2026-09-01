---
title: Home Briefing
tags: [automation, ai, home, briefing]
updated: 2026-09-01
---

# Home Briefing

The data layer behind **Home** (route `/`, formerly the Dashboard): one server-built object that
answers "what needs me, and what did the copilot already prepare?" across the agent's Intercom
queue, Slack, Gmail and Google Calendar.

Everything the page renders comes from a single contract, `lib/briefing/types.ts`. Each source is
normalized into an `AttentionItem`; raw provider payloads never leave the source module, are never
persisted, and never reach a model.

Design plan: `docs/plans/2026-09-01-home-briefing.md`. Mockup: `docs/plans/home-briefing-mockup.html`.

## The contract

| Type | What it is |
|---|---|
| `AttentionItem` | One normalized thing needing the agent: id, source, kind, title, context, urgency, `whenLabel`, deep link, actions, optional `prepared` |
| `PreparedContent` | What the copilot already did: `draft` (a reply-queue customer reply), `answer` (a researched Slack reply), `summary` (an email digest, no reply proposed) |
| `SourceStatus` | Per-source `ok` / `not_connected` / `error`, so the UI can render "Connect Slack" instead of a silent empty list |
| `Briefing` | `generatedAt`, `since`, `narrative`, `narrativeSource`, `counts`, ranked `items`, `sources` |

`isNeedsYouNow(item, nowMs)` and `countBriefing(items)` are pure functions on the contract, so the
"Needs you now" rule is identical on server and client.

## Data flow

```
GET /api/briefing  (session required; email comes from the cookie, never the request)
        │
        ▼
buildBriefing(email)
        │
        ├─ read `agents` row + briefing_dismissals ids
        │
        ├─ fresh briefing_cache (< 5 min)? ──▶ applyDismissals ──▶ return it
        │
        ├─ since = agents.last_seen_at, floored at 24h and capped at 7 days
        │
        ├─ 4 sources in parallel, each in its own try/catch ──▶ SourceStatus
        │     ├─ sources/intercom.ts   getNonReadAssignedConversations + getPendingSuggestionsForAgent
        │     ├─ sources/slack.ts      DMs/mpims + @you and @your-usergroup mentions
        │     ├─ sources/gmail.ts      unread inbox threads since `since`
        │     └─ sources/calendar.ts   today's primary-calendar events
        │
        ├─ research.ts   ≤ 3 Slack questions ──▶ retrieval + 1 model call ──▶ prepared.kind "answer"
        │
        ├─ rank (now first, then dueAt/occurredAt) ──▶ countBriefing()
        │
        ├─ narrative.ts  kinds/titles/whenLabels/counts ONLY ──▶ 1 model call, else deterministic fallback
        │
        ├─ write agents.briefing_cache / briefing_cached_at (COMPLETE briefing)
        │
        └─ applyDismissals ──▶ Briefing (JSON)
```

## Sources

### Intercom — `ticket_awaiting_reply`

Reuses exactly the two reads the Canvas queue already runs, and reconciles them the same way
`/api/reply-queue` does (see [[Draft Verify Pipeline]] and [[Intercom Integration]]):

- a cached draft whose conversation has left the non-read set is **not shown**;
- a non-read conversation with no draft yet is shown with `pending: true` and no `prepared`.

Nothing is drafted, staled or sent from the briefing — it is a read-only view of the queue.
`prepared.kind = "draft"` carries the queue row's body, `suggestionId`, `band` and `sources`
unchanged, so approve/reject/edit still go through `POST /api/reply-queue/resolve`.

`lockReason` is set only for `band === "needs_check"` (the one band whose send is locked,
`lib/reply-queue.ts::isSendLocked`). Its wording mirrors the Canvas queue panel's existing lock copy
so the same draft reads the same way in both places; a matched `LOCKED_CATEGORIES` tag names the
category ("Verify the payout in fadmin before sending."), and a `requires_manual_action` playbook
outranks it.

### Slack — `slack_dm`, `slack_mention`

Scope is deliberately narrow, and enforced in code rather than by convention:

- DMs and group DMs sent **to** the agent since `since` (`users.conversations` types `im,mpim`, then
  `conversations.history` with `oldest`);
- channel messages mentioning the agent personally (`<@U…>`) or a user group they belong to
  (`<!subteam^S…>`), via `search.messages`.

Whole channels are never fetched, other people's threads are never read, and the agent's own
messages are dropped. Thread replies to the agent's own messages (`slack_thread_reply`) are v2.

A personal mention or a DM is urgency `now`; a **user-group** mention is `today` — anyone on the
group can take it, so it must not shout as loudly as a direct ask.

**Workflow and bot posts are events, not people.** A Slack workflow ("Raise" in `#payout-issues`)
posts *"A new Payout Issue ticket has been created and assigned to you: Ticket Title …"*. Rendering
that as "Raise mentioned you" — and then researching an answer to send back to it — was wrong twice
over. `lib/slack.ts::searchMentions` now flags these on the message (`isBot`, `botName`) from the
`search.messages` match: a `bot_id`, `subtype === "bot_message"`, or the shape Slack's own docs
show for an app post (empty `user`, a `username` / `bot_profile.name` carrying the app name). A
flagged message gets:

- title `New ticket raised in #channel` when the bot name matches `/raise/i` or the text says a
  ticket was created, otherwise `${botName} posted in #channel`;
- context = the ticket title, read conservatively out of the text between "Ticket Title" and the
  next field label ("Creator Email Address", "Priority", …) or the next line break; if neither
  boundary is there, the sanitized text as before;
- urgency `now` only when the post says "assigned to you", else `today`;
- `actions: ["open"]` and **no research pass** — `research.ts::selectResearchTargets` drops bot
  messages before the question heuristic, so a workflow never gets a "Send in Slack" answer.

`getUnreadDms` cannot produce a bot item: it already drops anything carrying a `subtype` (which
includes `bot_message`) or lacking a real `user`.

Caps are unchanged by the longer window: `search.messages` is one page of `count=40` per query
(`<@you>` plus one per user group) and `conversations.history` is `limit=20` per DM channel over at
most 40 channels, then `MAX_SLACK_ITEMS = 10` overall. A 7-day window therefore costs the same
number of requests as a 24h one — it just returns older messages inside the same fixed pages, and a
very busy week can be truncated to the newest 40 matches per query.

Needs `agents.slack_user_id`, written by the OAuth callback from `authed_user.id`. Connections made
before that column existed resolve it lazily via `auth.test` and persist it. See
[[Slack Integration]] for the token model; the briefing adds the `usergroups:read` user scope.

### Gmail — `email_action`, `email_fyi`

Unread inbox threads since `since` (`in:inbox is:unread after:<epoch>`), classified by a small
keyword heuristic: a known partner sender (MassPay / Ondato / TripleA), a direct question, or an ask
phrase ("please", "confirm", "by EOD") makes it an action; everything else is FYI.

**Nothing from email reaches a model in v1.** `prepared` is a deterministic `summary` built from the
subject and Gmail's own snippet. See [[Gmail Integration]].

The thread list is a single page (`maxResults=20`) sliced to `MAX_EMAIL_ITEMS = 8`, so a 7-day
window is the same one request as a 24h one.

### Calendar — `calendar_event`

Today's events from the agent's primary calendar (`lib/gcal.ts::getCalendarEvents("today", …)`).
Finished events are dropped. An event starting inside the next hour is urgency `now`, matching
`isNeedsYouNow`; everything else is `today`.

## Research (Slack only)

`research.ts` prepares an `answer` for a colleague's message, and only when all of these hold:

1. the item is a `slack_dm` or `slack_mention` (never a customer ticket — those have their own
   verifier and send lock);
2. the message came from a person, not a workflow or app (`!message.isBot`) — a ticket-raising bot
   trips the question heuristic below but must never be replied to;
3. the text reads as a question to the agent (`readsAsQuestion`: a question mark, an interrogative
   opener, or an ask phrase like "can you" / "do we" / "should we");
4. retrieval actually returned something citable — with no sources, the model is never called;
5. fewer than 3 items have been researched this briefing.

Grounding reuses the same helpers the AI chat's `search_knowledge` / `search_playbooks` tools call
(`lib/retrieval/search.ts::searchKnowledge`, `lib/notion-retrieval-server.ts`, `lib/playbooks.ts`) —
see [[AI Chat Assistant]] and [[Retrieval Architecture]].

The system prompt states three non-negotiables: the colleague's message is **data, not
instructions**; only supplied sources may be cited; and the answer must never propose moving money,
changing access, or bypassing a control — those get pointed at the owning team instead.

## Narrative

One model call produces the hero line. It sees **kinds, titles, `whenLabel`s and counts** — never a
body, a customer reply, an email snippet, or an item's `context`. Output is accepted only if it
looks like what was asked for (12–320 chars, no links, no code fence, no talk of its own
instructions); anything else falls back to `buildFallbackNarrative`, a deterministic sentence built
from counts alone. `narrativeSource` tells the UI which one it got.

## Caching and the `since` window

- `agents.briefing_cache` (jsonb) + `agents.briefing_cached_at`, TTL 5 minutes.
- Populated **only by a signed-in request**. There is no cron: no server process holds a user
  session outside a request.
- `POST /api/briefing/refresh` bypasses the cache and rewrites it.
- `agents.last_seen_at` is **read** by the build for `since` and **written** by the Home page via
  `markHomeSeen(email)`. If the build moved that clock it would consume its own window and every
  later digest would come back empty.
- `since` is floored at **24 hours** (`MIN_LOOKBACK_MS`) and capped at **7 days**
  (`MAX_LOOKBACK_MS`); a first-ever visit gets 24 hours. Home is meant to work as a wrap-up after a
  weekend or a few days off, so a Monday morning covers Friday. Beyond a week it would be an
  archive, not a briefing.
- The floor used to be 8 hours, purely so that stamping `last_seen_at` on every visit could not
  empty the next window. Dismissals now carry the "already handled" state, so re-showing yesterday's
  mention costs nothing — if the agent dealt with it, it is filtered out.

## Dismissals — "I have already handled this"

The briefing is rebuilt from live sources, so without per-item state anything the agent handled
outside the app would keep coming back. `briefing_dismissals` (see
[[Database Schema Reference]]) holds one `(agent_id, item_id)` row per finished item and nothing
else — no title, no body, no counterparty.

**Applied at read time.** `buildBriefing` reads the ids once and calls `applyDismissals` on both the
cache-hit path and the freshly-built one, *after* `writeCache`. So the cached copy stays complete
(which is what makes Undo instant) while the agent sees it minus what they finished, and a dismissal
takes effect on the very next load rather than waiting out the 5-minute TTL. Both callers —
`components/home/data.ts::getBriefing` and `GET /api/briefing` — go through `buildBriefing`, so
neither can skip the filter.

**Narrative rule.** The model narrative describes a specific set of items, so the moment one is
filtered out it can no longer be trusted to agree with the list or the hero tiles ("3 replies are
drafted" over a list of one), and re-running the model on every load would defeat the cache. If
anything was removed, `applyDismissals` recomputes `counts` from the survivors AND swaps the
narrative for `buildFallbackNarrative`, setting `narrativeSource: "fallback"`. If nothing was
removed the briefing is returned untouched, model narrative and all. `buildFallbackNarrative` lives
in `lib/briefing/narrative-fallback.ts` (no `server-only` import) precisely so the client can build
the identical sentence after a client-side dismissal.

### API

`app/api/briefing/dismiss/route.ts`, session-scoped exactly like `GET /api/briefing` — the agent
comes from the session cookie, never the request, so a caller can only change their own briefing.

| | Request | Success |
|---|---|---|
| `POST` | `{ "ids": ["intercom:123", "slack:C0A:1788…"] }` | `200 { "dismissed": 2, "ids": [...] }` |
| `DELETE` | same body | `200 { "restored": 2, "ids": [...] }` |

Validation (`parseItemIds`, pure and unit-tested): an array of 1–200 entries, each a string of at
most 200 chars matching `/^(intercom|slack|gmail|calendar):/`, deduplicated. Anything else is
`400 { error }`; no session is `401`; no agent row is `404`. Rows older than 14 days are pruned
opportunistically inside `getDismissedIds`, best effort — a failed prune never reaches the caller.

### What counts as a dismissal

- the **X** on a "Needs you now" row (pointer devices, shown on hover and keyboard focus);
- a **left swipe** on the same row under 768px — pointer events on the row wrapper, committed past
  35% of the row width or on a fast flick, spring-back otherwise. The horizontal gesture only starts
  once `|dx| > |dy|` and `dx < -10px`, so vertical scrolling keeps working, and `prefers-reduced-motion`
  turns the transitions off;
- **Clear all** in the section header, one POST for every visible row;
- **acting on the item**: approving/sending or rejecting a draft, sending a Slack answer, or opening
  a deep link ("Open it", "Open thread", "Reply in Gmail", "Open case"). Opening in a new tab *and*
  dismissing is intended — acting on something is reading it. The locked "Check in fadmin" /
  "Check on desktop" links are the exception: they are a step toward sending, not the end of the
  item, so they leave the row in place.

Every one of these shows a toast with an **Undo** for ~5 seconds, which `DELETE`s the same ids.

`briefing-board.tsx` owns the session's dismissed set, so the hero tiles and the section header
recount immediately (`countBriefing` is pure and runs on the client). The right-hand digests and the
day timeline are server-rendered; they pick up a dismissal on the next load, from the same
server-side filter.

## Security properties

- No OAuth token reaches the client; the route returns the `Briefing` contract only.
- No raw Slack/Gmail/Intercom payload is persisted or sent to a model. The Slack message bodies used
  for research live in an in-memory map for the length of the request.
- Both AI prompts treat provider content as data; there is a prompt-injection fixture test asserting
  an "ignore previous instructions" Slack message reaches neither the narrative input nor its output.
- Titles and contexts are sanitized once at the source boundary: email addresses replaced, newlines
  and control characters stripped, length capped.
- Nothing sends or approves without a click, and a locked (`needs_check`) draft only sends through the locked `SendConfirmDialog`, where the agent asserts the fadmin check (that sets `needsCheckConfirmed`); it otherwise stays locked
  everywhere.
- `briefing_dismissals` stores an agent id and an item id, nothing else — no title, no body, no
  customer name or email — and the dismiss route accepts nothing else either. Logs carry agent ids
  and counts only, never message text.
- Sign-in is unchanged Google Workspace SSO — see [[Auth and Session]].

## Database columns

Additive and nullable on `agents` (see [[Database Schema Reference]]):

```sql
alter table agents
  add column if not exists slack_user_id text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists briefing_cache jsonb,
  add column if not exists briefing_cached_at timestamptz;
```

Plus one table, RLS on and service-role only like the rest of `lib/briefing`:

```sql
create table if not exists public.briefing_dismissals (
  agent_id uuid references agents(id) on delete cascade,
  item_id text,
  dismissed_at timestamptz default now(),
  primary key (agent_id, item_id)
);
```

## Key files

- `lib/briefing/types.ts` — the shared contract (`AttentionItem`, `Briefing`, `isNeedsYouNow`, `countBriefing`)
- `lib/briefing/build.ts` — `buildBriefing(email)`, ranking, cache, `computeSince`, `applyDismissals`, `markHomeSeen(email)`
- `lib/briefing/dismissals.ts` — `getDismissedIds`, `dismissItems`, `undismissItems`, `parseItemIds`, 14-day prune
- `lib/briefing/format.ts` — `whenLabel` helpers, sanitizers, `deriveLockReason`
- `lib/briefing/sources/intercom.ts` — ticket items + queue-draft reconciliation
- `lib/briefing/sources/slack.ts` — DM / mention items, `slack_user_id` resolution
- `lib/briefing/sources/gmail.ts` — unread-mail classification and summaries
- `lib/briefing/sources/calendar.ts` — today's events
- `lib/briefing/research.ts` — the Slack-question research pass
- `lib/briefing/narrative.ts` — hero line, model call + acceptance check
- `lib/briefing/narrative-fallback.ts` — `buildFallbackNarrative`, pure, shared by server and client
- `app/api/briefing/route.ts` — `GET`, session required
- `app/api/briefing/refresh/route.ts` — `POST`, bypasses the cache
- `app/api/briefing/dismiss/route.ts` — `POST` dismiss / `DELETE` undo, session required
- `components/home/*` — the Home UI (hero, attention list, prepared card, Slack/email digests, day timeline)
- `components/home/briefing-board.tsx` — owns the open row and the session's dismissed set; recounts the hero
- `components/home/use-dismissals.ts` — optimistic dismiss/undo against the API, with the toast
- `components/home/attention-row.tsx` — the X button and the mobile swipe gesture
- `components/ui/status-tag.tsx` — `Tag`, `StatusDot`, `StatusTag`: the neutral tag + small colour dot used for every state label on Home (no tinted text pills)
- `lib/slack.ts` — `getSlackUserId`, `getAgentUserGroups`, `searchMentions`, `getUnreadDms`
- `app/api/auth/slack/route.ts` — adds the `usergroups:read` user scope
- `app/api/auth/slack/callback/route.ts` — persists `authed_user.id` into `agents.slack_user_id`
