import Link from "next/link"
import { MailIcon, ExternalLinkIcon, RefreshCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  ConnectedStatus,
  LoadErrorBody,
  LoadErrorStatus,
  NotConnectedStatus,
} from "@/components/cards/connection-status"
import { LastUpdated } from "@/components/cards/last-updated"
import type { GmailResult } from "@/lib/gmail-client"

export function GmailCard({
  gmail,
  lastUpdatedIso = null,
}: {
  gmail: GmailResult
  lastUpdatedIso?: string | null
}) {
  if (!gmail.connected) {
    const hasError = "error" in gmail && gmail.error
    return (
      <Card className="flex h-full flex-col overflow-hidden border-dashed">
        <CardHeader className="drag-handle cursor-grab pb-3 active:cursor-grabbing">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MailIcon className="size-4 text-muted-foreground" />
              Gmail
            </CardTitle>
            {hasError ? <LoadErrorStatus /> : <NotConnectedStatus />}
          </div>
          {!hasError && (
            <CardDescription className="text-xs">
              Uses the same <span className="font-medium">@fanvue.com</span> Google sign-in as Calendar.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="min-h-0 flex-1 pt-0">
          {hasError ? (
            <LoadErrorBody message={gmail.error!} />
          ) : (
            <Button size="sm" variant="outline" className="w-full" asChild>
              <a href="/api/auth/login">Sign in with Google</a>
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="drag-handle shrink-0 cursor-grab pb-3 active:cursor-grabbing">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <MailIcon className="size-4 text-muted-foreground" />
            Gmail
          </CardTitle>
          <div className="flex items-center gap-2">
            <ConnectedStatus />
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
              <a href={gmail.inboxLink} target="_blank" rel="noopener noreferrer" aria-label="Open Gmail inbox">
                Open <ExternalLinkIcon className="size-3" />
              </a>
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <CardDescription className="text-xs">
            Unread emails in your @fanvue.com inbox
          </CardDescription>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("refresh-gmail"))}
              className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Refresh Gmail"
            >
              <RefreshCcwIcon className="size-3" />
            </button>
            <LastUpdated iso={lastUpdatedIso} />
          </div>
        </div>
      </CardHeader>
      <CardContent
        aria-live="polite"
        aria-relevant="additions text"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 pt-0 text-center"
      >
        {gmail.unreadCount === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/40 py-8 text-center">
            <span className="text-xl">✅</span>
            <p className="text-sm text-muted-foreground">Inbox clear</p>
            <Link
              href="/gmail"
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Open inbox →
            </Link>
          </div>
        ) : (
          <>
            <Link
              href="/gmail"
              className="rounded-md hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${gmail.unreadCount} unread ${gmail.unreadCount === 1 ? "email" : "emails"} in Gmail. Open inbox.`}
            >
              <span aria-hidden="true" className="text-5xl font-bold tabular-nums">{gmail.unreadCount}</span>
            </Link>
            <p aria-hidden="true" className="text-sm text-muted-foreground">unread {gmail.unreadCount === 1 ? "email" : "emails"}</p>
            <Link href="/gmail" className="mt-2 text-xs text-primary hover:underline">
              Open inbox →
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  )
}
