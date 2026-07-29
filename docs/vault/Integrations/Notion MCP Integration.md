---
title: Notion MCP Integration
tags: [integrations, notion, mcp, rag]
updated: 2026-07-29
---

# Notion MCP Integration

This integration lets AI-drafted replies ground themselves in the team's Notion knowledge base — plus whatever Notion has connected on top (Google Drive, Slack, Linear, etc.) — for support cases that don't already match a known playbook. It plugs into the draft path described in [[Draft Verify Pipeline]] as an optional, best-effort context source: if Notion is unreachable or unauthenticated, drafting proceeds on the base prompt with no retrieval.

## Architecture

Rather than calling Notion's own REST API directly, this integration talks to **Anthropic's hosted MCP server** at `mcp.notion.com`. The protocol is JSON-RPC 2.0 over plain HTTPS `fetch` (no MCP SDK) — a single `tools/call` request invoking the `notion-search` tool with `content_search_mode: "ai_search"`, which fans the query out across Notion pages and any connected sources (Google Drive, Slack, Linear, GitHub, ...).

Auth is a standard OAuth flow against Notion, not against the individual connected sources:

- `GET /api/auth/notion` starts the flow → Notion OAuth consent screen → `GET /api/auth/notion/callback` completes it.
- The resulting bearer token is stored per-agent as `agents.notion_mcp_access_token` and `agents.notion_mcp_refresh_token`.
- The hosted MCP issues **rotating** refresh tokens: the access token lives roughly an hour, and the refresh token itself rotates on every use, inside an absolute (non-sliding) refresh-token lifetime window tracked in `agents.notion_mcp_refresh_expires_at` (~30 days from initial consent). Because the refresh token rotates, the persistence write has to be atomic (mutex + single write of the new rotated token) — replaying a retired refresh token revokes the whole grant.

## Key files

- `lib/notion-mcp-client.ts` — `searchNotionViaMcp()`, the live call to the hosted MCP endpoint
- `lib/notion-mcp-client-store.ts` — client-side store/cache around MCP results
- `lib/notion-mcp-oauth.ts` — `NOTION_MCP_URL` and OAuth constants/helpers
- `lib/notion-mcp-auth.ts` — token shape, `refreshTokenExpired()`, and the persistence-field builder for grant/refresh responses
- `lib/notion-mcp-auth-server.ts` — server-side auto-refresh-on-expiry middleware (network refresh call + Supabase persistence)
- `lib/notion-retrieval.ts` — pure mapping/classification helpers (`mapAiSearchResults()`, `classifyNotionSnippetUse()`, `isInternalSource()`, `extractSearchPayload()`)
- `lib/notion-retrieval-server.ts` — `retrieveNotionSnippets()`, the server-side entry point called from the draft path
- `app/api/auth/notion/route.ts`, `app/api/auth/notion/callback/route.ts` — OAuth connect flow

## Key function: `searchNotionViaMcp()`

```typescript
async function searchNotionViaMcp(
  accessToken: string,
  query: string,
  limit: number
): Promise<RetrievalResult>
```

Posts a `tools/call` JSON-RPC request for the `notion-search` tool (`query_type: "internal"`, `content_search_mode: "ai_search"`, `page_size: limit`) to `NOTION_MCP_URL`, then runs the raw response through the pure `mapAiSearchResults()` mapper. It **never throws** — every failure path (missing token/query, non-2xx response, malformed JSON) resolves to `{ snippets: [], backend: "none", error: "<reason>" }` instead of raising, so a Notion outage or an expired token cannot break draft generation; it just falls back to the base prompt.

```typescript
type NotionSnippet = {
  id: string
  title: string
  url: string
  text: string            // highlight excerpt — the grounding text, "" when absent
  source: string           // raw result type: "page" | "google-drive" | "slack" | "linear" | ...
  isInternalSource: boolean // true for anything other than a first-class Notion "page"
  timestamp: string | null
}

type RetrievalResult = {
  snippets: NotionSnippet[]
  backend: "ai_search" | "workspace" | "none"
  error: string | null
}
```

## Snippet filtering (`lib/notion-retrieval.ts`)

Not every snippet the MCP returns is safe to quote to a customer. `classifyNotionSnippetUse(snippet, nowMs)` buckets each one into a `NotionSnippetUse`:

- **`customerSafe`** — first-class Notion pages (`isInternalSource === false`). Safe to cite directly in customer-facing text.
- **`internalOnly`** — connector sources (Google Drive, Slack, Linear, GitHub, etc.). Firewalled from customer-facing drafts because these may surface internal chatter never meant for a creator to see.
- **`transientExpired`** — outage/incident or known-bug pages whose age exceeds a keyword-dependent freshness window (1 day for outage/incident/downtime-type terms, 14 days for bug-type terms), so a stale incident page can't ground an answer about a problem that's already resolved.

`mapAiSearchResults(raw, limit)` is the pure function that turns the raw MCP JSON payload into `NotionSnippet[]`, capped at `limit`, with basic shape validation (skips entries missing `id`/`title`/`url`). `extractSearchPayload()` unwraps whatever shape the hosted MCP nests the actual `results` array inside before `mapAiSearchResults` is applied.

## Retrieval in the draft path

`retrieveNotionSnippets(email, origin, query, limit)` (in `lib/notion-retrieval-server.ts`) is the entry point called from [[Draft Verify Pipeline]] (via `lib/draft-ai.ts` / `lib/reply-queue-pipeline.ts`). It:

1. Loads the agent's current `notion_mcp_access_token`, refreshing it first if expired (via `lib/notion-mcp-auth-server.ts`).
2. Calls `searchNotionViaMcp()`.
3. Filters the returned snippets down to `customerSafe` only.
4. Hands the filtered list to `buildNotionAwareSystemPrompt()`, which injects them into the draft's system prompt as numbered, citable references (e.g. "As mentioned in [1], ...") — see [[System Prompt Architecture]] for how that prompt is assembled.

## Settings

OAuth connect/disconnect lives on the Settings page (see [[Settings and Profile]]). Token refresh and the auto-refresh-on-expiry middleware live in `lib/notion-mcp-auth-server.ts` (network refresh + Supabase persistence) built on top of the pure helpers in `lib/notion-mcp-auth.ts`.

## Data flow

```
Draft request (no matching playbook)
        │
        ▼
lib/draft-ai.ts / reply-queue-pipeline.ts
        │
        ▼
retrieveNotionSnippets(email, origin, query, limit)   [lib/notion-retrieval-server.ts]
        │
        ├─▶ refresh notion_mcp_access_token if expired  [lib/notion-mcp-auth-server.ts]
        │
        ▼
searchNotionViaMcp(accessToken, query, limit)  [lib/notion-mcp-client.ts]
        │  JSON-RPC 2.0 "tools/call" → notion-search (ai_search)
        ▼
mcp.notion.com  (fans out to Notion pages + connected Drive/Slack/Linear/...)
        │
        ▼
mapAiSearchResults() → NotionSnippet[]  [lib/notion-retrieval.ts]
        │
        ▼
classifyNotionSnippetUse() → keep customerSafe only
        │
        ▼
buildNotionAwareSystemPrompt()  →  numbered citable references  →  draft LLM call
```

## Related

See [[Draft Verify Pipeline]] for how these snippets feed into draft generation and verification, [[System Prompt Architecture]] for how citable references are woven into the system prompt, and [[Settings and Profile]] for the OAuth connect/disconnect UI.
