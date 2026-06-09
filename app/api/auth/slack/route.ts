import { cookies } from "next/headers"
import { NextResponse } from "next/server"

/**
 * Starts the per-agent Slack OAuth flow (TODO 3.3).
 *
 * Requires SLACK_CLIENT_ID / SLACK_CLIENT_SECRET (workspace OAuth app —
 * admin setup, documented in web/README.md, never surfaced in the UI).
 * If the app isn't configured yet, redirect back to /settings with a
 * friendly notice instead of erroring.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url)

  const clientId = process.env.SLACK_CLIENT_ID
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/settings?notice=slack-unavailable", origin)
    )
  }

  // CSRF state, verified in the callback.
  const state = crypto.randomUUID()
  const cookieStore = await cookies()
  cookieStore.set("slack_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  })

  const url = new URL("https://slack.com/oauth/v2/authorize")
  url.searchParams.set("client_id", clientId)
  // User token scopes — read channels/DMs, send and react as the signed-in user.
  const userScopes = [
    "channels:read", "channels:history",
    "groups:read", "groups:history",
    "im:read", "im:history", "im:write",
    "mpim:read", "mpim:history",
    "chat:write",
    "reactions:read", "reactions:write",
    "users:read", "users:read.email",
    "search:read",
  ].join(",")
  url.searchParams.set("user_scope", userScopes)
  url.searchParams.set("redirect_uri", `${origin}/api/auth/slack/callback`)
  url.searchParams.set("state", state)

  return NextResponse.redirect(url)
}
