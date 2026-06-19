import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getStoredMcpClient } from "@/lib/notion-mcp-client-store"
import { buildTokenExchangeBody, parseTokenResponse } from "@/lib/notion-mcp-oauth"
import { nextTokenColumns } from "@/lib/notion-mcp-auth"

// Completes the per-agent hosted Notion MCP OAuth flow: verifies the CSRF
// state, exchanges the authorization code (with the PKCE verifier) for tokens,
// and stores them into the agents.notion_mcp_* columns for the signed-in agent.
// On initial consent we stamp the absolute ~30-day refresh window.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const settings = (notice: string) =>
    NextResponse.redirect(new URL(`/settings?notice=${notice}`, origin))

  const code = searchParams.get("code")
  const state = searchParams.get("state")

  const cookieStore = await cookies()
  const expectedState = cookieStore.get("notion_mcp_oauth_state")?.value
  const codeVerifier = cookieStore.get("notion_mcp_pkce_verifier")?.value
  cookieStore.delete("notion_mcp_oauth_state")
  cookieStore.delete("notion_mcp_pkce_verifier")

  // The provider may redirect back with an explicit error (e.g. access_denied).
  if (searchParams.get("error")) {
    return settings("notion-failed")
  }
  if (!code || !state || state !== expectedState || !codeVerifier) {
    return settings("notion-failed")
  }

  const email = await getSignedInEmail()
  const adminClient = getSupabaseAdminClient()
  if (!email || !adminClient) {
    return settings("notion-failed")
  }

  const client = await getStoredMcpClient(origin)
  if (!client) {
    return settings("notion-unavailable")
  }

  const redirectUri = `${origin}/api/auth/notion/callback`

  try {
    const res = await fetch(client.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: buildTokenExchangeBody({
        clientId: client.client_id,
        code,
        redirectUri,
        codeVerifier,
        clientSecret: client.client_secret,
      }),
      cache: "no-store",
    })

    const parsed = parseTokenResponse(await res.json().catch(() => null))
    if (!parsed.ok) {
      return settings("notion-failed")
    }

    // Initial consent → stamp the absolute (non-sliding) refresh window.
    const cols = nextTokenColumns(parsed, Date.now(), {
      isInitialConsent: true,
      existingRefreshExpiresAt: null,
    })

    await adminClient.from("agents").update(cols).eq("email", email)

    return settings("notion-connected")
  } catch {
    return settings("notion-failed")
  }
}
