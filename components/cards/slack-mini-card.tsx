"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { GripVertical, MessageSquareIcon, RefreshCwIcon, ExternalLinkIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { SlackFeedResult, SlackMessage } from "@/lib/slack"

// ── Slack text renderer ────────────────────────────────────────

function parseSlackText(text: string): string {
  return text
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2")   // <url|display> → display
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")               // <url> → url
    .replace(/<@[A-Z0-9]+\|([^>]+)>/g, "@$1")            // <@U|name> → @name
    .replace(/<@([A-Z0-9]+)>/g, "@$1")                    // <@U> → @U
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")            // <#C|name> → #name
    .trim()
}

function formatSlackTs(ts: string): string {
  const ms = parseFloat(ts) * 1000
  const d = new Date(ms)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  }
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Message component ──────────────────────────────────────────

function SlackMsg({ msg, prevMsg }: { msg: SlackMessage; prevMsg?: SlackMessage }) {
  const grouped =
    prevMsg?.userId === msg.userId &&
    Math.abs(parseFloat(msg.ts) - parseFloat(prevMsg.ts)) < 300 // < 5 min

  if (grouped) {
    return (
      <div className="group flex items-start gap-2 px-3 py-0.5 hover:bg-muted/40">
        <div className="w-7 shrink-0" />
        <p className="flex-1 whitespace-pre-wrap break-words text-sm leading-snug text-foreground">
          {parseSlackText(msg.text)}
        </p>
        <span className="shrink-0 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">
          {formatSlackTs(msg.ts)}
        </span>
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-2 px-3 py-1.5 hover:bg-muted/40">
      <div
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
        style={{ backgroundColor: msg.userColor }}
      >
        {initials(msg.userName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold leading-tight">{msg.userName}</span>
          <span className="text-[10px] text-muted-foreground">{formatSlackTs(msg.ts)}</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-snug text-foreground">
          {parseSlackText(msg.text)}
        </p>
        {msg.threadCount && msg.threadCount > 0 ? (
          <p className="mt-0.5 text-[10px] text-primary">
            {msg.threadCount} {msg.threadCount === 1 ? "reply" : "replies"}
          </p>
        ) : null}
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

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [feed, activeChannel])

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

  // Not connected state
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
              <a href={workspaceUrl} target="_blank" rel="noopener noreferrer">
                Open <ExternalLinkIcon className="size-3" />
              </a>
            </Button>
          </div>
        </div>

        {/* Channel tabs */}
        {channels.length > 1 && (
          <div className="flex gap-1 overflow-x-auto pb-1 pt-2 [scrollbar-width:none]">
            {channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => setActiveChannel(ch.id)}
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeChannel === ch.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {ch.name}
              </button>
            ))}
          </div>
        )}
        {channels.length === 1 && (
          <p className="pt-1 text-xs text-muted-foreground">{channels[0]?.name} · support channel</p>
        )}
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
                <SlackMsg key={msg.id} msg={msg} prevMsg={activeMessages[i - 1]} />
              ))}
            </div>
            <div ref={messagesEndRef} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
