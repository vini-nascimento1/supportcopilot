---
title: Slack Integration
tags: [integrations, slack, notifications]
updated: 2026-07-29
---

# Slack Integration

Slack is the internal side channel: it surfaces agent notifications, lets an agent read the team's support channels from inside Supportcopilot, and lets the [[Automation Rules Engine]] cross-post case updates. It is never the customer-facing channel — that's always [[Intercom Integration]].

## Auth

Two token sources, tried in order at call time:

1. A per-agent OAuth user token, `agents.slack_token`, connected from the Settings page (see [[Settings and Profile]]) via `/api/auth/slack` → Slack OAuth consent → `/api/auth/slack/callback`.
2. `SLACK_BOT_TOKEN` env var — a shared dev/workspace bot token used as a fallback when an agent hasn't connected their own token.

The OAuth consent screen (`app/api/auth/slack/route.ts`) requests user-token scopes: `channels:read`, `channels:history`, `groups:read`, `groups:history`, `im:read`, `im:history`, `im:write`, `mpim:read`, `mpim:history`, `chat:write`, `reactions:read`, `reactions:write`, `users:read`, `users:read.email`, `search:read`. The minimum set actually exercised by the core read/write paths is `channels:history`, `channels:read`, `users:read`, and `chat:write`.

## Config

Which channels count as "support channels" (used for the dashboard feed and unread counts) is resolved from either:

- `SLACK_SUPPORT_CHANNEL_IDS` — comma-separated channel IDs, env var, OR
- a `slack_channels` row in the `settings` table (see [[Database Schema Reference]])

## Key files

- `lib/slack.ts` — Slack Web API wrapper (activity, feed, threads, conversations, send)
- `lib/slack-utils.ts` — shared formatting/parsing helpers
- `lib/use-slack-emoji.ts` — client hook for emoji picker/reactions
- `app/api/auth/slack/route.ts`, `app/api/auth/slack/callback/route.ts` — OAuth connect flow
- `app/api/slack/feed/route.ts` — recent messages in support channels
- `app/api/slack/send/route.ts` — post a message
- `app/api/slack/reactions/route.ts` — fetch/add reactions
- `app/api/slack/conversations/route.ts` — channels the agent can access
- `app/api/slack/thread/route.ts`, `app/api/slack/case-threads/route.ts` — thread replies / case-linked threads
- `app/api/slack/search/route.ts` — workspace message search
- `app/api/slack/emoji/route.ts` — emoji list for reactions
- `lib/automation/actions.ts` — how automation actions resolve which Slack token to send with

## Key functions (`lib/slack.ts`)

- `getSlackActivity()` — recent-activity summary per channel
- `getSlackFeed()` — recent messages across configured support channels, used by the dashboard feed
- `getSlackUnreadSummary()` — dashboard unread-count card
- `getThreadReplies()` — replies within a message thread
- `getUserConversations()` / `getConversationMessages()` — channels the agent can see and their message history
- `sendSlackMessage()` — post a message to a channel or thread
- `countUnreadConversations()` — pure helper that tallies unread conversations from a conversation list

Every one of these accepts an optional `agentSlackToken` and falls back to `process.env.SLACK_BOT_TOKEN` when it's not supplied, per the auth order above.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/slack/feed` | Recent messages in support channels |
| `POST /api/slack/send` | Post a message — used as an [[Automation Rules Engine]] action |
| `GET /api/slack/reactions` / `POST /api/slack/reactions` | Fetch / add reactions (used for audit trails) |
| `GET /api/slack/conversations` | Channels the agent can access |
| `GET /api/slack/thread` / `GET /api/slack/case-threads` | Thread replies / threads linked to a case |
| `GET /api/slack/search` | Workspace-wide message search (`search.messages`) |
| `GET /api/slack/emoji` | Emoji catalog for the reaction picker |

## Known limitations

- No file uploads — the required scope isn't granted.
- Read-only on message history — no editing or deleting existing Slack messages.
- Notifications only ever reach the agent, never the customer. Slack is strictly internal; any customer-facing reply goes through [[Intercom Integration]].

## Data flow

```
Dashboard feed ──▶ GET /api/slack/feed ──▶ getSlackFeed() ──▶ Slack conversations.history (per configured channel)
Automation action ──▶ lib/automation/actions.ts ──▶ resolves agent.slack_token or SLACK_BOT_TOKEN ──▶ sendSlackMessage() ──▶ chat.postMessage
Workspace search ──▶ GET /api/slack/search ──▶ Slack search.messages (direct call, bearer = agent's slack_token)
```

## Related

See [[Settings and Profile]] for where an agent connects their own Slack token, [[Automation Rules Engine]] for Slack-post actions triggered by rules, and [[Notifications]] for how Slack activity feeds into the in-app notification surface.
