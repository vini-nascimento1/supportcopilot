import Image from "next/image"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

const errorMessages: Record<string, string> = {
  oauth_failed: "Could not start Google sign-in. Please try again.",
  no_code: "OAuth callback was missing an auth code. Please try again.",
  exchange_failed: "Session exchange failed. Please try again.",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const errorMessage = error ? (errorMessages[error] ?? "Sign-in failed. Please try again.") : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-[360px] flex-col gap-8">

        {/* brand */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center overflow-hidden rounded-2xl border shadow-sm">
            <Image
              src="/fanvue-logo.png"
              alt="Fanvue"
              width={56}
              height={56}
              priority
              className="size-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Fanvue Support Copilot</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your AI-powered support dashboard
            </p>
          </div>
        </div>

        {/* card */}
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">Sign in to continue</h2>
            <p className="text-xs text-muted-foreground">
              Uses your <strong>@fanvue.com</strong> Google Workspace account.
            </p>
          </div>

          {errorMessage && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {errorMessage}
            </div>
          )}

          <Button className="w-full" size="lg" asChild>
            <a href="/api/auth/login">
              {/* Google icon (inline SVG — no extra dep) */}
              <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </a>
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Access restricted to Fanvue team members only.
        </p>
      </div>
    </div>
  )
}
