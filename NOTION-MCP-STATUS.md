# Notion hosted-MCP live retrieval — status

Branch: `feat/notion-retrieval`. Wires the support copilot's **tail** path (a
case with no confident playbook) to ground its draft in **live Notion
`notion-search`** (AI-search across connectors), using each agent's own hosted
Notion MCP OAuth connection (`https://mcp.notion.com/mcp`).

Draft-only is preserved end to end: nothing is sent to Intercom/Slack; the only
writes are to Supabase (token rows) and the agent's draft is shown for manual
copy-paste.

## What was built

| Area | File | Notes |
|---|---|---|
| Pure OAuth/DCR/PKCE helpers | `lib/notion-mcp-oauth.ts` | metadata parsers, DCR body/response, PKCE (S256), authorization URL, token-exchange + refresh bodies, token-response parser (`invalid_grant` surfaced as terminal). **No I/O, unit-tested.** |
| DCR client store | `lib/notion-mcp-client-store.ts` (server-only) | `getOrRegisterMcpClient(origin)` discovers the auth-server config and registers ONE OAuth client via DCR, cached in the existing key/value `settings` table under `notion_mcp_client`. Re-registers if the deployment origin/redirect URI changes. |
| Server token lifecycle | `lib/notion-mcp-auth-server.ts` (server-only) | `getFreshNotionMcpToken(email, origin)`: reads tokens, refreshes proactively, persists the **rotated** refresh token atomically (in-process mutex per email), treats `invalid_grant` / expired-window as terminal → `needsReconsent`. Wraps the pure logic in `lib/notion-mcp-auth.ts`. Never throws. |
| Live MCP client | `lib/notion-mcp-client.ts` (server-only) | `searchNotionViaMcp(accessToken, query, limit)` connects over streamable HTTP with the bearer token, calls `notion-search` (`query_type:"internal"`, `content_search_mode:"ai_search"`), and maps the result via `extractSearchPayload` → `mapAiSearchResults`. Returns `backend:"none"` on any failure. |
| Payload normaliser | `lib/notion-retrieval.ts` → `extractSearchPayload` | Pure (lives here, not in the server-only client, so it's testable). Handles both `structuredContent` and JSON-in-text-block result shapes. |
| OAuth start route | `app/api/auth/notion/route.ts` | Discover → ensure client → generate PKCE + state (httpOnly cookies) → redirect to the authorization endpoint. |
| OAuth callback | `app/api/auth/notion/callback/route.ts` | Verify state, exchange code + PKCE verifier, store tokens into `agents.notion_mcp_*` via `nextTokenColumns(isInitialConsent:true)`. Keeps `/settings?notice=...` UX. |
| Draft wiring | `app/api/draft/route.ts` | Tail path only: fetch token → search → `buildNotionAwareSystemPrompt`. Any failure falls back to the base prompt. Head path unchanged. |
| Settings UI | `app/settings/page.tsx` | Notion row driven off `notion_mcp_*`: Connected / "Reconnect" (needs-reconsent) / Connect; Disconnect clears all `notion_mcp_*` columns. |

## Tests (Vitest)

- `npm test`: **91 passing** (was 62 before this work; +29 new). 6 files, all green.
- New pure-function coverage:
  - `lib/notion-mcp-oauth.test.ts` — **22 tests** (metadata parsers, DCR, PKCE base64url/verifier/challenge, auth URL, token bodies, token-response parser incl. `invalid_grant`).
  - `lib/notion-retrieval.test.ts` — **+7 tests** for `extractSearchPayload` (structuredContent, JSON-in-text, malformed input, end-to-end into `mapAiSearchResults`).
- Pre-existing pure logic in `lib/notion-mcp-auth.ts` is already covered by `lib/notion-mcp-auth.test.ts` and was REUSED, not duplicated.

## Typecheck / lint

- `npm run typecheck` — **clean** (no errors).
- `npm run lint` — **28 problems total, all pre-existing** and unrelated (require-style imports, react-hooks deps, etc.). The only touched file appearing in the lint output is `app/api/draft/route.ts`, with a single **pre-existing** `fullText` unused-var warning (verified against `HEAD` before my edits). **No new lint problems were added.**

## Unit-tested vs deploy-gated

**Unit-tested (verified now):** every pure builder/parser — OAuth metadata, DCR
body/response, PKCE encoding, authorization URL, token request bodies, token
response parsing, and the MCP payload extractor. The token-refresh *decisions*
(`accessTokenNeedsRefresh`, `refreshTokenExpired`, `nextTokenColumns`) were
already tested.

**Deploy-gated (cannot be verified without a deployed app + a human browser
consent):**
- The DCR registration network call against `mcp.notion.com` (endpoints,
  registration response shape).
- The full authorization-code + PKCE redirect handshake.
- The token exchange + the rotating-refresh-token cycle (and `invalid_grant`
  handling on a retired/replayed token or after the 30-day window).
- The live `notion-search` `tools/call` over streamable HTTP and the exact
  shape of its result (`structuredContent` vs text-block JSON) — `extractSearchPayload`
  handles both, but only live traffic confirms which Notion actually returns.

I did **not** fake any of the above; the code is written to the documented spec
and the pure parts are tested.

## EXACT manual test (after deploy)

1. Deploy the branch to an HTTPS origin (Vercel preview is fine). No new env var
   is required — the OAuth client self-registers via DCR. (`SUPABASE_SERVICE_ROLE_KEY`
   etc. must already be set, as for the rest of the app.)
2. Sign in as a `@fanvue.com` agent, go to **Settings → Connected integrations**.
3. Click **Connect** on the Notion row. You are redirected to Notion's consent
   screen (`mcp.notion.com`); click **Allow**. You should land back on
   `/settings?notice=notion-connected` with the Notion row showing **Connected**.
4. Open a support conversation that has **no confident playbook** (the tail) and
   click **Draft**. The draft should be grounded in live Notion knowledge
   (paraphrased, with the internal-source firewall applied). To confirm
   retrieval actually ran, temporarily log `result.backend` / snippet count in
   `retrieveNotionSnippets` (or check Vercel runtime logs) — `ai_search` means
   the live path fired; a base-prompt draft means it fell back.
5. Disconnect from Settings and confirm a subsequent tail draft silently falls
   back to the base prompt (no error shown to the user).

## Assumptions / decisions (kept simple, documented per the brief)

- **Client storage = `settings` table** (key `notion_mcp_client`), since that
  key/value table already exists. **No migration 0025 was created** — the brief
  said to write one only if no settings table existed. Nothing to apply.
- **Public client + PKCE** (`token_endpoint_auth_method: "none"`). If Notion
  issues a `client_secret` at registration, it is persisted and sent on token
  requests anyway, so both confidential and public registrations work.
- **Discovery runs on every Connect** (cheap, two GETs) so the authorization /
  token endpoints are always current; only the `client_id` is cached.
- **Refresh mutex is in-process, per email.** Cross-instance refresh races are
  possible but rare and non-fatal (the failure mode is a forced re-consent, not
  data loss). Documented in `lib/notion-mcp-auth-server.ts`.
- **`extractSearchPayload` lives in `lib/notion-retrieval.ts`** (not the
  server-only client) so it is unit-testable without Next's bundler — Vitest
  cannot import a module with `import "server-only"`.
- **Legacy `notion_token`** is no longer written by the OAuth callback. Nothing
  in drafting used it; the dashboard `NotionCard` is a static "Coming soon"
  placeholder. The `notionToken` field still exists on the `AgentTokens` type
  but is unused by any live feature.
- **Head/tail decision** stays where it already was: `/api/draft` treats the
  passed `playbookId` as the signal. Retrieval only fires when no `playbookId`
  is provided (the tail). The gate (`classifyPlaybookMatch`) that produces that
  decision is unchanged.

## Top risks to verify after consent

1. **Result shape of `notion-search`.** `extractSearchPayload` covers
   `structuredContent` and JSON-in-text; if Notion returns yet another shape,
   add a branch there (pure, easy to test).
2. **DCR endpoint behaviour.** If `mcp.notion.com` requires extra registration
   fields or rejects `token_endpoint_auth_method:"none"`, registration returns
   null → Connect redirects to `notion-unavailable`. Inspect the registration
   response and adjust `buildRegistrationBody`.
3. **Refresh-token rotation timing.** Confirm the rotated refresh token is
   persisted before the next refresh; a replayed retired token can revoke the
   grant (handled as terminal `invalid_grant` → re-consent, but worth watching
   in logs the first week).
4. **Scope.** We request no explicit scope (empty). If Notion requires a scope
   for `notion-search`, set `NOTION_MCP_SCOPE` in `lib/notion-mcp-oauth.ts`.
5. **Dependency:** `@modelcontextprotocol/sdk` was **already installed**
   (v1.29.0) — no new dependency added.
