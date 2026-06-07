import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

// Completes the per-agent Slack OAuth flow: exchanges the code and stores
// the user token in agents.slack_token for the signed-in agent.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const settings = (notice: string) =>
    NextResponse.redirect(new URL(`/settings?notice=${notice}`, origin))

  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const cookieStore = await cookies()
  const expectedState = cookieStore.get("slack_oauth_state")?.value
  cookieStore.delete("slack_oauth_state")

  if (!code || !state || state !== expectedState) {
    return settings("slack-failed")
  }

  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return settings("slack-unavailable")
  }

  const email = await getSignedInEmail()
  const adminClient = getSupabaseAdminClient()
  if (!email || !adminClient) {
    return settings("slack-failed")
  }

  try {
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${origin}/api/auth/slack/callback`,
      }),
    })
    const data = (await res.json()) as {
      ok: boolean
      authed_user?: { access_token?: string }
    }

    const token = data.ok ? data.authed_user?.access_token : null
    if (!token) {
      return settings("slack-failed")
    }

    await adminClient
      .from("agents")
      .update({ slack_token: token })
      .eq("email", email)

    return settings("slack-connected")
  } catch {
    return settings("slack-failed")
  }
}
