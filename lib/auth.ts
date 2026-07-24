import "server-only"

import { cache } from "react"
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

// Every page independently calls getSignedInUser() (sidebar) and/or
// getAgentTokens() (integration tokens) — without request-scoped memoization
// that meant 2 supabase.auth network round trips + 2 identical `agents`
// SELECTs per navigation. React's cache() dedupes each of these to run once
// per request, however many callers ask for them.
const getAuthUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

const getAuthSession = cache(async () => {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session
})

const getAgentRow = cache(async (email: string) => {
  const adminClient = getSupabaseAdminClient()
  if (!adminClient) return null
  const { data } = await adminClient
    .from("agents")
    .select("avatar_url, name, google_token, slack_token, notion_token")
    .eq("email", email)
    .maybeSingle()
  return data
})

export async function getSignedInUser(): Promise<{ email: string | null; avatarUrl: string | null }> {
  const user = await getAuthUser()
  if (!user?.email) return { email: null, avatarUrl: null }

  const row = await getAgentRow(user.email)
  return { email: user.email, avatarUrl: row?.avatar_url ?? null }
}

/** @deprecated Use getSignedInUser() instead. */
export async function getSignedInEmail(): Promise<string | null> {
  const { email } = await getSignedInUser()
  return email
}

// Resolve a signed-in agent's Intercom admin ID from the agents table, falling
// back to the shared env var. Returns null when neither is available.
export async function resolveIntercomAdminId(email: string): Promise<string | null> {
  const adminClient = getSupabaseAdminClient()
  if (!adminClient) return process.env.INTERCOM_ADMIN_ID ?? null

  const { data } = await adminClient
    .from("agents")
    .select("intercom_admin_id")
    .eq("email", email)
    .maybeSingle()

  return data?.intercom_admin_id ?? process.env.INTERCOM_ADMIN_ID ?? null
}

// One-stop lookup for both the agent's given name and Intercom admin id. Used
// by the draft routes that need the "written by X" label alongside the admin id.
export async function getAgentNameAndAdminId(email: string): Promise<{ name: string; intercomAdminId: string | null }> {
  const adminClient = getSupabaseAdminClient()
  if (!adminClient) return { name: "the support team", intercomAdminId: null }
  const { data } = await adminClient
    .from("agents")
    .select("name, intercom_admin_id")
    .eq("email", email)
    .maybeSingle()
  return {
    name: data?.name?.split(" ")[0] ?? "the support team",
    intercomAdminId: (data?.intercom_admin_id as string | undefined) ?? null,
  }
}

export type AgentTokens = {
  email: string | null
  name: string | null
  googleToken: string | null
  slackToken: string | null
  notionToken: string | null
}

// Per-agent integration tokens from the agents table, one query.
// Google is written at sign-in callback; Slack/Notion at their OAuth callbacks.
export async function getAgentTokens(): Promise<AgentTokens> {
  const empty: AgentTokens = { email: null, name: null, googleToken: null, slackToken: null, notionToken: null }

  // getUser() validates with server; getSession() reads the cookie and includes provider_token
  const [user, session] = await Promise.all([getAuthUser(), getAuthSession()])

  const email = user?.email ?? null
  if (!email) return empty

  // Prefer provider_token from the live session — it's always the freshest Google access token.
  // Falls back to the DB-stored token (written at callback, valid ~1 h).
  const sessionGoogleToken = session?.provider_token ?? null

  const adminClient = getSupabaseAdminClient()
  if (!adminClient) return { ...empty, email, googleToken: sessionGoogleToken }

  const data = await getAgentRow(email)

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
    name: data?.name ?? null,
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
