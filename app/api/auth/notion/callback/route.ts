import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

// Completes the per-agent Notion OAuth flow: exchanges the code and stores
// the access token in agents.notion_token for the signed-in agent.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const settings = (notice: string) =>
    NextResponse.redirect(new URL(`/settings?notice=${notice}`, origin))

  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const cookieStore = await cookies()
  const expectedState = cookieStore.get("notion_oauth_state")?.value
  cookieStore.delete("notion_oauth_state")

  if (!code || !state || state !== expectedState) {
    return settings("notion-failed")
  }

  const clientId = process.env.NOTION_CLIENT_ID
  const clientSecret = process.env.NOTION_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return settings("notion-unavailable")
  }

  const email = await getSignedInEmail()
  const adminClient = getSupabaseAdminClient()
  if (!email || !adminClient) {
    return settings("notion-failed")
  }

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    const res = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${origin}/api/auth/notion/callback`,
      }),
    })
    const data = (await res.json()) as { access_token?: string }

    if (!data.access_token) {
      return settings("notion-failed")
    }

    await adminClient
      .from("agents")
      .update({ notion_token: data.access_token })
      .eq("email", email)

    return settings("notion-connected")
  } catch {
    return settings("notion-failed")
  }
}
