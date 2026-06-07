import Link from "next/link"
import { Suspense } from "react"
import { MailIcon, PenSquareIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { getAgentTokens } from "@/lib/auth"
import { getInboxThreads } from "@/lib/gmail-client"
import { GmailFilterBar } from "@/components/gmail-filter-bar"
import { GmailThreadList } from "@/components/gmail-thread-list"
import { getFilterQuery } from "@/lib/gmail-filters"

export const dynamic = "force-dynamic"

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
        ) : (
          <GmailThreadList threads={sortedThreads} connected={inbox.connected} filter={filter ?? "primary"} />
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
