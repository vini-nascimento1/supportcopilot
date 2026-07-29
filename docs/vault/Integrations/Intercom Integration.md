---
title: Intercom Integration
tags: [integration, intercom, api]
updated: 2026-07-29
---

Intercom is the data source the whole app is built around. It supplies live conversations, assignee and queue state, and Help Center content, and it is the only channel the app writes replies back through. Almost every other subsystem — [[Triage System]], the reply queue behind [[Draft Verify Pipeline]], [[Canvas Workflow]], and [[Automation Rules Engine]] — ultimately reads from or writes to Intercom via the helpers in `lib/intercom.ts`.

## Configuration

- `INTERCOM_ACCESS_TOKEN` — the private app token used for every Intercom API call.
- `INTERCOM_ADMIN_ID` — the default admin/assignee ID used when scoping "my queue" calls. Individual agents can override this per-row via `agents.intercom_admin_id` (see [[Database Schema Reference]] and [[Auth and Session]]), resolved at request time by `resolveIntercomAdminId()`.
- `INTERCOM_APP_ID` — used client-side only, to build direct `https://app.intercom.com/a/inbox/{appId}/inbox/conversation/{id}` links from a card back to the real Intercom inbox.
- `INTERCOM_CLIENT_SECRET` — the app's client secret, used to verify inbound webhook signatures.

The private-app tier caps out around 1,000 requests/minute. Every outbound call goes through a small `fetchIntercom()` wrapper in `lib/intercom.ts` that applies a default 15s timeout (configurable per call) via an `AbortController`, so a stalled Intercom response can never hang a request handler indefinitely. List/search endpoints paginate with Intercom's cursor (`starting_after`) at 150 rows/page, and every pagination loop is capped (typically 40 pages) as a backstop against an abnormally large queue turning one poll into an unbounded chain of sequential calls.

## Key functions (`lib/intercom.ts`)

- `searchConversations()` / `searchOpenConversations()` — POST `/conversations/search` with an `AND` filter (state, `admin_assignee_id`, tags), cursor-paginated. Returns both the rows and a `complete` flag so callers (notably the triage sweep) know whether the page cap was hit and the result is a partial snapshot.
- `getConversationDetail()` — GET `/conversations/{id}`, returning the full thread (opening message from `source` plus every non-`note` conversation part), attachments, tags, topic, and the normalized `admin_assignee_id`.
- `getOpenCasesQueue()` — the agent's assigned, open conversations, shaped for the dashboard/Inbox cards (customer label, snippet, live playbook tip, SLA timestamps).
- `getNonReadAssignedConversations()` — conversations assigned to an agent where `waiting_since` is set (i.e. still waiting on us). This is the live source of truth feeding the autonomous reply queue.
- `listIntercomAdmins()` — GET `/admins`, used to populate assignment dropdowns.
- `searchArticles()` — POST `/articles/search`, used to pull Help Center snippets in as draft-generation context.
- `closeConversation()`, `assignConversationToAdmin()`, `unassignConversation()` — real writes (`POST /conversations/{id}/parts`), only ever invoked behind an explicit human click.
- `listIntercomMacros()` — fetches canned/saved replies; Intercom only serves macros under the `"Unstable"` API version (2.11 rejects the call), so this is the one place that pins a different `Intercom-Version` header.
- `searchMetricsForAdmin()` — aggregates FRT/resolution/CSAT KPIs for the Metrics tab, splitting wide date ranges into parallel sub-windows since Intercom's cursor pagination can't otherwise be parallelized.

### Conversation detail shape

```typescript
type ConversationDetail = {
  id: string
  subject: string | null
  snippet: string
  customer: string | null
  email: string | null
  firstMessage: string
  messages: ConversationMessage[]
  tags: string[]
  state: "open" | "closed" | "snoozed" | null
  lastAuthorType: string | null // "user" | "admin" | "bot"
  adminAssigneeId: string | null
  waitingSince: string | null // ISO timestamp when we stopped replying
  statistics: { lastAdminReplyAt: number | null } | null
}
```

`waitingSince` and `statistics.lastAdminReplyAt` are the two SLA clock inputs: `waitingSince` marks when the conversation last became "waiting on us" (the customer replied and no agent has yet), and Intercom's own `last_admin_reply_at` gives the baseline for measuring customer silence. Together they drive the FRT (First Response Time) SLA color-coding on Inbox cards — see [[Canvas Workflow]].

## Webhook integration

`POST /api/webhooks/intercom` is the real-time entry point. Subscribed topics include `conversation.created`, `conversation.user.created`, `conversation.user.replied`, `conversation.admin.replied`, `conversation.admin.assigned`, and `conversation.closed`. Requests are authenticated via HMAC signature verification against `INTERCOM_CLIENT_SECRET` (no user session involved) — the signature check is why `/api/webhooks/*` is exempted from normal auth middleware.

The handler always returns `200 OK`, even when an internal step throws. Intercom retries on any non-2xx response, so swallowing internal errors here (while still logging them) prevents a retry storm from re-triggering the same automation or draft generation repeatedly.

## Data flow

```
Intercom event
  -> POST /api/webhooks/intercom
  -> verify HMAC signature (INTERCOM_CLIENT_SECRET)
  -> parse payload
  -> runTriggerForEvent()            (see Automation Rules Engine)
  -> reconcile triage pool           (remove conversation if just assigned/closed)
  -> respond 200 OK
  -> after() [non-blocking, post-response]:
       runReplyQueuePipeline()       (see Draft Verify Pipeline)
```

Sending a reply is agent-initiated rather than webhook-driven: the Canvas compose flow calls `POST /api/draft/send`, which resolves the signed-in agent's Intercom admin ID, builds the reply payload (HTML body plus any attachments), and sends it via `POST /conversations/{id}/parts`. Separately, when a draft originated from the autonomous reply queue, `POST /api/reply-queue/resolve` records the agent's approve/edit/reject decision into `reply_queue_events`, including a `body_changed` flag derived by comparing the sent text against the original AI draft — this is what lets the [[Draft Verify Pipeline]] and Metrics tab measure how often agents edit AI drafts before sending.

## Key files

- `lib/intercom.ts` — all Intercom API access: search, conversation detail, admins, articles, macros, metrics, and the write helpers (close/assign/unassign).
- `app/api/webhooks/intercom/route.ts` — webhook entry point, signature verification, trigger dispatch, triage reconcile, background reply-queue pipeline kickoff.
- `app/api/draft/send/route.ts` — sends a reply to Intercom on an agent's behalf.
- `app/api/draft/send/intercom-reply.ts`, `app/api/draft/send/payload.ts` — reply payload construction and the actual `sendIntercomReply()` call.
- `app/api/reply-queue/resolve/route.ts` — records approve/edit/reject decisions on autonomous drafts.
- `lib/reply-queue-store.ts` — `logReplyQueueEvent()` and the `body_changed` derivation.
- `lib/auth.ts` — `resolveIntercomAdminId()`, the per-agent admin ID override lookup.
- `docs/intercom-admins.md` — the current Intercom admin-ID roster (Fanvue support agents' admin IDs, names, emails) and ticket-close-count query recipes. Not duplicated here since it's internal staff data.

## See also

- [[Triage System]] — sweeps Intercom's unassigned pool using `searchOpenConversations()`.
- [[Draft Verify Pipeline]] — consumes conversation detail and generates drafts in response to webhook events.
- [[Automation Rules Engine]] — `runTriggerForEvent()`, triggered directly off the webhook payload.
- [[Canvas Workflow]] — the UI surface for Inbox/Queue cards built on this data.
- [[Database Schema Reference]] — `suggested_replies`, `reply_queue_events`, `agents.intercom_admin_id`.
