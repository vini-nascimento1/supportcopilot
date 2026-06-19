import "server-only"

// Server-only token lifecycle for the hosted Notion MCP. Wraps the PURE logic
// in lib/notion-mcp-auth.ts (refresh decisions, column shaping) with the actual
// Supabase reads/writes and the network refresh call.
//
// The hosted MCP uses ROTATING refresh tokens with an ABSOLUTE ~30-day window:
//   - access token ~1h → refresh proactively (ACCESS_TOKEN_SKEW_MS)
//   - refresh token rotates on every use → persist the new one ATOMICALLY;
//     replaying a retired one can revoke the whole grant.
//   - the refresh grant's absolute lifetime does NOT slide → past it, re-consent.
//
// Concurrency: two concurrent draft requests for the same agent must not both
// fire a refresh (the loser would replay a now-retired refresh token and could
// revoke the grant). We guard with a simple in-process promise mutex keyed by
// email. This is per-instance only — good enough because a single agent's draft
// requests are near-always served by one warm instance; cross-instance races
// are rare and the rotating-token failure mode is non-fatal (re-consent).

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import {
  accessTokenNeedsRefresh,
  refreshTokenExpired,
  nextTokenColumns,
  type NotionMcpTokenColumns,
} from "@/lib/notion-mcp-auth"
import { buildRefreshBody, parseTokenResponse } from "@/lib/notion-mcp-oauth"
import { getStoredMcpClient } from "@/lib/notion-mcp-client-store"

export type FreshTokenResult =
  | { accessToken: string; needsReconsent?: false }
  | { accessToken: null; needsReconsent: true }
  | { accessToken: null; needsReconsent?: false; error: string }

type AgentTokenRow = {
  notion_mcp_access_token: string | null
  notion_mcp_refresh_token: string | null
  notion_mcp_token_expires_at: string | null
  notion_mcp_refresh_expires_at: string | null
}

// In-process refresh mutex, keyed by agent email.
const inflight = new Map<string, Promise<FreshTokenResult>>()

async function readTokens(email: string): Promise<AgentTokenRow | null> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return null
  const { data } = await supabase
    .from("agents")
    .select(
      "notion_mcp_access_token, notion_mcp_refresh_token, notion_mcp_token_expires_at, notion_mcp_refresh_expires_at"
    )
    .eq("email", email)
    .maybeSingle()
  return (data as AgentTokenRow | null) ?? null
}

async function writeColumns(email: string, cols: NotionMcpTokenColumns): Promise<void> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return
  await supabase.from("agents").update(cols).eq("email", email)
}

async function clearTokens(email: string): Promise<void> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return
  await supabase
    .from("agents")
    .update({
      notion_mcp_access_token: null,
      notion_mcp_refresh_token: null,
      notion_mcp_token_expires_at: null,
      notion_mcp_refresh_expires_at: null,
    })
    .eq("email", email)
}

async function doRefresh(
  email: string,
  origin: string,
  row: AgentTokenRow
): Promise<FreshTokenResult> {
  const refreshToken = row.notion_mcp_refresh_token
  if (!refreshToken) return { accessToken: null, needsReconsent: true }

  const client = await getStoredMcpClient(origin)
  if (!client) return { accessToken: null, error: "no_registered_client" }

  let parsed
  try {
    const res = await fetch(client.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: buildRefreshBody({
        clientId: client.client_id,
        refreshToken,
        clientSecret: client.client_secret,
      }),
      cache: "no-store",
    })
    parsed = parseTokenResponse(await res.json().catch(() => null))
  } catch {
    return { accessToken: null, error: "refresh_network_error" }
  }

  if (!parsed.ok) {
    // invalid_grant (retired/replayed token, or window passed) is terminal →
    // clear the dead tokens and force a browser re-consent.
    if (parsed.error === "invalid_grant") {
      await clearTokens(email)
      return { accessToken: null, needsReconsent: true }
    }
    return { accessToken: null, error: parsed.error }
  }

  // Persist the ROTATED refresh token atomically. The 30-day window does not
  // slide, so keep the existing refresh_expires_at.
  const cols = nextTokenColumns(parsed, Date.now(), {
    isInitialConsent: false,
    existingRefreshExpiresAt: row.notion_mcp_refresh_expires_at,
  })
  await writeColumns(email, cols)
  return { accessToken: parsed.access_token }
}

// Returns a fresh, usable Notion MCP access token for the agent, refreshing
// proactively and persisting the rotated refresh token. Never throws — on any
// failure returns either needsReconsent (caller should prompt re-connect) or an
// error string (caller falls back to the base prompt).
export async function getFreshNotionMcpToken(
  email: string,
  origin: string
): Promise<FreshTokenResult> {
  const row = await readTokens(email)
  if (!row || !row.notion_mcp_refresh_token) {
    return { accessToken: null, needsReconsent: true }
  }

  const now = Date.now()

  // Absolute refresh window passed → dead grant, must re-consent.
  if (refreshTokenExpired(row.notion_mcp_refresh_expires_at, now)) {
    return { accessToken: null, needsReconsent: true }
  }

  // Access token still valid → use it directly.
  if (!accessTokenNeedsRefresh(row.notion_mcp_token_expires_at, now)) {
    if (row.notion_mcp_access_token) {
      return { accessToken: row.notion_mcp_access_token }
    }
  }

  // Refresh needed — dedupe concurrent refreshes for the same agent.
  const existing = inflight.get(email)
  if (existing) return existing

  const promise = doRefresh(email, origin, row).finally(() => {
    inflight.delete(email)
  })
  inflight.set(email, promise)
  return promise
}
