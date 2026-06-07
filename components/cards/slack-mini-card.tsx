import Link from "next/link"
import { MessageSquareIcon, GripVertical, ExternalLinkIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

function ConnectBadge() {
  return <Badge variant="outline" className="shrink-0 text-xs font-normal text-muted-foreground">Not connected</Badge>
}
function ConnectedBadge() {
  return <Badge variant="secondary" className="shrink-0 bg-green-100 text-xs font-normal text-green-700 dark:bg-green-950 dark:text-green-400">Connected</Badge>
}

export function SlackMiniCard({
  slack,
}: {
  slack: { connected: boolean; unreadCount: number; workspaceUrl: string }
}) {
  if (!slack.connected) {
    return (
      <Card className="flex h-full flex-col overflow-hidden border-dashed">
        <CardHeader className="drag-handle cursor-grab pb-3 active:cursor-grabbing">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <GripVertical className="size-3.5 text-muted-foreground/40" />
              <MessageSquareIcon className="size-4 text-muted-foreground" />
              Slack
            </CardTitle>
            <ConnectBadge />
          </div>
          <CardDescription className="text-xs">
            Connect your Slack to see unread conversations across channels and DMs.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 pt-0">
          <MessageSquareIcon className="size-8 text-muted-foreground/30" />
          <Button size="sm" variant="outline" asChild>
            <a href="/api/auth/slack">Connect Slack</a>
          </Button>
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
            Slack
          </CardTitle>
          <div className="flex items-center gap-2">
            <ConnectedBadge />
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
              <a href={slack.workspaceUrl} target="_blank" rel="noopener noreferrer">
                Open <ExternalLinkIcon className="size-3" />
              </a>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 pt-0 text-center">
        <Link href="/slack" className="hover:opacity-80">
          <span className="text-5xl font-bold tabular-nums">{slack.unreadCount}</span>
        </Link>
        <p className="text-sm text-muted-foreground">
          unread {slack.unreadCount === 1 ? "conversation" : "conversations"}
        </p>
        <Link href="/slack" className="mt-2 text-xs text-primary hover:underline">
          Open Slack →
        </Link>
      </CardContent>
    </Card>
  )
}
