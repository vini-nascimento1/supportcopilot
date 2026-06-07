"use client"

import { useEffect, useState, useRef } from "react"
import {
  MessageSquareIcon,
  HashIcon,
  AtSignIcon,
  Loader2Icon,
  ExternalLinkIcon,
  SendIcon,
  MessageSquareReplyIcon,
  RefreshCwIcon,
  SmilePlusIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import type { SlackConversation, SlackMessage, SlackThreadReply, SlackReaction } from "@/lib/slack"
import { getMessagePermalink, parseSlackEmojis } from "@/lib/slack-utils"

// ── Helpers ────────────────────────────────────────────────────

function parseSlackText(text: string): string {
  return parseSlackEmojis(text)
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/<@[A-Z0-9]+\|([^>]+)>/g, "@$1")
    .replace(/<@([A-Z0-9]+)>/g, "@$1")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .trim()
}

function relativeTime(ts: string | number): string {
  const ms = typeof ts === "number" ? ts * 1000 : parseFloat(ts) * 1000
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 2) return "yesterday"
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Common reaction emojis used in the picker ──────────────────

const QUICK_REACTIONS = [
  "thumbsup", "thumbsdown", "heart", "joy", "eyes", "rocket",
  "fire", "clap", "wave", "smile", "scream", "tada",
  "100", "white_check_mark", "heart_hands",
]

// ── Reaction Picker ────────────────────────────────────────────

function ReactionPicker({ onSelect, onClose, channelId, timestamp }: {
  onSelect: (emoji: string) => void; onClose: () => void
  channelId: string; timestamp: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [reacting, setReacting] = useState<string | null>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Delay to avoid immediate close from the "+" click
    const timer = setTimeout(() => document.addEventListener("click", handleClick), 100)
    return () => { clearTimeout(timer); document.removeEventListener("click", handleClick) }
  }, [onClose])

  return (
    <div ref={ref}
      className="absolute bottom-full left-0 z-50 mb-1 flex flex-wrap gap-0.5 rounded-lg border bg-popover p-1 shadow-md">
      {QUICK_REACTIONS.map((emoji) => (
        <button key={emoji}
          onClick={async () => {
            if (reacting) return
            setReacting(emoji)
            try {
              await fetch("/api/slack/reactions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channel: channelId, name: emoji, timestamp }),
              })
              onSelect(emoji)
            } finally {
              setReacting(null)
            }
          }}
          disabled={reacting !== null}
          className="flex size-7 items-center justify-center rounded-md text-base transition-colors hover:bg-muted disabled:opacity-30">
          {parseSlackEmojis(`:${emoji}:`)}
        </button>
      ))}
    </div>
  )
}

// ── Reactions Display ──────────────────────────────────────────

function ReactionsBar({ reactions, channelId, timestamp, onReacted }: {
  reactions: SlackReaction[]; channelId: string; timestamp: string
  onReacted: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  if (reactions.length === 0 && !pickerOpen) return null

  return (
    <div className="relative mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((r) => (
        <button key={r.name} onClick={async () => {
          await fetch("/api/slack/reactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel: channelId, name: r.name, timestamp }),
          })
          onReacted()
        }}
          className="flex items-center gap-0.5 rounded-full border bg-muted/30 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-muted">
          <span className="text-xs">{parseSlackEmojis(`:${r.name}:`)}</span>
          <span className="text-muted-foreground">{r.count}</span>
        </button>
      ))}
      {pickerOpen ? (
        <ReactionPicker
          channelId={channelId} timestamp={timestamp}
          onSelect={() => { setPickerOpen(false); onReacted() }}
          onClose={() => setPickerOpen(false)} />
      ) : (
        <button onClick={(e) => { e.stopPropagation(); setPickerOpen(true) }}
          className="flex size-5 items-center justify-center rounded-full border bg-muted/30 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100">
          <SmilePlusIcon className="size-3" />
        </button>
      )}
    </div>
  )
}

// ── Thread Replies ─────────────────────────────────────────────

function ThreadRepliesView({ replies, workspaceUrl, channelId }: {
  replies: SlackThreadReply[]; workspaceUrl: string; channelId: string
}) {
  if (replies.length === 0) return null
  return (
    <div className="ml-9 border-l-2 border-muted-foreground/20 pl-3 pt-1">
      {replies.map((reply) => (
        <div key={reply.id} className="group flex items-start gap-2 py-1 hover:bg-muted/30">
          <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
            style={{ backgroundColor: reply.userColor }}>
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
          <a href={getMessagePermalink(workspaceUrl, channelId, reply.id)}
            target="_blank" rel="noopener noreferrer"
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100"
            title="Open in Slack">
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      ))}
    </div>
  )
}

// ── Message ────────────────────────────────────────────────────

function SlackMessageRow({ msg, channelId, workspaceUrl, prevMsg, threadReplies, threadLoading, threadExpanded, onToggleThread, onReply, refreshMessages }: {
  msg: SlackMessage; channelId: string; workspaceUrl: string; prevMsg?: SlackMessage
  threadReplies: SlackThreadReply[] | null; threadLoading: boolean; threadExpanded: boolean
  onToggleThread: () => void; onReply?: (text: string, threadTs: string) => void
  refreshMessages: () => void
}) {
  const [replyText, setReplyText] = useState("")
  const [replying, setReplying] = useState(false)
  const isThreadReply = !!msg.parentTs
  const grouped = !isThreadReply && prevMsg?.userId === msg.userId &&
    Math.abs(parseFloat(msg.ts) - parseFloat(prevMsg.ts)) < 300

  async function handleReply(e: React.FormEvent) {
    e.preventDefault()
    if (!replyText.trim() || replying) return
    setReplying(true)
    try {
      await onReply?.(replyText.trim(), msg.threadTs ?? msg.ts)
      setReplyText("")
    } finally {
      setReplying(false)
    }
  }

  if (grouped) {
    return (
      <div className="group flex items-start gap-2 px-4 py-0.5 hover:bg-muted/30">
        <div className="w-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-sm leading-snug text-foreground">
            {parseSlackText(msg.text)}
          </p>
          {msg.reactions && msg.reactions.length > 0 && (
            <ReactionsBar reactions={msg.reactions} channelId={channelId}
              timestamp={msg.ts} onReacted={refreshMessages} />
          )}
        </div>
        <div className="mt-0.5 flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!isThreadReply && (
            <button onClick={onToggleThread}
              className="flex size-6 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
              title={threadExpanded ? "Close thread" : "Reply in thread"}>
              <MessageSquareReplyIcon className="size-3.5" />
            </button>
          )}
          <a href={getMessagePermalink(workspaceUrl, channelId, msg.id)}
            target="_blank" rel="noopener noreferrer"
            className="flex size-6 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
            title="Open in Slack">
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="group px-4 py-1.5 hover:bg-muted/30">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
          style={{ backgroundColor: msg.userColor }}>
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
          {msg.reactions && msg.reactions.length > 0 && (
            <ReactionsBar reactions={msg.reactions} channelId={channelId}
              timestamp={msg.ts} onReacted={refreshMessages} />
          )}
          {msg.threadCount && msg.threadCount > 0 && !isThreadReply && (
            <button onClick={onToggleThread}
              className="mt-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10">
              {threadLoading ? <Loader2Icon className="size-3 animate-spin" /> : <MessageSquareReplyIcon className="size-3" />}
              {msg.threadCount} {msg.threadCount === 1 ? "reply" : "replies"}
            </button>
          )}
          {threadExpanded && threadReplies && (
            <ThreadRepliesView replies={threadReplies} workspaceUrl={workspaceUrl} channelId={channelId} />
          )}
          {threadExpanded && (
            <form onSubmit={handleReply} className="ml-9 mt-1 flex items-center gap-1.5 pr-2">
              <Input value={replyText} onChange={(e) => setReplyText(e.target.value)}
                placeholder="Reply in thread…"
                disabled={replying}
                className="h-7 text-xs" />
              <Button type="submit" size="icon" variant="ghost"
                disabled={!replyText.trim() || replying}
                className="size-7 shrink-0">
                {replying ? <Loader2Icon className="size-3 animate-spin" /> : <SendIcon className="size-3" />}
              </Button>
            </form>
          )}
        </div>
        <div className="mt-0.5 flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!isThreadReply && (
            <button onClick={onToggleThread}
              className="flex size-6 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
              title={threadExpanded ? "Close thread" : "Reply in thread"}>
              <MessageSquareReplyIcon className="size-3.5" />
            </button>
          )}
          <a href={getMessagePermalink(workspaceUrl, channelId, msg.id)}
            target="_blank" rel="noopener noreferrer"
            className="flex size-6 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
            title="Open in Slack">
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Conversation List Item ─────────────────────────────────────

function ConversationItem({ conv, active, onSelect }: {
  conv: SlackConversation; active: boolean; onSelect: () => void
}) {
  const isDm = conv.type === "im"
  const timeLabel = conv.latestTs ? relativeTime(conv.latestTs) : null

  return (
    <button onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {isDm ? (
          conv.dmColor ? (
            <div className="flex size-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
              style={{ backgroundColor: conv.dmColor }}>
              {initials(conv.dmUser ?? conv.name)}
            </div>
          ) : (
            <AtSignIcon className="size-3.5" />
          )
        ) : (
          <HashIcon className="size-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{conv.name}</span>
      {timeLabel && !isDm && (
        <span className="shrink-0 text-[10px] text-muted-foreground/60">{timeLabel}</span>
      )}
      {isDm && timeLabel && (
        <span className="shrink-0 text-[10px] text-muted-foreground/60">{timeLabel}</span>
      )}
      {conv.unreadCount > 0 && (
        <Badge className="ml-auto shrink-0 text-[10px]">{conv.unreadCount > 99 ? "99+" : conv.unreadCount}</Badge>
      )}
    </button>
  )
}

// ── Main App ───────────────────────────────────────────────────

export function SlackApp() {
  const [conversations, setConversations] = useState<SlackConversation[]>([])
  const [workspaceUrl, setWorkspaceUrl] = useState("https://slack.com")
  const [loading, setLoading] = useState(true)
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SlackMessage[]>([])
  const [channelName, setChannelName] = useState("")
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [threadReplies, setThreadReplies] = useState<Record<string, SlackThreadReply[] | null>>({})
  const [threadLoading, setThreadLoading] = useState<Record<string, boolean>>({})
  const [threadExpanded, setThreadExpanded] = useState<Record<string, boolean>>({})
  const [sendText, setSendText] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Fetch conversations
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/slack/conversations")
        const data = await res.json()
        if (!cancelled && data.ok) {
          setConversations(data.conversations)
          setWorkspaceUrl(data.workspaceUrl)
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // Fetch messages for active channel
  useEffect(() => {
    const channelId = activeChannelId
    if (!channelId) return
    let cancelled = false
    async function load() {
      setMessagesLoading(true)
      setMessages([])
      try {
        const res = await fetch(`/api/slack/conversations?channel=${encodeURIComponent(channelId!)}`)
        const data = await res.json()
        if (!cancelled && data.ok) {
          setMessages(data.messages)
          setChannelName(data.channelName)
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setMessagesLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [activeChannelId, refreshKey])

  // Scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  // Thread toggle
  async function handleToggleThread(msgId: string, channelId: string, threadTs: string) {
    if (threadExpanded[msgId]) { setThreadExpanded((p) => ({ ...p, [msgId]: false })); return }
    // If already cached, just show it
    if (threadReplies[msgId] !== undefined) { setThreadExpanded((p) => ({ ...p, [msgId]: true })); return }
    setThreadLoading((p) => ({ ...p, [msgId]: true }))
    setThreadExpanded((p) => ({ ...p, [msgId]: true }))
    try {
      const res = await fetch(`/api/slack/thread?channel=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(threadTs)}`)
      const data = await res.json() as { ok: boolean; replies?: SlackThreadReply[] }
      setThreadReplies((p) => ({ ...p, [msgId]: data.replies ?? null }))
    } catch {
      setThreadReplies((p) => ({ ...p, [msgId]: null }))
    } finally {
      setThreadLoading((p) => ({ ...p, [msgId]: false }))
    }
  }

  // Send message
  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!sendText.trim() || !activeChannelId || sending) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch("/api/slack/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: activeChannelId, text: sendText.trim() }),
      })
      const data = await res.json()
      if (data.ok) {
        setSendText("")
        setRefreshKey((k) => k + 1)
      } else {
        setSendError(data.error ?? "Failed to send")
      }
    } catch {
      setSendError("Network error")
    } finally {
      setSending(false)
    }
  }

  // Refresh messages for current channel (e.g. after reaction)
  function refreshMessages() {
    setRefreshKey((k) => k + 1)
  }

  const channels = conversations.filter((c) => c.type === "channel")
  const dms = conversations.filter((c) => c.type === "im" || c.type === "mpim")
  const activeConv = conversations.find((c) => c.id === activeChannelId)
  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0)

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* Header */}
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MessageSquareIcon className="size-4 text-muted-foreground" />
          <h1 className="text-base font-medium">Slack</h1>
          {totalUnread > 0 && (
            <Badge variant="secondary" className="text-xs">{totalUnread} unread</Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
          <a href={workspaceUrl} target="_blank" rel="noopener noreferrer">
            Open in Slack <ExternalLinkIcon className="size-3" />
          </a>
        </Button>
      </header>

      {/* Split pane */}
      <div className="flex min-h-0 flex-1">
        {/* Conversations sidebar */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r bg-muted/20 max-lg:hidden">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Conversations</span>
            <Button size="icon" variant="ghost" className="size-6" onClick={() => window.location.reload()} title="Refresh">
              <RefreshCwIcon className="size-3" />
            </Button>
          </div>
          <div className="px-2 pb-2">
            {loading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full rounded-md" />
                ))}
              </div>
            ) : (
              <>
                {channels.length > 0 && (
                  <div className="mb-3">
                    <p className="px-1 pb-1 text-[10px] font-semibold uppercase text-muted-foreground">Channels</p>
                    {channels.map((c) => (
                      <ConversationItem key={c.id} conv={c} active={activeChannelId === c.id}
                        onSelect={() => setActiveChannelId(c.id)} />
                    ))}
                  </div>
                )}
                {dms.length > 0 && (
                  <div>
                    <p className="px-1 pb-1 text-[10px] font-semibold uppercase text-muted-foreground">Direct messages</p>
                    {dms.map((c) => (
                      <ConversationItem key={c.id} conv={c} active={activeChannelId === c.id}
                        onSelect={() => setActiveChannelId(c.id)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Messages area */}
        <main className="flex min-w-0 flex-1 flex-col">
          {!activeChannelId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <MessageSquareIcon className="size-12 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">Select a conversation to view messages</p>
            </div>
          ) : messagesLoading ? (
            <div className="flex flex-1 flex-col gap-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
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
          ) : (
            <>
              <div className="flex items-center gap-2 border-b px-4 py-2">
                <span className="text-xs font-medium text-muted-foreground">{channelName}</span>
                <Button size="icon" variant="ghost" className="ml-auto size-6"
                  onClick={() => setRefreshKey((k) => k + 1)}
                  title="Refresh messages">
                  <RefreshCwIcon className="size-3" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                {messages.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 pt-12 text-center">
                    <p className="text-sm text-muted-foreground">No messages yet in this conversation.</p>
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <SlackMessageRow key={msg.id} msg={msg} channelId={activeChannelId}
                      workspaceUrl={workspaceUrl} prevMsg={messages[i - 1]}
                      threadReplies={threadReplies[msg.id] ?? null}
                      threadLoading={!!threadLoading[msg.id]}
                      threadExpanded={!!threadExpanded[msg.id]}
                      onToggleThread={() => handleToggleThread(msg.id, activeChannelId, msg.threadTs ?? msg.ts)}
                      refreshMessages={refreshMessages}
                      onReply={async (text, threadTs) => {
                        const res = await fetch("/api/slack/send", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ channel: activeChannelId, text, threadTs }),
                        })
                        const data = await res.json()
                        if (data.ok) {
                          setThreadLoading((p) => ({ ...p, [msg.id]: true }))
                          const threadRes = await fetch(`/api/slack/thread?channel=${encodeURIComponent(activeChannelId)}&ts=${encodeURIComponent(threadTs)}`)
                          const threadData = await threadRes.json() as { ok: boolean; replies?: SlackThreadReply[] }
                          setThreadReplies((p) => ({ ...p, [msg.id]: threadData.replies ?? null }))
                          setThreadLoading((p) => ({ ...p, [msg.id]: false }))
                        }
                      }} />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="border-t p-3">
                {sendError && <p className="mb-2 text-xs text-destructive">{sendError}</p>}
                <form onSubmit={handleSend} className="flex items-center gap-2">
                  <Input value={sendText} onChange={(e) => setSendText(e.target.value)}
                    placeholder={`Message ${activeConv?.name ?? "channel"}...`}
                    disabled={sending}
                    className="flex-1" />
                  <Button type="submit" size="icon" disabled={!sendText.trim() || sending}>
                    {sending ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
                  </Button>
                </form>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
