import { cookies } from "next/headers"
import { NextResponse } from "next/server"

/**
 * Starts the per-agent Notion OAuth flow (TODO 3.4).
 *
 * Requires NOTION_CLIENT_ID / NOTION_CLIENT_SECRET (public integration —
 * admin setup, documented in web/README.md, never surfaced in the UI).
 * If the integration isn't configured yet, redirect back to /settings
 * with a friendly notice instead of erroring.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url)

  const clientId = process.env.NOTION_CLIENT_ID
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/settings?notice=notion-unavailable", origin)
    )
  }

  // CSRF state, verified in the callback.
  const state = crypto.randomUUID()
  const cookieStore = await cookies()
  cookieStore.set("notion_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  })

  const url = new URL("https://api.notion.com/v1/oauth/authorize")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("owner", "user")
  url.searchParams.set("redirect_uri", `${origin}/api/auth/notion/callback`)
  url.searchParams.set("state", state)

  return NextResponse.redirect(url)
}
