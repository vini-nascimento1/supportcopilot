import Link from "next/link"
import { MessageSquareIcon, ExternalLinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  ConnectedStatus,
  LoadErrorBody,
  LoadErrorStatus,
  NotConnectedStatus,
} from "@/components/cards/connection-status"

import type { SlackUnreadResult } from "@/lib/slack"

export function SlackMiniCard({
  slack,
}: {
  slack: SlackUnreadResult
}) {
  if (!slack.connected) {
    const hasError = "error" in slack && slack.error
    return (
      <Card className="flex h-full flex-col overflow-hidden border-dashed">
        <CardHeader className="drag-handle cursor-grab pb-3 active:cursor-grabbing">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MessageSquareIcon className="size-4 text-muted-foreground" />
              Slack
            </CardTitle>
            {hasError ? <LoadErrorStatus /> : <NotConnectedStatus />}
          </div>
          {!hasError && (
            <CardDescription className="text-xs">
              Connect your Slack to see unread conversations across channels and DMs.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 pt-0">
          {hasError ? (
            <LoadErrorBody message={slack.error!} />
          ) : (
            <>
              <MessageSquareIcon className="size-8 text-muted-foreground/30" />
              <Button size="sm" variant="outline" asChild>
                <a href="/api/auth/slack">Connect Slack</a>
              </Button>
            </>
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
            <MessageSquareIcon className="size-4 text-muted-foreground" />
            Slack
          </CardTitle>
          <div className="flex items-center gap-2">
            <ConnectedStatus />
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
              <a href={slack.workspaceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open Slack workspace">
                Open <ExternalLinkIcon className="size-3" />
              </a>
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          Unread Slack conversations across channels and DMs
        </CardDescription>
      </CardHeader>
      <CardContent
        aria-live="polite"
        aria-relevant="additions text"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 pt-0 text-center"
      >
        {slack.unreadCount === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="text-xl">✅</span>
            <p className="text-sm text-muted-foreground">All caught up</p>
            <Link
              href="/slack"
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Open Slack →
            </Link>
          </div>
        ) : (
          <>
            <Link
              href="/slack"
              className="rounded-md hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${slack.unreadCount} unread Slack ${slack.unreadCount === 1 ? "conversation" : "conversations"}. Open Slack.`}
            >
              <span aria-hidden="true" className="text-5xl font-bold tabular-nums">{slack.unreadCount}</span>
            </Link>
            <p aria-hidden="true" className="text-sm text-muted-foreground">
              unread {slack.unreadCount === 1 ? "conversation" : "conversations"}
            </p>
            <Link href="/slack" className="mt-2 text-xs text-primary hover:underline">
              Open Slack →
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  )
}
