import { NextResponse, type NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request })
  const hasAuthCookie = request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("auth-token"))

  if (!hasAuthCookie) {
    const { pathname } = request.nextUrl
    if (
      pathname.startsWith("/login") ||
      pathname.startsWith("/api/auth")
    ) {
      return supabaseResponse
    }
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = "/login"
    return NextResponse.redirect(loginUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
