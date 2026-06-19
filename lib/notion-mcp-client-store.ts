import "server-only"

// Server-only DCR client store for the hosted Notion MCP.
//
// The OAuth client is registered ONCE per deployment (RFC 7591 Dynamic Client
// Registration) and reused by every agent's OAuth flow. We persist the
// registered client JSON in the existing key/value `settings` table under
// SETTINGS_KEY (jsonb) — no new migration needed. The registration is keyed by
// the callback redirect URI, so a different origin (preview vs prod) re-registers
// rather than reusing a client bound to the wrong redirect.
//
// Discovery + registration are network calls; the pure parsing/body builders
// live in lib/notion-mcp-oauth.ts (unit-tested). This module only orchestrates.

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import {
  NOTION_MCP_ORIGIN,
  PROTECTED_RESOURCE_PATH,
  AUTH_SERVER_METADATA_PATH,
  parseProtectedResourceMetadata,
  parseAuthServerMetadata,
  buildRegistrationBody,
  parseRegistrationResponse,
  type NotionOAuthServerConfig,
  type RegisteredMcpClient,
} from "@/lib/notion-mcp-oauth"

const SETTINGS_KEY = "notion_mcp_client"

type StoredClient = RegisteredMcpClient & { redirect_uri: string }

function callbackUri(origin: string): string {
  return `${origin}/api/auth/notion/callback`
}

// Discover the authorization-server config from the two well-known documents.
// Returns null on any network/parse failure (caller falls back gracefully).
export async function discoverNotionOAuthConfig(): Promise<NotionOAuthServerConfig | null> {
  try {
    const prRes = await fetch(`${NOTION_MCP_ORIGIN}${PROTECTED_RESOURCE_PATH}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
    if (!prRes.ok) return null
    const issuer = parseProtectedResourceMetadata(await prRes.json())
    if (!issuer) return null

    // The auth-server metadata lives at <issuer>/.well-known/oauth-authorization-server.
    const issuerUrl = new URL(issuer)
    const metaUrl = `${issuerUrl.origin}${AUTH_SERVER_METADATA_PATH}${issuerUrl.pathname === "/" ? "" : issuerUrl.pathname}`
    const asRes = await fetch(metaUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
    if (!asRes.ok) return null
    return parseAuthServerMetadata(await asRes.json(), issuer)
  } catch {
    return null
  }
}

async function readStoredClient(redirectUri: string): Promise<StoredClient | null> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return null
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle()

  const value = data?.value as Partial<StoredClient> | undefined
  if (!value || typeof value.client_id !== "string") return null
  // Re-register if the stored client was bound to a different redirect URI.
  if (value.redirect_uri !== redirectUri) return null
  return value as StoredClient
}

async function persistClient(client: StoredClient): Promise<void> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return
  await supabase
    .from("settings")
    .upsert({ key: SETTINGS_KEY, value: client, updated_at: new Date().toISOString() })
}

// Registers a new DCR client and returns it (without persisting). Returns null
// on failure.
async function registerClient(
  config: NotionOAuthServerConfig,
  redirectUri: string
): Promise<RegisteredMcpClient | null> {
  try {
    const res = await fetch(config.registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(buildRegistrationBody(redirectUri)),
      cache: "no-store",
    })
    if (!res.ok) return null
    return parseRegistrationResponse(await res.json(), config)
  } catch {
    return null
  }
}

export type McpClientResult =
  | { ok: true; client: StoredClient; config: NotionOAuthServerConfig }
  | { ok: false; error: string }

// Returns the registered client creds + the (freshly discovered) auth-server
// config for the given origin, registering via DCR on first use and caching the
// client in the settings table. Discovery always runs so the authorization and
// token endpoints are current; only the client_id is cached.
export async function getOrRegisterMcpClient(origin: string): Promise<McpClientResult> {
  const redirectUri = callbackUri(origin)

  const config = await discoverNotionOAuthConfig()
  if (!config) return { ok: false, error: "discovery_failed" }

  const existing = await readStoredClient(redirectUri)
  if (existing) {
    // Keep the freshly-discovered endpoints; reuse the registered client_id.
    return {
      ok: true,
      config,
      client: {
        ...existing,
        token_endpoint: config.tokenEndpoint,
        authorization_endpoint: config.authorizationEndpoint,
      },
    }
  }

  const registered = await registerClient(config, redirectUri)
  if (!registered) return { ok: false, error: "registration_failed" }

  const stored: StoredClient = { ...registered, redirect_uri: redirectUri }
  await persistClient(stored)
  return { ok: true, client: stored, config }
}

// Reads the stored client without discovery — used by the token refresh path,
// which already has the token endpoint persisted on the client row.
export async function getStoredMcpClient(origin: string): Promise<StoredClient | null> {
  return readStoredClient(callbackUri(origin))
}
