---
title: Settings and Profile
tags: [settings, profile, integrations, ai]
updated: 2026-07-29
---

# Settings and Profile

The Settings page is where an individual agent customizes their own experience: profile basics, AI behavior (personal key, reply tone, canvas display), Canvas tool cards, and their personal integrations (Slack, Notion, Google). Almost everything here is scoped **per agent**, not workspace-wide — two agents signed in at the same time see different tokens, different tone presets, different personal keys.

> **Note:** this page's layout is being actively reworked as of 2026-07-29 (a separate change is moving it from a single column toward a responsive multi-column grid). As of this writing `app/settings/page.tsx` renders its cards inside a `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3` container, with individual cards spanning 1, 2, or all columns depending on how much horizontal room their content needs (e.g. the Canvas tools table spans 2 columns, the integrations list spans full width). Treat the exact column-span assignments as subject to change — the important structural fact is that Settings is a grid of independent, self-contained cards, not a single stacked form.

## Route and data loading

`app/settings/page.tsx` is a server component. On each request it loads:

- The signed-in agent's email via `getSignedInEmail()` (see [[Auth and Session]]).
- The agent's row from Supabase, selecting exactly: `id, name, email, timezone, intercom_admin_id, slack_token, notion_token, notion_mcp_refresh_token, notion_mcp_refresh_expires_at, working_days`. This is a subset of the full `agents` table — see [[Database Schema Reference]] for every column.
- All Canvas tool card definitions via `getAllCaseTools()` (`lib/case-tools-db.ts`).

`export const dynamic = "force-dynamic"` keeps the page from being statically cached, since it reflects live per-agent state (OAuth connection status, notices from query params after an OAuth redirect).

## Settings cards

| Card | Component | Purpose |
|---|---|---|
| Profile | `./settings-form.tsx` (`SettingsForm`) | Name, timezone, working days |
| Canvas tools | `components/case-tools-settings.tsx` | CRUD for the tool cards available on the Canvas — see [[Tool Cards and Fadmin]] |
| Canvas display | `components/canvas-mode-settings.tsx` | Canvas display preferences (single toggle-row card) |
| Reply tone | `components/reply-tone-settings.tsx` | Pick a tone preset (Professional / Warm / Human) or write custom tone text — consumed by draft generation, see [[System Prompt Architecture]] |
| Personal AI key | `components/personal-ai-key-settings.tsx` | Bring-your-own OpenAI-compatible key: API key, base URL, model, aux model — see [[Draft Verify Pipeline]] for how this is consumed at generation/verification time |
| Connected integrations | inline in `page.tsx` | Google, Intercom, Slack, Notion connection status + connect/disconnect actions |
| Sign out | inline in `page.tsx` | Posts to `/api/auth/logout` |

## Integrations

Four integrations are surfaced as rows in a single "Connected integrations" card:

- **Google** — connects automatically via Supabase's built-in Google OAuth provider at sign-in. There is no separate connect action on this page; if the agent isn't signed in, the row shows a "Sign in" link to `/api/auth/login`. See [[Auth and Session]].
- **Intercom** — a workspace-level connection (not per-agent). Shown as connected when `INTERCOM_ACCESS_TOKEN` is set in the environment; there is nothing for an individual agent to connect or disconnect. See [[Intercom Integration]].
- **Slack** — per-agent OAuth. Connecting starts at `/api/auth/slack`, which redirects through Slack's OAuth consent and lands back via a callback route that stores the resulting token in `agents.slack_token`. Once connected, that token lets the agent read and send Slack messages as themselves — see [[Slack Integration]].
- **Notion** — per-agent, hosted-MCP OAuth. Connecting starts at `/api/auth/notion`. Unlike Slack's simple bearer token, Notion's connection is a rotating refresh-token flow: `notion_mcp_refresh_token` plus an absolute expiry (`notion_mcp_refresh_expires_at`). `refreshTokenExpired()` (`lib/notion-mcp-auth.ts`) checks that window; if it has elapsed the UI shows "Reconnect" instead of "Connect". See [[Notion MCP Integration]].

### Disconnecting

The `disconnectIntegration` server action (defined inline in `page.tsx`) handles both Slack and Notion:

- Slack: sets `slack_token` to `null`.
- Notion: nulls `notion_token` **and** all `notion_mcp_*` columns (`notion_mcp_access_token`, `notion_mcp_refresh_token`, `notion_mcp_token_expires_at`, `notion_mcp_refresh_expires_at`) so the local connection is fully revoked, not just partially cleared.

Both branches call `revalidatePath("/settings")` afterward so the page reflects the new state immediately.

## OAuth notices

After an OAuth redirect completes, the page can render a banner keyed by a `?notice=` query param (e.g. `slack-connected`, `slack-failed`, `slack-unavailable`, `notion-connected`, `notion-failed`, `notion-unavailable`). These are friendly, agent-facing strings only — admin setup instructions (env vars like `SLACK_CLIENT_ID`) live in `web/README.md`, not in this UI copy.

## Key files

- `app/settings/page.tsx` — the page itself: data loading, integration rows, disconnect action, OAuth notices
- `app/settings/settings-form.tsx` — profile form (name, timezone, working days)
- `components/case-tools-settings.tsx` — Canvas tool card CRUD
- `components/canvas-mode-settings.tsx` — Canvas display toggle
- `components/reply-tone-settings.tsx` — tone preset picker / custom tone text
- `components/personal-ai-key-settings.tsx` — BYO AI key form
- `lib/notion-mcp-auth.ts` — `refreshTokenExpired()` and related Notion MCP token helpers
- `lib/case-tools-db.ts` — `getAllCaseTools()`

## Data flow

```
Agent visits /settings
  → getSignedInEmail()                (Supabase session)
  → getAgentRow(email)                (Supabase "agents" table, scoped column select)
  → getAllCaseTools()                 (Canvas tool card definitions)
  → render grid of settings cards

Connect Slack:  card → /api/auth/slack → Slack OAuth consent → callback route → agents.slack_token
Connect Notion: card → /api/auth/notion → hosted-MCP OAuth → callback route → agents.notion_mcp_*
Connect Google: handled entirely by Supabase auth at sign-in, not from this page

Disconnect:     card form → disconnectIntegration() server action → null out token column(s) → revalidatePath("/settings")
```

## Related pages

[[Tech Stack]] · [[Auth and Session]] · [[Database Schema Reference]] · [[Tool Cards and Fadmin]] · [[System Prompt Architecture]] · [[Draft Verify Pipeline]] · [[Slack Integration]] · [[Notion MCP Integration]]
