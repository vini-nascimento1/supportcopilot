import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Validate the session server-side (not just checking cookies).
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Machine-to-machine endpoints that authenticate via a shared secret / signature
  // header (NOT a user session) — they must NOT be redirected to /login, or the
  // caller (pg_cron, Intercom webhook) can never reach the handler. Each route
  // enforces its own auth (CRON_SECRET, webhook signature).
  const isMachineRoute =
    pathname === "/api/automation/sweep" ||
    pathname === "/api/cron/refresh-metrics" ||
    pathname.startsWith("/api/webhooks/")

  // Allow unauthenticated access to the login page, auth API routes, and machine routes.
  if (
    !user &&
    pathname !== "/login" &&
    !pathname.startsWith("/api/auth") &&
    !isMachineRoute
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  // Redirect logged-in users away from the login page.
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|version\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
