---
title: Auth and Session
tags: [architecture, auth, security]
updated: 2026-09-01
---

# Auth and Session

Authentication is built on Supabase Auth (JWT-based sessions, stored in cookies). There are two related tables: Supabase-managed `auth.users` (the identity record) and a custom `agents` table (application data: name, avatar, integration tokens for Google/Slack/Notion, Intercom admin ID), joined by email and linked to `auth.users` via `user_id`.

## `agents.name` vs `agents.agent_name` — internal name vs customer-facing name

The `agents` table carries two separate name columns, and mixing them up is a
real security/privacy bug that shipped once already:

- **`agents.name`** — the INTERNAL display name. Upserted from the Google
  profile (`user_metadata.full_name`) on every sign-in at `GET
  /api/auth/callback`. Shown to teammates only: sidebar, the "Display name
  (internal)" field in Settings > Profile.
- **`agents.agent_name`** — the CUSTOMER-FACING name, nullable, agent-chosen.
  Edited in Settings > Profile as "Agent name (customers see this)", with a
  live greeting preview. This is the *only* name that may appear in a reply
  greeting, quick-send email, or anywhere else a customer reads. It is never
  touched by the Google sign-in upsert. It is set exactly once automatically:
  the callback backfills it from the agent's matched Intercom admin display
  name (`listIntercomAdmins()`), and only when it is still null — a later
  Google re-login never overwrites it.

Before this split, customer-facing code read the first word of `agents.name`
— so the agent's real Google name leaked into every customer greeting, and
every Google re-login silently overwrote whatever name the agent had typed
into Settings for customers to see.

## `lib/agent-identity.ts` — the customer-facing name resolver

`getCustomerFacingIdentity(email)` is the single place that reads
`agents.agent_name`. It returns `{ agentName, intercomAdminId, signature }`,
never reads `agents.name`, and returns `agentName: null` rather than any kind
of internal-name fallback when the column is unset. Callers pass the null
through to the existing generic `"the support team"` sentinel (see
`buildAgentGreeting()` in [[Draft Verify Pipeline]] / `lib/draft-ai.ts`),
which drops the "I'm X" clause entirely rather than write a placeholder name
into a customer message. `signature` is `"${agentName}, Fanvue Support"` or
null.

Every customer-facing name lookup in the app goes through this resolver,
directly or via a thin wrapper:

- `lib/auth.ts::getAgentNameAndAdminId(email)` — thin wrapper, defaults the
  null case to `"the support team"` for the draft/system-prompt call sites
  that expect a non-null string.
- `lib/reply-queue-pipeline.ts::getAgentFirstName(email)` — same pattern, for
  the always-on webhook pipeline's greeting injection.
- `lib/agent.ts::getAgentProfile()` — adds `agentName` to `AgentProfile`
  alongside the existing internal `name`/`firstName`, used by
  `app/cases/[id]/page.tsx`'s fallback-draft greeting and by Home
  (`components/home/agent-name-gate.tsx`) to gate the briefing behind
  `agentName` being set.
- `app/gmail/quick-send/page.tsx` calls the resolver directly to fill
  `{{agentname}}` in quick-send email templates.

## Sign-in is Google Workspace SSO only — by design

There is no password-based login and no bypass path. `GET /api/auth/login` calls `supabase.auth.signInWithOAuth` with `provider: "google"` and `queryParams: { hd: "fanvue.com", access_type: "offline", prompt: "consent" }` — the `hd` (hosted domain) parameter restricts sign-in to `@fanvue.com` Google Workspace accounts. It also requests `calendar.readonly` and `gmail.modify` scopes up front, since agents' Google identity is reused to drive Gmail/Calendar integrations.

This is a deliberate security control, not an oversight: this app is a gateway into real customer and financial data (Intercom conversations, Fadmin links, Gmail, Slack, Notion — see [[Intercom Integration]], [[Gmail Integration]], [[Slack Integration]], [[Notion MCP Integration]]). Restricting entry to a single SSO provider scoped to the company Workspace domain means there's no separate credential store to compromise and no secondary login surface to patch or audit. Do not add a password or "test" login path to this app without treating it as a security-relevant change.

## Route protection: `proxy.ts`

Session refresh and route gating live in `proxy.ts` at the repo root — Next.js's current convention for what used to be `middleware.ts`. It runs on every request matched by its `config.matcher` (everything except static assets, images, favicon, and `version.json`) and:

1. Builds a request-scoped Supabase server client and calls `supabase.auth.getUser()` — this validates the session against Supabase, not just a cookie presence check, so an expired/revoked session is caught here.
2. Allows **machine routes** through without a user session: `/api/automation/sweep`, anything under `/api/cron/`, and anything under `/api/webhooks/`. These authenticate via a shared secret or signature header instead (`CRON_SECRET`, webhook signatures), enforced by each route individually — they must not be redirected to `/login` or callers like pg_cron / Intercom webhooks could never reach the handler. Cron routes are matched by **prefix**, deliberately: they used to be listed one exact path at a time, and `/api/cron/triage-sweep` was simply never added, so it was redirected to `/login` on every scheduled run for months while both pg_cron and pg_net reported success (see INC-002 in `INCIDENTS.md`). The prefix is safe because every route under `/api/cron/` checks `CRON_SECRET` itself and returns 401 without it — so a new cron route is reachable by construction rather than by remembering to edit this list.
3. Redirects unauthenticated users to `/login` for everything else except `/login` itself and `/api/auth/*`.
4. Redirects already-authenticated users away from `/login` back to `/`.

Any cookies Supabase needs to refresh get written onto the response it returns, which is how the session stays alive across requests without the user having to re-authenticate.

## Key functions (`lib/auth.ts`)

All lookups are wrapped in React's `cache()` so that multiple components rendering within the same request (e.g. sidebar + integration cards) share one Supabase round trip and one `agents` row fetch instead of duplicating both per component.

- **`getSignedInUser()`** — returns `{ email, avatarUrl }` for the current session, reading the authenticated user and joining against the agent's `agents` row for the avatar.
- **`getSignedInEmail()`** — `@deprecated` shorthand that just returns the email from `getSignedInUser()`.
- **`getAgentNameAndAdminId(email)`** — returns `{ name, intercomAdminId }`; `name` is the agent's CUSTOMER-FACING name (`agents.agent_name` via `lib/agent-identity.ts`'s resolver, falling back to `"the support team"` when unset), used in reply greetings and draft system prompts. Never reads `agents.name`. `intercomAdminId` comes from the `agents.intercom_admin_id` column.
- **`resolveIntercomAdminId(email)`** — maps a signed-in agent to their Intercom admin ID via `agents.intercom_admin_id`, falling back to the `INTERCOM_ADMIN_ID` env var when the admin client or the row is unavailable. This is what lets each agent see their own Intercom case queue instead of a shared default.
- **`getAgentTokens()`** — returns Google, Slack, and Notion tokens plus name/email for the dashboard's integration cards. For Google specifically, it prefers the live session's `provider_token` (freshest) over the DB-stored `google_token`, and opportunistically syncs the fresher token back to the `agents` row in the background when they diverge.
- **`refreshGoogleToken(email)`** / **`googleFetch(...)`** — refresh-token exchange against Google's OAuth endpoint and a fetch wrapper that retries once with a refreshed token on a 401, respectively. Not called out explicitly in the original spec but present alongside the above and relevant to how Gmail/Calendar calls stay authenticated.

## OAuth routes

| Route | Purpose |
|---|---|
| `GET /api/auth/login` | Starts Supabase Google OAuth sign-in, restricted to `@fanvue.com` via the `hd` param |
| `GET /api/auth/callback` | Handles the Google OAuth return: exchanges the code for a session, then upserts the `agents` row (email, name, avatar, `google_token`), conditionally updates `google_refresh_token` (only when Google actually issues a new one, so re-logins don't null out a valid stored token), links `user_id`, auto-matches the agent to their Intercom admin ID by email against `listIntercomAdmins()`, and — only if `agent_name` is still null — backfills it from that matched admin's Intercom display name |
| `POST /api/auth/logout` | Clears the session |
| `GET /api/auth/slack` → `GET /api/auth/slack/callback` | Slack OAuth flow, storing the resulting token on the `agents` row (see [[Slack Integration]]) |
| `GET /api/auth/notion` → `GET /api/auth/notion/callback` | Notion OAuth flow, same pattern (see [[Notion MCP Integration]]) |

## Session-scoped writes

Any route or server action that writes to the `agents` table must derive the
row key (email) from the signed-in session (`getSignedInEmail()`), never from
a value the request body/formData carries — a client-supplied email there
would let one agent's request modify another agent's row. This is why
`POST /api/settings/update` and the `disconnectIntegration` server action in
`app/settings/page.tsx` call `getSignedInEmail()` and ignore any `email` field
in the payload, even though the settings form (harmlessly) still displays it.

## Key files

- `proxy.ts` — request-level session refresh + route protection (Next.js's `middleware.ts` equivalent)
- `lib/auth.ts` — `getSignedInUser`, `getSignedInEmail`, `getAgentNameAndAdminId`, `resolveIntercomAdminId`, `getAgentTokens`, `refreshGoogleToken`, `googleFetch`
- `lib/agent-identity.ts` — `getCustomerFacingIdentity(email)`, the sole resolver for `agents.agent_name`
- `lib/agent.ts` — `getAgentProfile()`, per-request profile (internal `name`/`firstName` + customer-facing `agentName`)
- `lib/supabase-admin.ts` — service-role Supabase client used for privileged `agents` table access
- `app/api/auth/login/route.ts` — starts Google OAuth (`hd: "fanvue.com"`)
- `app/api/auth/callback/route.ts` — OAuth callback, agent row upsert, Intercom admin matching
- `app/api/auth/logout/route.ts` — session clear
- `app/api/auth/slack/route.ts`, `app/api/auth/slack/callback/route.ts` — Slack OAuth
- `app/api/auth/notion/route.ts`, `app/api/auth/notion/callback/route.ts` — Notion OAuth

## Data flow

```
Agent clicks "Sign in"
        │
        ▼
GET /api/auth/login  ──(signInWithOAuth, hd=fanvue.com)──▶  Google consent screen
        │
        ▼
GET /api/auth/callback  ──(exchangeCodeForSession)──▶  Supabase session established
        │                                                  │
        │                                                  ├─ upsert agents{email, name, avatar_url, google_token}
        │                                                  ├─ update agents.google_refresh_token (if issued)
        │                                                  ├─ update agents.user_id
        │                                                  ├─ match email → Intercom admin → agents.intercom_admin_id
        │                                                  └─ if agents.agent_name is null → backfill from matched admin's name
        ▼
Redirect to "/"
        │
        ▼
proxy.ts (every request) ──(auth.getUser())──▶ session valid? ──no──▶ redirect /login
        │                                                    ──yes─▶ continue, refresh cookies as needed
        ▼
lib/auth.ts (getSignedInUser / getAgentTokens / ...) ──cache()-deduped──▶ page/components render
```

See also: [[Tech Stack]], [[Intercom Integration]], [[Gmail Integration]], [[Slack Integration]], [[Notion MCP Integration]], [[Database Schema Reference]], [[Settings and Profile]], [[Draft Verify Pipeline]].
