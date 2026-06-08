import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Read-only context — session refresh handled by middleware
          }
        },
      },
    }
  )
}

export async function getSignedInUser(): Promise<{ email: string | null; avatarUrl: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { email: null, avatarUrl: null }

  // Fetch avatar from agents table (written by OAuth callback).
  const adminClient = getSupabaseAdminClient()
  let avatarUrl: string | null = null
  if (adminClient) {
    const { data } = await adminClient
      .from("agents")
      .select("avatar_url")
      .eq("email", user.email)
      .maybeSingle()
    avatarUrl = data?.avatar_url ?? null
  }

  return { email: user.email, avatarUrl }
}

/** @deprecated Use getSignedInUser() instead. */
export async function getSignedInEmail(): Promise<string | null> {
  const { email } = await getSignedInUser()
  return email
}

export type AgentTokens = {
  email: string | null
  googleToken: string | null
  slackToken: string | null
  notionToken: string | null
}

// Per-agent integration tokens from the agents table, one query.
// Google is written at sign-in callback; Slack/Notion at their OAuth callbacks.
export async function getAgentTokens(): Promise<AgentTokens> {
  const empty: AgentTokens = { email: null, googleToken: null, slackToken: null, notionToken: null }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )

  // getUser() validates with server; getSession() reads the cookie and includes provider_token
  const [{ data: { user } }, { data: { session } }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ])

  const email = user?.email ?? null
  if (!email) return empty

  // Prefer provider_token from the live session — it's always the freshest Google access token.
  // Falls back to the DB-stored token (written at callback, valid ~1 h).
  const sessionGoogleToken = session?.provider_token ?? null

  const adminClient = getSupabaseAdminClient()
  if (!adminClient) return { ...empty, email, googleToken: sessionGoogleToken }

  const { data } = await adminClient
    .from("agents")
    .select("google_token, slack_token, notion_token")
    .eq("email", email)
    .maybeSingle()

  const googleToken = sessionGoogleToken ?? data?.google_token ?? null

  // Sync fresh session token back to DB in the background when it differs.
  if (sessionGoogleToken && adminClient && sessionGoogleToken !== data?.google_token) {
    void Promise.resolve(
      adminClient
        .from("agents")
        .update({ google_token: sessionGoogleToken })
        .eq("email", email)
    ).catch((e) => console.error("Failed to sync google_token:", e))
  }

  return {
    email,
    googleToken,
    slackToken: data?.slack_token ?? null,
    notionToken: data?.notion_token ?? null,
  }
}

// Refreshes the Google OAuth access token using the stored refresh token.
// Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env (same credentials
// configured in Supabase Auth → Providers → Google).
export async function refreshGoogleToken(email: string): Promise<string | null> {
  const adminClient = getSupabaseAdminClient()
  if (!adminClient) return null

  const { data } = await adminClient
    .from("agents")
    .select("google_refresh_token")
    .eq("email", email)
    .maybeSingle()

  const refreshToken = data?.google_refresh_token
  if (!refreshToken) return null

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    const json = (await res.json()) as { access_token?: string }
    if (!json.access_token) return null

    await adminClient
      .from("agents")
      .update({ google_token: json.access_token })
      .eq("email", email)

    return json.access_token
  } catch {
    return null
  }
}

// Fetch wrapper that auto-refreshes the Google token on 401.
// Returns null if there's no token or refresh fails.
export async function googleFetch(
  email: string | null,
  token: string | null,
  url: string,
  init?: RequestInit
): Promise<Response | null> {
  if (!token) return null

  const res = await fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    next: { revalidate: 0 },
  })

  if (res.status !== 401) return res
  if (!email) return null

  const newToken = await refreshGoogleToken(email)
  if (!newToken) return null

  return fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${newToken}` },
    next: { revalidate: 0 },
  })
}
