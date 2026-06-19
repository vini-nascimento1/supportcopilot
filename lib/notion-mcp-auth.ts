// Pure token-lifecycle logic for the hosted Notion MCP OAuth (mcp.notion.com).
// The hosted MCP uses ROTATING refresh tokens: the access token lives ~1h, the
// refresh token rotates on every use, and the refresh grant has an ABSOLUTE
// ~30-day lifetime that does NOT slide — after it the agent must re-consent.
// See FanvueSupport/Engineering/Plan - Notion AI retrieval for drafting.md §7b.
//
// Pure + unit-tested (no server-only, no I/O), mirroring lib/playbook-gate.ts.
// The network refresh call + Supabase persistence (with a mutex + atomic write
// of the rotated refresh token) live in a server module added once the
// hosted-MCP OAuth client is registered.

export type NotionMcpTokenColumns = {
  notion_mcp_access_token: string | null
  notion_mcp_refresh_token: string | null
  notion_mcp_token_expires_at: string | null // ISO
  notion_mcp_refresh_expires_at: string | null // ISO, absolute (does not slide)
}

export type NotionOAuthTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number // seconds until the access token expires
}

// Refresh this many ms before the access token actually expires.
export const ACCESS_TOKEN_SKEW_MS = 120_000
export const DEFAULT_REFRESH_WINDOW_DAYS = 30

// True when there is no usable access token, or it is within the skew window
// of expiry (refresh proactively rather than waiting for a 401).
export function accessTokenNeedsRefresh(
  expiresAtIso: string | null,
  nowMs: number
): boolean {
  if (!expiresAtIso) return true
  const exp = Date.parse(expiresAtIso)
  if (Number.isNaN(exp)) return true
  return nowMs >= exp - ACCESS_TOKEN_SKEW_MS
}

// True when the absolute refresh-token lifetime has passed → the connection is
// dead and the agent must re-consent in the browser (treat like invalid_grant).
export function refreshTokenExpired(
  refreshExpiresAtIso: string | null,
  nowMs: number
): boolean {
  if (!refreshExpiresAtIso) return true
  const exp = Date.parse(refreshExpiresAtIso)
  if (Number.isNaN(exp)) return true
  return nowMs >= exp
}

// The agents-row columns to persist after a grant/refresh.
// On INITIAL consent we stamp the absolute refresh window; on a refresh we KEEP
// the existing refresh_expires_at because the 30-day window does not slide.
// Always persist the (rotated) refresh_token from the response atomically —
// replaying a retired refresh token can revoke the whole grant.
export function nextTokenColumns(
  res: NotionOAuthTokenResponse,
  nowMs: number,
  opts: {
    isInitialConsent: boolean
    existingRefreshExpiresAt: string | null
    refreshWindowDays?: number
  }
): NotionMcpTokenColumns {
  const accessExpiresAt = new Date(nowMs + res.expires_in * 1000).toISOString()
  const refreshExpiresAt = opts.isInitialConsent
    ? new Date(
        nowMs + (opts.refreshWindowDays ?? DEFAULT_REFRESH_WINDOW_DAYS) * 86_400_000
      ).toISOString()
    : opts.existingRefreshExpiresAt
  return {
    notion_mcp_access_token: res.access_token,
    notion_mcp_refresh_token: res.refresh_token,
    notion_mcp_token_expires_at: accessExpiresAt,
    notion_mcp_refresh_expires_at: refreshExpiresAt,
  }
}
