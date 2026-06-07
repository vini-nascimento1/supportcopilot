import Link from "next/link"
import { ChevronRightIcon, ArrowRightIcon, MessageSquareIcon, GripVertical, ExternalLinkIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { CasesQueueData } from "@/lib/intercom"

function ConnectBadge() {
  return <Badge variant="outline" className="shrink-0 text-xs font-normal text-muted-foreground">Not connected</Badge>
}
function ConnectedBadge() {
  return <Badge variant="secondary" className="shrink-0 bg-green-100 text-xs font-normal text-green-700 dark:bg-green-950 dark:text-green-400">Connected</Badge>
}

export function IntercomCard({ cases, appId }: { cases: CasesQueueData; appId: string }) {
  const inboxLink = `https://app.intercom.com/a/inbox/${appId}/inbox/all`

  if (cases.mode === "demo") {
    return (
      <Card className="flex h-full flex-col overflow-hidden border-dashed">
        <CardHeader className="drag-handle cursor-grab pb-3 active:cursor-grabbing">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <GripVertical className="size-3.5 text-muted-foreground/40" />
              <MessageSquareIcon className="size-4 text-muted-foreground" />
              Intercom
            </CardTitle>
            <ConnectBadge />
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

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="drag-handle shrink-0 cursor-grab pb-3 active:cursor-grabbing">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <GripVertical className="size-3.5 text-muted-foreground/40" />
            <MessageSquareIcon className="size-4 text-muted-foreground" />
            Intercom
          </CardTitle>
          <div className="flex items-center gap-2">
            <ConnectedBadge />
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
              <a href={inboxLink} target="_blank" rel="noopener noreferrer">
                Open in Intercom <ExternalLinkIcon className="size-3" />
              </a>
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          {cases.rows.length === 0
            ? "No open cases assigned to you"
            : `${cases.rows.length} open case${cases.rows.length === 1 ? "" : "s"} assigned to you`}
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto pt-0">
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
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{row.customer}</p>
                  {row.email && (
                    <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                  )}
                  <p className="truncate text-xs text-muted-foreground">{row.snippet}</p>
                </div>
                <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
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
