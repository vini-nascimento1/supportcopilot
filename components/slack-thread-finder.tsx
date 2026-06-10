"use client"

import { useState, useEffect, useCallback } from "react"
import {
  MessageSquareIcon,
  Loader2Icon,
  AlertCircleIcon,
  ExternalLinkIcon,
  InfoIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const POLL_INTERVAL_MS = 60_000

type ThreadInfo = {
  ts: string
  channelId: string
  channelName: string
  snippet: string
  participantCount: number
  participantNames: string[]
  messageCount: number
  permalink: string | null
}

type ThreadReply = {
  userName: string
  text: string
  ts: string
}

type FetchState =
  | { status: "loading" }
  | { status: "no_email" }
  | { status: "missing_scope" }
  | { status: "auth_required" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "loaded"; threads: ThreadInfo[] }

interface Props {
  conversationId: string
  customerEmail: string | null
  onGenerateDraft: (body: string) => void
}

export function SlackThreadFinder({
  conversationId,
  customerEmail,
  onGenerateDraft,
}: Props) {
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" })
  const [generating, setGenerating] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [threadReplies, setThreadReplies] = useState<ThreadReply[] | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)

  const fetchThreads = useCallback(async () => {
    if (!customerEmail) {
      setFetchState({ status: "no_email" })
      return
    }

    try {
      const res = await fetch(`/api/slack/case-threads?conversationId=${encodeURIComponent(conversationId)}`)
      const data = await res.json() as {
        ok: boolean
        threads?: ThreadInfo[]
        error?: string
        detail?: string
      }

      if (!data.ok) {
        if (data.error === "no_email") {
          setFetchState({ status: "no_email" })
        } else if (data.error === "missing_scope") {
          setFetchState({ status: "missing_scope" })
        } else if (data.error === "auth_required") {
          setFetchState({ status: "auth_required" })
        } else {
          setFetchState({ status: "error", message: data.detail ?? data.error ?? "Search failed" })
        }
        return
      }

      if (!data.threads || data.threads.length === 0) {
        setFetchState({ status: "empty" })
        return
      }

      // Reset expanded state when threads refresh
      setExpanded(false)
      setThreadReplies(null)
      setFetchState({ status: "loaded", threads: data.threads })
    } catch {
      setFetchState({ status: "error", message: "Network error" })
    }
  }, [conversationId, customerEmail])

  // Poll on mount and every POLL_INTERVAL_MS
  useEffect(() => {
    fetchThreads()
    const id = setInterval(fetchThreads, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchThreads])

  async function handleExpand(channelId: string, threadTs: string) {
    if (expanded && threadReplies) {
      setExpanded(false)
      return
    }

    setExpanded(true)
    if (threadReplies) return // already loaded

    setLoadingThread(true)
    try {
      const res = await fetch(`/api/slack/thread?channel=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(threadTs)}`)
      const data = await res.json() as {
        ok: boolean
        replies?: ThreadReply[]
      }
      if (data.ok && data.replies) {
        setThreadReplies(data.replies)
      } else {
        setThreadReplies([])
      }
    } catch {
      setThreadReplies([])
    } finally {
      setLoadingThread(false)
    }
  }

  async function handleGenerate(channelId: string, threadTs: string, chName: string) {
    setGenerating(true)

    try {
      const res = await fetch("/api/draft/from-slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          channelId,
          threadTs,
          channelName: chName,
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        onGenerateDraft(`[Error: ${text || `Request failed (${res.status})`}]`)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        onGenerateDraft("[Error: No response body]")
        return
      }

      let body = ""
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        body += decoder.decode(value, { stream: true })
      }

      onGenerateDraft(body)
    } catch (e) {
      onGenerateDraft(`[Error: ${e instanceof Error ? e.message : "Network error"}]`)
    } finally {
      setGenerating(false)
    }
  }

  function formatTimestamp(ts: string): string {
    const seconds = parseInt(ts.split(".")[0], 10)
    if (isNaN(seconds)) return ""
    const date = new Date(seconds * 1000)
    return date.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  }

  const latestThread = fetchState.status === "loaded" ? fetchState.threads[0] : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessageSquareIcon className="size-4 text-muted-foreground" />
          Slack Threads
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                  <InfoIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
                Searches internal Slack channels for the most recent workflow/fraud/moderation thread mentioning this customer's email. Expand to read the full thread and use "Generate response" to translate it into a customer-facing draft.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {fetchState.status === "loaded" && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              Auto-refreshing
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {fetchState.status === "loading" && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
          </div>
        )}

        {fetchState.status === "no_email" && (
          <p className="text-xs text-muted-foreground">
            No customer email available. Slack thread search requires the customer's email address.
          </p>
        )}

        {fetchState.status === "missing_scope" && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircleIcon className="mt-0.5 size-3 shrink-0" />
            <span>
              Slack search scope is not available. The <code>search:read</code> scope needs to be added to your Slack app.
            </span>
          </div>
        )}

        {fetchState.status === "auth_required" && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircleIcon className="mt-0.5 size-3 shrink-0" />
            <span>Connect your Slack account in Settings to search for workflow threads.</span>
          </div>
        )}

        {fetchState.status === "error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircleIcon className="mt-0.5 size-3 shrink-0" />
            <span>Slack search failed: {fetchState.message}</span>
          </div>
        )}

        {fetchState.status === "empty" && (
          <p className="text-xs text-muted-foreground">
            No Slack threads found for this customer's email.
          </p>
        )}

        {fetchState.status === "loaded" && latestThread && (
          <div className="flex flex-col gap-2">
            {/* Preview card */}
            <div className="flex flex-col gap-1.5 rounded-md border p-2.5">
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="text-xs font-normal">
                  #{latestThread.channelName}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {latestThread.participantCount} participant{latestThread.participantCount !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Expandable thread content */}
              <button
                type="button"
                onClick={() => handleExpand(latestThread.channelId, latestThread.ts)}
                className="flex w-full items-start gap-1.5 text-left"
              >
                <div className="mt-0.5 shrink-0">
                  {loadingThread ? (
                    <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
                  ) : expanded ? (
                    <ChevronDownIcon className="size-3 text-muted-foreground" />
                  ) : (
                    <ChevronRightIcon className="size-3 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {expanded && threadReplies ? (
                    <div className="flex flex-col gap-1.5">
                      {threadReplies.map((reply, i) => (
                        <div key={reply.ts ?? i} className="rounded bg-muted/30 px-2 py-1">
                          <span className="text-xs font-medium text-foreground">{reply.userName}</span>
                          <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            {reply.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {latestThread.snippet}
                    </p>
                  )}
                </div>
              </button>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(latestThread.ts)}
                </span>
                <div className="flex items-center gap-1">
                  {latestThread.permalink && (
                    <a
                      href={latestThread.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                    >
                      <ExternalLinkIcon className="size-3" />
                      Open
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={generating}
                    onClick={() => handleGenerate(latestThread.channelId, latestThread.ts, latestThread.channelName)}
                  >
                    {generating ? (
                      <>
                        <Loader2Icon className="size-3 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      "Generate response"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
