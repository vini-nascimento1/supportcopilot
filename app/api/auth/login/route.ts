import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { origin } = new URL(request.url)
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

  // Force the full Google consent screen only the first time this browser
  // signs in (or after a revoke) — that's the only case where we actually
  // need it to guarantee a refresh_token comes back. Once `gauth_consented`
  // is set (see callback route), skip `prompt` entirely so returning agents
  // aren't re-shown the same permission screen on every login.
  const hasConsentedBefore = cookieStore.get("gauth_consented")?.value === "1"

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/api/auth/callback`,
      queryParams: {
        access_type: "offline",
        hd: "fanvue.com",
        ...(hasConsentedBefore ? {} : { prompt: "consent" }),
      },
      scopes: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.modify",
    },
  })

  if (error || !data.url) {
    return NextResponse.redirect(new URL("/login?error=oauth_failed", origin))
  }

  return NextResponse.redirect(data.url)
}
