"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import {
  GripVertical,
  MessageSquareIcon,
  RefreshCwIcon,
  ExternalLinkIcon,
  ChevronDownIcon,
  MessageSquareReplyIcon,
  Loader2Icon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import type { SlackFeedResult, SlackMessage, SlackThreadReply } from "@/lib/slack"
import { getMessagePermalink } from "@/lib/slack-utils"

// ── Helpers ────────────────────────────────────────────────────

function parseSlackText(text: string): string {
  return text
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/<@[A-Z0-9]+\|([^>]+)>/g, "@$1")
    .replace(/<@([A-Z0-9]+)>/g, "@$1")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .trim()
}

function relativeTime(ts: string): string {
  const ms = parseFloat(ts) * 1000
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const d = new Date(ms)
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Thread replies component ───────────────────────────────────

function ThreadRepliesView({
  replies,
  workspaceUrl,
  channelId,
}: {
  replies: SlackThreadReply[]
  workspaceUrl: string
  channelId: string
}) {
  if (replies.length === 0) return null

  return (
    <div className="ml-9 border-l-2 border-muted-foreground/20 pl-3 pt-1">
      {replies.map((reply) => (
        <div
          key={reply.id}
          className="group flex items-start gap-2 py-1 hover:bg-muted/30"
        >
          <div
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
            style={{ backgroundColor: reply.userColor }}
          >
            {initials(reply.userName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-semibold leading-tight">{reply.userName}</span>
              <span className="text-[10px] text-muted-foreground">{relativeTime(reply.ts)}</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-xs leading-snug text-foreground/90">
              {parseSlackText(reply.text)}
            </p>
          </div>
          <a
            href={getMessagePermalink(workspaceUrl, channelId, reply.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100"
            title="Open in Slack"
          >
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      ))}
    </div>
  )
}

// ── Message component ──────────────────────────────────────────

function SlackMsg({
  msg,
  channelId,
  workspaceUrl,
  prevMsg,
  threadReplies,
  threadLoading,
  threadExpanded,
  onToggleThread,
}: {
  msg: SlackMessage
  channelId: string
  workspaceUrl: string
  prevMsg?: SlackMessage
  threadReplies: SlackThreadReply[] | null
  threadLoading: boolean
  threadExpanded: boolean
  onToggleThread: () => void
}) {
  const isThreadReply = !!msg.parentTs
  const grouped =
    !isThreadReply &&
    prevMsg?.userId === msg.userId &&
    Math.abs(parseFloat(msg.ts) - parseFloat(prevMsg.ts)) < 300

  if (grouped) {
    return (
      <div className="group flex items-start gap-2 px-3 py-0.5 hover:bg-muted/30">
        <div className="w-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-sm leading-snug text-foreground">
            {parseSlackText(msg.text)}
          </p>
        </div>
        <a
          href={getMessagePermalink(workspaceUrl, channelId, msg.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100"
          title="Open in Slack"
        >
          <ExternalLinkIcon className="size-3" />
        </a>
      </div>
    )
  }

  return (
    <div className="group px-3 py-1.5 hover:bg-muted/30">
      <div className="flex items-start gap-2">
        <div
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
          style={{ backgroundColor: msg.userColor }}
        >
          {initials(msg.userName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold leading-tight">{msg.userName}</span>
            <span className="text-[10px] text-muted-foreground">{relativeTime(msg.ts)}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-snug text-foreground">
            {parseSlackText(msg.text)}
          </p>

          {/* Thread replies toggle */}
          {msg.threadCount && msg.threadCount > 0 && !isThreadReply && (
            <button
              onClick={onToggleThread}
              className="mt-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              {threadLoading ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <MessageSquareReplyIcon className="size-3" />
              )}
              {msg.threadCount} {msg.threadCount === 1 ? "reply" : "replies"}
              {threadExpanded && threadReplies && (
                <span className="ml-1 text-muted-foreground">· {threadReplies.length} loaded</span>
              )}
            </button>
          )}

          {/* Expanded thread replies */}
          {threadExpanded && threadReplies && (
            <ThreadRepliesView
              replies={threadReplies}
              workspaceUrl={workspaceUrl}
              channelId={channelId}
            />
          )}
        </div>

        {/* Hover action: Open in Slack */}
        <a
          href={getMessagePermalink(workspaceUrl, channelId, msg.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground/40 opacity-0 transition-opacity hover:bg-muted hover:text-muted-foreground group-hover:opacity-100"
          title="Open in Slack"
        >
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────

export function SlackMiniCard({ initialConnected }: { initialConnected: boolean }) {
  const [feed, setFeed] = useState<SlackFeedResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeChannel, setActiveChannel] = useState<string | null>(null)
  const [threadReplies, setThreadReplies] = useState<Record<string, SlackThreadReply[] | null>>({})
  const [threadLoading, setThreadLoading] = useState<Record<string, boolean>>({})
  const [threadExpanded, setThreadExpanded] = useState<Record<string, boolean>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchFeed = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch("/api/slack/feed")
      const data = (await res.json()) as SlackFeedResult
      setFeed(data)
      if (data.connected && data.channels.length > 0 && !activeChannel) {
        setActiveChannel(data.channels[0].id)
      }
    } catch {
      // keep last state on error
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeChannel])

  useEffect(() => {
    void fetchFeed()
    const timer = setInterval(() => void fetchFeed(), 30_000)
    return () => clearInterval(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when messages or active channel change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [feed, activeChannel])

  async function handleToggleThread(msgId: string, channelId: string, threadTs: string) {
    // If already expanded, collapse
    if (threadExpanded[msgId]) {
      setThreadExpanded((prev) => ({ ...prev, [msgId]: false }))
      return
    }

    // If already loaded, just expand
    if (threadReplies[msgId]) {
      setThreadExpanded((prev) => ({ ...prev, [msgId]: true }))
      return
    }

    // Fetch thread replies
    setThreadLoading((prev) => ({ ...prev, [msgId]: true }))
    setThreadExpanded((prev) => ({ ...prev, [msgId]: true }))
    try {
      const res = await fetch(`/api/slack/thread?channel=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(threadTs)}`)
      const data = await res.json() as { ok: boolean; replies?: SlackThreadReply[] }
      setThreadReplies((prev) => ({ ...prev, [msgId]: data.replies ?? null }))
    } catch {
      setThreadReplies((prev) => ({ ...prev, [msgId]: null }))
    } finally {
      setThreadLoading((prev) => ({ ...prev, [msgId]: false }))
    }
  }

  function ConnectedBadge() {
    return (
      <Badge variant="secondary" className="shrink-0 bg-green-100 text-xs font-normal text-green-700 dark:bg-green-950 dark:text-green-400">
        Connected
      </Badge>
    )
  }
  function ConnectBadge() {
    return (
      <Badge variant="outline" className="shrink-0 text-xs font-normal text-muted-foreground">
        Not connected
      </Badge>
    )
  }

  // ── Not connected state ──
  if (!initialConnected && (!feed || !feed.connected)) {
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
          <CardDescription className="text-xs">Connect Slack to see your support channels here.</CardDescription>
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

  const activeMessages: SlackMessage[] =
    feed?.connected && activeChannel ? (feed.messages[activeChannel] ?? []) : []

  const workspaceUrl = feed?.connected ? feed.workspaceUrl : "https://slack.com"
  const channels = feed?.connected ? feed.channels : []
  const activeChannelName = channels.find((c) => c.id === activeChannel)?.name ?? "Slack"

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="drag-handle shrink-0 cursor-grab pb-0 active:cursor-grabbing">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <GripVertical className="size-3.5 text-muted-foreground/40" />
            <MessageSquareIcon className="size-4 text-muted-foreground" />
            Slack
          </CardTitle>
          <div className="flex items-center gap-1">
            <ConnectedBadge />
            <button
              onClick={() => void fetchFeed(true)}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Refresh"
            >
              <RefreshCwIcon className={`size-3 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
              <a
                href={activeChannel ? getMessagePermalink(workspaceUrl, activeChannel, "") : workspaceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open <ExternalLinkIcon className="size-3" />
              </a>
            </Button>
          </div>
        </div>

        {/* Channel selector dropdown */}
        {channels.length > 1 ? (
          <div className="pt-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <span className="text-foreground">{activeChannelName}</span>
                  <ChevronDownIcon className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={activeChannel ?? undefined}
                  onValueChange={(value) => setActiveChannel(value)}
                >
                  {channels.map((ch) => (
                    <DropdownMenuRadioItem key={ch.id} value={ch.id}>
                      {ch.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : channels.length === 1 ? (
          <p className="pt-1 text-xs text-muted-foreground">{channels[0]?.name}</p>
        ) : null}
      </CardHeader>

      {/* Messages */}
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto p-0">
        {loading ? (
          <div className="flex flex-col gap-3 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-2">
                <Skeleton className="size-7 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-full" />
                  {i % 2 === 0 && <Skeleton className="h-3 w-3/4" />}
                </div>
              </div>
            ))}
          </div>
        ) : activeMessages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <MessageSquareIcon className="size-6 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {channels.length === 0 ? "No support channels configured." : "No messages yet."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col justify-end">
            <div className="py-1">
              {activeMessages.map((msg, i) => (
                <SlackMsg
                  key={msg.id}
                  msg={msg}
                  channelId={activeChannel!}
                  workspaceUrl={workspaceUrl}
                  prevMsg={activeMessages[i - 1]}
                  threadReplies={threadReplies[msg.id] ?? null}
                  threadLoading={!!threadLoading[msg.id]}
                  threadExpanded={!!threadExpanded[msg.id]}
                  onToggleThread={() => handleToggleThread(msg.id, activeChannel!, msg.threadTs ?? msg.ts)}
                />
              ))}
            </div>
            <div ref={messagesEndRef} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
