---
title: Gmail Integration
tags: [integrations, gmail, email]
updated: 2026-07-29
---

# Gmail Integration

Gmail is wired into Supportcopilot for quick email sending, saved reply templates, and unread-count summaries surfaced on the dashboard. It is a secondary channel next to [[Intercom Integration]] — used when an agent needs to reach a creator or internal contact by email rather than through the support inbox.

## Auth

Gmail access rides on the same Google identity used for [[Auth and Session]] sign-in — this app uses Supabase's built-in Google OAuth provider, so there is no separate "connect Gmail" step for most agents.

- Access token: `agents.google_token`
- Refresh token: `agents.google_refresh_token`
- Refresh flow: `lib/auth.ts::googleFetch()` wraps outgoing Gmail API calls and transparently exchanges the refresh token for a new access token when the current one has expired, persisting the new `google_token` back to Supabase.

Session-sourced tokens are also synced back to the `agents` table in the background whenever they drift from what's stored, so the DB copy stays current for server-side calls that don't have a live session.

## Key files

- `lib/gmail-client.ts` — Gmail API wrapper (list/detail/send/attachments)
- `lib/gmail-filters.ts` — named inbox filters (query strings)
- `lib/gmail-templates-auth.ts` — auth helper for the templates endpoints
- `lib/auth.ts` — `googleFetch()`, token read/refresh/sync
- `app/api/gmail/threads/route.ts` — inbox list
- `app/api/gmail/threads/[id]/route.ts` — thread detail
- `app/api/gmail/threads/batch/route.ts` — batch thread fetch
- `app/api/gmail/send/route.ts` — compose + send
- `app/api/gmail/quick-send/route.ts` — quick reply from the Canvas
- `app/api/gmail/templates/route.ts`, `app/api/gmail/templates/[id]/route.ts` — saved reply templates
- `app/api/gmail/unread/route.ts` — dashboard unread count
- `app/api/gmail/sent/route.ts`, `app/api/gmail/sent/[id]/route.ts` — sent-mail views
- `app/api/gmail/attachments/[messageId]/[attachmentId]/route.ts` — attachment download

## Key functions (`lib/gmail-client.ts`)

- `getGmailUnreadCount()` — powers the dashboard unread-mail card
- `getInboxThreads()` — paginated inbox listing, filterable by label/unread/search query
- `getGmailThread()` — full thread detail: every message in the thread plus attachment metadata
- `sendGmailMessage()` — composes and sends a message (handles `In-Reply-To`/`References` headers for threading)
- `markThreadRead()` — clears the unread label on a thread
- `getAttachmentData()` — downloads a single attachment's binary payload on demand
- `trashThreads()` — moves one or more threads to Trash

## Data model

```typescript
type GmailThreadSummary = {
  id: string
  snippet: string
  subject: string
  from: string
  fromName: string
  date: string
  isUnread: boolean
  messageCount: number
}

type GmailMessage = {
  id: string
  threadId: string
  from: string
  fromName: string
  to: string
  subject: string
  date: string
  messageId: string
  inReplyTo: string | null
  references: string | null
  bodyPlain: string
  bodyHtml: string
  isUnread: boolean
  attachments: GmailAttachment[]
}

type GmailAttachment = {
  filename: string
  mimeType: string
  attachmentId: string
  size: number
  /** Populated only after an explicit download call. */
  data?: string
}
```

`GmailThreadDetail` wraps a thread as `{ id, subject, messages: GmailMessage[] }`, and `GmailInboxResult` is the discriminated `{ connected: true, threads, nextPageToken, resultSizeEstimate } | { connected: false }` shape returned by the listing endpoint so the UI can distinguish "no Gmail connection" from "empty inbox."

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/gmail/threads` | List inbox threads (paginated, filterable) |
| `GET /api/gmail/threads/{id}` | Full thread detail |
| `GET /api/gmail/threads/batch` | Batch-fetch multiple threads |
| `POST /api/gmail/send` | Compose and send a new message |
| `POST /api/gmail/quick-send` | Quick reply triggered from a Canvas card |
| `GET /api/gmail/templates` / `POST /api/gmail/templates` | List / create saved reply templates |
| `GET /api/gmail/unread` | Dashboard unread count |
| `GET /api/gmail/attachments/{messageId}/{attachmentId}` | Download attachment binary |

## Filters (`lib/gmail-filters.ts`)

Named filters map to Gmail search queries: `primary` (`in:inbox category:primary`), `all` (`in:inbox`), `unread` (`is:unread in:inbox`), `starred` (`is:starred in:inbox`), `spam` (`in:spam`), `trash` (`in:trash`). `getFilterQuery(key)` resolves a filter key to its query string, falling back to `primary` for unknown keys.

## Data flow

```
Dashboard card ──▶ GET /api/gmail/unread ──▶ getGmailUnreadCount() ──▶ googleFetch() ──▶ Gmail API
                                                                              │
                                                             refresh access token if expired
                                                                              │
                                                                agents.google_token (sync)

Inbox view ──▶ GET /api/gmail/threads?filter=... ──▶ getInboxThreads() ──▶ Gmail API (list + filter query)
Thread open ──▶ GET /api/gmail/threads/{id} ──▶ getGmailThread() ──▶ Gmail API (full message payloads)
Compose/reply ──▶ POST /api/gmail/send | quick-send ──▶ sendGmailMessage() ──▶ Gmail API (send)
```

## Related

See [[Auth and Session]] for the Supabase/Google OAuth session model shared with Gmail, [[Canvas Workflow]] for where quick-send is triggered from, and [[Intercom Integration]] for the primary customer-facing channel this integration complements.
