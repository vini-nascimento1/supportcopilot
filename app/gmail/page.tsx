import Link from "next/link"
import { Suspense } from "react"
import {
  MailIcon,
  MailOpenIcon,
  PenSquareIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { getAgentTokens } from "@/lib/auth"
import { getInboxThreads } from "@/lib/gmail-client"
import { GmailFilterBar, getFilterQuery } from "@/components/gmail-filter-bar"

export const dynamic = "force-dynamic"

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (isToday) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  }
  const isThisYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: isThisYear ? undefined : "numeric",
  })
}

function avatarLetter(name: string, email: string): string {
  const src = name || email
  return src.charAt(0).toUpperCase() || "?"
}

export default async function GmailPage({
  searchParams,
}: {
  searchParams: Promise<{ pageToken?: string; q?: string; filter?: string }>
}) {
  const { pageToken, q, filter } = await searchParams
  const tokens = await getAgentTokens()

  const query = q ?? getFilterQuery(filter ?? "primary")

  const inbox = await getInboxThreads(
    tokens.googleToken,
    tokens.email,
    pageToken ?? null,
    query
  )

  // Sort threads by date descending (newest first)
  const sortedThreads = inbox.connected
    ? [...inbox.threads].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    : []

  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="text-base font-medium">Gmail</h1>
          {inbox.connected && (
            <Badge variant="secondary" className="text-xs">
              ~{inbox.resultSizeEstimate} threads
            </Badge>
          )}
        </div>
        <Button size="sm" asChild>
          <Link href="/gmail/compose">
            <PenSquareIcon className="size-3.5" />
            Compose
          </Link>
        </Button>
      </header>

      <main className="flex flex-col">
        {/* Filter bar */}
        <Suspense>
          <GmailFilterBar />
        </Suspense>

        {!inbox.connected ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <MailIcon className="size-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium">Gmail not connected</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in with your @fanvue.com Google account to see your inbox.
              </p>
            </div>
            <Button asChild>
              <a href="/api/auth/login">Sign in with Google</a>
            </Button>
          </div>
        ) : inbox.threads.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <MailOpenIcon className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Your inbox is empty.</p>
          </div>
        ) : (
          <div className="divide-y">
            {sortedThreads.map((thread) => (
              <Link
                key={thread.id}
                href={`/gmail/${thread.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 lg:px-6"
              >
                {/* Avatar */}
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {avatarLetter(thread.fromName, thread.from)}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={`truncate text-sm ${thread.isUnread ? "font-semibold" : "font-medium text-muted-foreground"}`}
                    >
                      {thread.fromName || thread.from}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(thread.date)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <p
                      className={`truncate text-sm ${thread.isUnread ? "font-medium" : "text-muted-foreground"}`}
                    >
                      {thread.subject}
                    </p>
                    {thread.messageCount > 1 && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        ({thread.messageCount})
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {thread.snippet}
                  </p>
                </div>

                {/* Unread dot */}
                {thread.isUnread && (
                  <div className="size-2 shrink-0 rounded-full bg-primary" />
                )}
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {inbox.connected && inbox.nextPageToken && (
          <div className="flex justify-center border-t p-4">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/gmail?pageToken=${inbox.nextPageToken}${filter ? `&filter=${filter}` : q ? `&q=${encodeURIComponent(q)}` : ""}`}>
                Load more
              </Link>
            </Button>
          </div>
        )}
      </main>
    </WorkspaceLayout>
  )
}
