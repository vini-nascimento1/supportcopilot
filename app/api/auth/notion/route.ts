import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { getOrRegisterMcpClient } from "@/lib/notion-mcp-client-store"
import {
  buildAuthorizationUrl,
  makeCodeVerifier,
  codeChallengeFromDigest,
} from "@/lib/notion-mcp-oauth"

/**
 * Starts the per-agent hosted Notion MCP OAuth flow (mcp.notion.com).
 *
 * OAuth 2.1 + Dynamic Client Registration (RFC 7591) + PKCE — no portal step,
 * no NOTION_CLIENT_ID env: the client is registered once per deployment (cached
 * in the settings table) and discovered fresh each time. We:
 *   1. discover the auth-server config + ensure a registered client,
 *   2. generate a PKCE verifier/challenge (S256) and a CSRF state,
 *   3. stash verifier + state in httpOnly cookies (verified in the callback),
 *   4. redirect the agent's browser to the authorization endpoint.
 *
 * On any discovery/registration failure, redirect back to /settings with a
 * friendly notice rather than erroring.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url)

  const result = await getOrRegisterMcpClient(origin)
  if (!result.ok) {
    return NextResponse.redirect(new URL("/settings?notice=notion-unavailable", origin))
  }
  const { client } = result

  // PKCE: random 32-byte verifier → S256 challenge.
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32))
  const codeVerifier = makeCodeVerifier(verifierBytes)
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  )
  const codeChallenge = codeChallengeFromDigest(digest)

  const state = crypto.randomUUID()
  const redirectUri = `${origin}/api/auth/notion/callback`

  const cookieStore = await cookies()
  const cookieOpts = {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  }
  cookieStore.set("notion_mcp_oauth_state", state, cookieOpts)
  cookieStore.set("notion_mcp_pkce_verifier", codeVerifier, cookieOpts)

  const authUrl = buildAuthorizationUrl(client.authorization_endpoint, {
    clientId: client.client_id,
    redirectUri,
    state,
    codeChallenge,
  })

  return NextResponse.redirect(authUrl)
}
