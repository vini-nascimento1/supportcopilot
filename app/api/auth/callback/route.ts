import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=no_code", origin))
  }

  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.session) {
    return NextResponse.redirect(new URL("/login?error=exchange_failed", origin))
  }

  // Store Google tokens independently from user_id so OAuth-backed integrations
  // work even if the auth/RLS migration has not reached a deployment yet.
  const adminClient = getSupabaseAdminClient()
  if (adminClient && data.session.user.email) {
    const email = data.session.user.email
    const name = data.session.user.user_metadata?.full_name ?? null

    // Upsert agent without touching google_refresh_token — only update it below
    // when Google actually sends one (first login or explicit re-consent).
    const { error: upsertError } = await adminClient.from("agents").upsert(
      { email, name, google_token: data.session.provider_token ?? null },
      { onConflict: "email" }
    )
    if (upsertError) console.error("Failed to upsert agent record", upsertError)

    // Only persist the refresh token when Google sends a new one — avoids
    // overwriting a valid stored token with null on re-logins.
    if (data.session.provider_refresh_token) {
      await adminClient
        .from("agents")
        .update({ google_refresh_token: data.session.provider_refresh_token })
        .eq("email", email)
    }

    const { error: userIdError } = await adminClient
      .from("agents")
      .update({ user_id: data.session.user.id })
      .eq("email", email)

    if (userIdError && userIdError.code !== "PGRST204") {
      console.error("Failed to link Supabase auth user to agent", userIdError)
    }
  }

  return NextResponse.redirect(new URL("/", origin))
}
