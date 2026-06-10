import Link from "next/link"
import { ChevronRightIcon, ArrowRightIcon, MessageSquareIcon, ExternalLinkIcon, RefreshCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ConnectedStatus,
  LoadErrorBody,
  LoadErrorStatus,
  NotConnectedStatus,
} from "@/components/cards/connection-status"
import { LastUpdated } from "@/components/cards/last-updated"
import type { CasesQueueData } from "@/lib/intercom"

export function IntercomCard({
  cases,
  appId,
  lastUpdatedIso = null,
}: {
  cases: CasesQueueData
  appId: string
  lastUpdatedIso?: string | null
}) {
  const inboxLink = `https://app.intercom.com/a/inbox/${appId}/inbox/all`

  if (cases.mode === "demo") {
    return (
      <Card className="flex h-full flex-col overflow-hidden border-dashed">
        <CardHeader className="drag-handle cursor-grab pb-3 active:cursor-grabbing">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MessageSquareIcon className="size-4 text-muted-foreground" />
              Intercom
            </CardTitle>
            <NotConnectedStatus />
          </div>
          <CardDescription className="text-xs">Your case queue will appear here once Intercom is connected.</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto pt-0">
          <p className="mb-3 text-xs text-muted-foreground">
            Intercom requires <code className="rounded bg-muted px-1">INTERCOM_ACCESS_TOKEN</code> in environment configuration.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (cases.mode === "error") {
    return (
      <Card className="flex h-full flex-col overflow-hidden border-dashed">
        <CardHeader className="drag-handle cursor-grab pb-3 active:cursor-grabbing">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MessageSquareIcon className="size-4 text-muted-foreground" />
              Intercom
            </CardTitle>
            <LoadErrorStatus />
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col pt-0">
          <LoadErrorBody message={cases.error ?? "Couldn't load Intercom queue."} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="drag-handle shrink-0 cursor-grab pb-3 active:cursor-grabbing">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <MessageSquareIcon className="size-4 text-muted-foreground" />
            Intercom
          </CardTitle>
          <div className="flex items-center gap-2">
            <ConnectedStatus />
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
              <a href={inboxLink} target="_blank" rel="noopener noreferrer" aria-label="Open Intercom inbox">
                Open in Intercom <ExternalLinkIcon className="size-3" />
              </a>
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <CardDescription className="text-xs">
            {cases.rows.length === 0
              ? "No open cases assigned to you"
              : `${cases.rows.length} open case${cases.rows.length === 1 ? "" : "s"} assigned to you`}
          </CardDescription>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("refresh-intercom"))}
              className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Refresh Intercom cases"
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
        className="min-h-0 flex-1 overflow-y-auto pt-0"
      >
        {cases.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-muted/40 py-6 text-center">
            <span className="text-xl">✅</span>
            <p className="text-sm text-muted-foreground">Queue is clear!</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {cases.rows.slice(0, 8).map((row) => (
              <Link
                key={row.id}
                href={`/cases/${row.id}`}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Open case from ${row.customer}: ${row.snippet}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{row.customer}</p>
                  {row.email && (
                    <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                  )}
                  <p className="truncate text-xs text-muted-foreground">{row.snippet}</p>
                </div>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </Link>
            ))}
            {cases.rows.length > 8 && (
              <Link
                href="/cases"
                className="mt-1 flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                +{cases.rows.length - 8} more <ArrowRightIcon className="size-3" />
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
