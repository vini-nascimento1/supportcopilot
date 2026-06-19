// Pure OAuth 2.1 + Dynamic Client Registration (RFC 7591) + PKCE helpers for the
// hosted Notion MCP (mcp.notion.com). No `server-only`, no top-level I/O — fully
// unit-testable (mirrors lib/notion-mcp-auth.ts and lib/playbook-gate.ts). The
// live discovery/registration/redirect network calls live in the server modules
// (route handlers + getOrRegisterMcpClient); this module only parses metadata
// and builds the request bodies / URLs they send.
//
// Flow (all endpoints come from discovery, never hardcoded except the two
// well-known paths):
//   1. GET <MCP_ORIGIN>/.well-known/oauth-protected-resource
//        -> { authorization_servers: [<issuer>] }
//   2. GET <issuer>/.well-known/oauth-authorization-server
//        -> { registration_endpoint, authorization_endpoint, token_endpoint }
//   3. POST registration_endpoint (DCR)  -> { client_id, client_secret? }
//   4. redirect to authorization_endpoint with PKCE challenge + state
//   5. POST token_endpoint with code + PKCE verifier  -> tokens
//   6. POST token_endpoint with refresh_token (rotates)  -> tokens
// See FanvueSupport/Engineering/Plan - Notion AI retrieval for drafting.md §7b.

export const NOTION_MCP_URL = "https://mcp.notion.com/mcp"
export const NOTION_MCP_ORIGIN = "https://mcp.notion.com"
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource"
export const AUTH_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server"

// The OAuth scopes we request. Notion's hosted MCP grants workspace read access;
// we keep this minimal and let the server widen if it must.
export const NOTION_MCP_SCOPE = ""

// ── Metadata parsing ────────────────────────────────────────────────────────

export type NotionOAuthServerConfig = {
  /** OAuth issuer / authorization-server origin. */
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

// Parse the protected-resource metadata → the authorization server issuer URL.
// Tolerates `authorization_servers` (array, per RFC 9728) returning the first
// entry. Returns null when the document is malformed.
export function parseProtectedResourceMetadata(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const servers = raw.authorization_servers
  if (Array.isArray(servers)) {
    const first = servers.find(nonEmptyString)
    if (first) return first
  }
  // Some servers expose a single `authorization_server` field.
  if (nonEmptyString(raw.authorization_server)) return raw.authorization_server
  return null
}

// Parse the authorization-server metadata (RFC 8414) into a typed config.
// All four endpoints are required; returns null if any is missing.
export function parseAuthServerMetadata(
  raw: unknown,
  issuer: string
): NotionOAuthServerConfig | null {
  if (!isRecord(raw)) return null
  const authorizationEndpoint = raw.authorization_endpoint
  const tokenEndpoint = raw.token_endpoint
  const registrationEndpoint = raw.registration_endpoint
  if (!nonEmptyString(authorizationEndpoint)) return null
  if (!nonEmptyString(tokenEndpoint)) return null
  if (!nonEmptyString(registrationEndpoint)) return null
  return {
    issuer: nonEmptyString(raw.issuer) ? raw.issuer : issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
  }
}

// ── Dynamic Client Registration ─────────────────────────────────────────────

export type RegisteredMcpClient = {
  client_id: string
  /** Present only for confidential clients; absent for public + PKCE. */
  client_secret?: string | null
  /** Endpoints captured at registration so refresh works without re-discovery. */
  token_endpoint: string
  authorization_endpoint: string
}

// The JSON body for the DCR POST (RFC 7591). We register a single redirect URI
// (this deployment's callback) and request both grant types so refresh works.
export function buildRegistrationBody(redirectUri: string): Record<string, unknown> {
  return {
    client_name: "Fanvue Support Copilot",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    // Public client + PKCE: no client secret to leak in the browser redirect.
    token_endpoint_auth_method: "none",
  }
}

// Parse a DCR registration response into the stored client shape. The endpoints
// are passed in (from the auth-server metadata) so they're persisted alongside
// the client_id. Returns null without a usable client_id.
export function parseRegistrationResponse(
  raw: unknown,
  config: NotionOAuthServerConfig
): RegisteredMcpClient | null {
  if (!isRecord(raw)) return null
  if (!nonEmptyString(raw.client_id)) return null
  return {
    client_id: raw.client_id,
    client_secret: nonEmptyString(raw.client_secret) ? raw.client_secret : null,
    token_endpoint: config.tokenEndpoint,
    authorization_endpoint: config.authorizationEndpoint,
  }
}

// ── PKCE (RFC 7636, S256) ───────────────────────────────────────────────────

// base64url-encode bytes (no padding) — used for both the verifier and the
// SHA-256 challenge. Pure: takes the raw bytes, the caller supplies randomness /
// the digest from WebCrypto.
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  // btoa is available in the Edge/Node runtimes Next uses; fall back to Buffer.
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64")
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// Build a PKCE code_verifier from random bytes (43–128 chars after encoding).
// 32 bytes → 43 base64url chars, comfortably within the RFC range.
export function makeCodeVerifier(randomBytes: Uint8Array): string {
  return base64UrlEncode(randomBytes)
}

// Compute the S256 code_challenge from an already-computed SHA-256 digest of the
// verifier. The digest is supplied by the caller (crypto.subtle.digest) so this
// stays pure and testable.
export function codeChallengeFromDigest(sha256Digest: ArrayBuffer): string {
  return base64UrlEncode(new Uint8Array(sha256Digest))
}

// ── Authorization URL ───────────────────────────────────────────────────────

export type AuthorizationUrlParams = {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  scope?: string
}

// Build the authorization-code + PKCE redirect URL the agent's browser is sent
// to. Pure: deterministic given the inputs.
export function buildAuthorizationUrl(
  authorizationEndpoint: string,
  params: AuthorizationUrlParams
): string {
  const url = new URL(authorizationEndpoint)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", params.clientId)
  url.searchParams.set("redirect_uri", params.redirectUri)
  url.searchParams.set("state", params.state)
  url.searchParams.set("code_challenge", params.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  const scope = params.scope ?? NOTION_MCP_SCOPE
  if (scope) url.searchParams.set("scope", scope)
  return url.toString()
}

// ── Token request bodies ────────────────────────────────────────────────────

// Body for the authorization-code → token exchange (PKCE: includes the
// verifier, no client_secret for a public client). Returned as URLSearchParams
// because the token endpoint expects application/x-www-form-urlencoded.
export function buildTokenExchangeBody(opts: {
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
  clientSecret?: string | null
}): URLSearchParams {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.codeVerifier,
  })
  if (opts.clientSecret) body.set("client_secret", opts.clientSecret)
  return body
}

// Body for the refresh-token grant. Notion ROTATES the refresh token on each
// use — the response carries a new one the caller must persist atomically.
export function buildRefreshBody(opts: {
  clientId: string
  refreshToken: string
  clientSecret?: string | null
}): URLSearchParams {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  })
  if (opts.clientSecret) body.set("client_secret", opts.clientSecret)
  return body
}

// Parse a token-endpoint response into the shape lib/notion-mcp-auth expects.
// Returns { ok:false, error } on a malformed body or an OAuth error response.
// `invalid_grant` is surfaced verbatim so callers can treat it as terminal
// (retired/replayed refresh token, or the absolute window passed → re-consent).
export type TokenParseResult =
  | { ok: true; access_token: string; refresh_token: string; expires_in: number }
  | { ok: false; error: string }

export function parseTokenResponse(raw: unknown): TokenParseResult {
  if (!isRecord(raw)) return { ok: false, error: "malformed_response" }
  if (nonEmptyString(raw.error)) return { ok: false, error: raw.error }
  if (!nonEmptyString(raw.access_token)) return { ok: false, error: "no_access_token" }
  if (!nonEmptyString(raw.refresh_token)) return { ok: false, error: "no_refresh_token" }
  const expiresIn =
    typeof raw.expires_in === "number" && Number.isFinite(raw.expires_in)
      ? raw.expires_in
      : 3600 // sensible default: Notion access tokens live ~1h
  return {
    ok: true,
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_in: expiresIn,
  }
}
