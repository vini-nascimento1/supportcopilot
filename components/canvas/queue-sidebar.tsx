"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ExternalLinkIcon,
  InboxIcon,
  InfoIcon,
  Loader2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PencilIcon,
  ShieldAlertIcon,
  UserPlusIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCanvasNav } from "@/components/canvas/canvas-nav"
import { onCanvasRefresh } from "@/lib/canvas-refresh"
import { cn, relativeTime } from "@/lib/utils"

// Mirrors lib/reply-queue-store.ts QueueItem (defined locally — that module is
// server-only, can't be imported into a client component).
type RiskBand = "ready" | "needs_check" | "low_confidence"
type SuggestionSource = { title?: string; url?: string; kind?: string }
type QueueItem = {
  id: string
  intercomConversationId: string
  ownerId: string | null
  customerName: string | null
  subject: string | null
  body: string
  justification: string
  sources: SuggestionSource[]
  confidence: number | null
  riskBand: RiskBand
  createdAt: string
}

const byOldest = (a: QueueItem, b: QueueItem) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()

const COLLAPSE_KEY = "fv-canvas-queue-collapsed"
const COLLAPSE_EVENT = "fv-canvas-queue-toggled"

function subscribeCollapse(cb: () => void) {
  window.addEventListener(COLLAPSE_EVENT, cb)
  return () => window.removeEventListener(COLLAPSE_EVENT, cb)
}

function readCollapsed(): string {
  try {
    // Collapsed by default — the canvas already shows the app sidebar, so
    // opening the queue too would eat ~a third of the window. Agents open it
    // when they want to work the queue; the choice then persists.
    return localStorage.getItem(COLLAPSE_KEY) ?? "1"
  } catch {
    return "1"
  }
}

// The autonomous non-read AI reply queue as a fixed left sidebar on every canvas
// (collapsible to a thin rail). It surfaces pre-computed suggestions in two
// bands; the agent approves the send with one click (human-gated) without
// leaving canvas mode. Draft-only: nothing leaves the system without that click.
export function QueueSidebar() {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Collapse preference in localStorage (collapsed by default)
  const collapsed =
    useSyncExternalStore(subscribeCollapse, readCollapsed, () => "1") === "1"
  const toggle = () => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1")
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT))
  }

  // Load the non-read reply queue; poll every 30s and on canvas refresh.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reply-queue")
      const data = await res.json()
      setItems(Array.isArray(data.items) ? data.items : [])
      setError(typeof data.error === "string" ? data.error : null)
    } catch {
      setError("Couldn't load the reply queue.")
      setItems((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    // Defer the initial fetch off the synchronous effect body so the first
    // setState doesn't cascade a render (react-hooks/set-state-in-effect).
    queueMicrotask(() => void load())
    const id = setInterval(() => void load(), 30_000)
    const off = onCanvasRefresh(() => void load())
    return () => {
      clearInterval(id)
      off()
    }
  }, [load])

  const remove = useCallback((id: string) => {
    setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev))
  }, [])

  const count = items?.length ?? 0

  if (collapsed) {
    return (
      <div
        data-canvas-chrome="left"
        className="absolute left-0 top-0 z-10 flex h-full w-9 flex-col items-center gap-2 border-r bg-card/95 py-3 backdrop-blur"
      >
        <button
          onClick={toggle}
          title="Open the reply queue"
          className="text-muted-foreground hover:text-foreground"
        >
          <PanelLeftOpenIcon className="size-4" />
        </button>
        <InboxIcon className="size-4 text-muted-foreground" />
        {count > 0 && <Badge className="h-5 px-1.5 text-[10px]">{count}</Badge>}
      </div>
    )
  }

  const ready =
    items?.filter((i) => i.riskBand !== "needs_check").sort(byOldest) ?? []
  const needsCheck =
    items?.filter((i) => i.riskBand === "needs_check").sort(byOldest) ?? []

  return (
    <div
      data-canvas-chrome="left"
      className="absolute left-0 top-0 z-10 flex h-full w-80 flex-col border-r bg-card/95 backdrop-blur"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <InboxIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium">Reply queue</span>
        {items !== null && (
          <Badge variant="secondary" className="h-5 px-1.5 font-normal">
            {count}
          </Badge>
        )}
        <button
          onClick={toggle}
          title="Collapse the queue"
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <PanelLeftCloseIcon className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items === null && <QueueSkeleton />}
        {items !== null && count === 0 && <EmptyState error={error} />}
        {items !== null && count > 0 && (
          <div className="flex flex-col gap-4 p-2">
            {error && <p className="px-1 text-xs text-destructive">{error}</p>}
            {ready.length > 0 && (
              <Band
                title="Ready to send"
                hint="One click sends it. Oldest first."
                count={ready.length}
              >
                {ready.map((i) => (
                  <QueueRow key={i.id} item={i} onDone={remove} onRefresh={load} />
                ))}
              </Band>
            )}
            {needsCheck.length > 0 && (
              <Band
                title="Needs your check"
                hint="Verify in fadmin before sending — the send is locked."
                count={needsCheck.length}
              >
                {needsCheck.map((i) => (
                  <QueueRow key={i.id} item={i} onDone={remove} onRefresh={load} />
                ))}
              </Band>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Band({
  title,
  hint,
  count,
  children,
}: {
  title: string
  hint: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-xs font-medium">{title}</h2>
        <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal tabular-nums">
          {count}
        </Badge>
      </div>
      <p className="px-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

// A compact row by default: customer + waited time + 1-line subject. Clicking
// the header expands it inline to reveal the suggested body, the "Why" popover,
// inline quick-edit, and the approve actions. Reuses the lobby QueueCard logic
// (approve → send → resolve, two-step confirm for locked rows) verbatim.
function QueueRow({
  item,
  onDone,
  onRefresh,
}: {
  item: QueueItem
  onDone: (id: string) => void
  onRefresh: () => Promise<void>
}) {
  const nav = useCanvasNav()
  const locked = item.riskBand === "needs_check"
  const unassigned = item.ownerId === null
  const caseHref = `/cases/${item.intercomConversationId}/canvas`
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState(item.body)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  // Switch tabs client-side inside the workspace; navigate otherwise.
  const openCase = () => {
    if (nav) nav.open(item.intercomConversationId)
  }

  const send = async () => {
    setSending(true)
    const bodyChanged = body.trim() !== item.body.trim()
    try {
      const res = await fetch("/api/draft/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: item.intercomConversationId, body }),
      })
      if (!res.ok) throw new Error(await res.text())
      // Best-effort: mark the queue row resolved so it leaves the queue.
      await fetch("/api/reply-queue/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: item.intercomConversationId,
          suggestionId: item.id,
          action: bodyChanged ? "edit" : "approve",
          bodyChanged,
        }),
      }).catch(() => {})
      toast.success(`Sent to ${item.customerName ?? "the customer"}`)
      onDone(item.id)
    } catch {
      toast.error("Couldn't send — open the case and try there.")
      setSending(false)
      setConfirming(false)
    }
  }

  const onApprove = () => {
    if (locked && !confirming) {
      setConfirming(true)
      return
    }
    void send()
  }

  const assignToMe = async () => {
    setAssigning(true)
    try {
      const res = await fetch("/api/reply-queue/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: item.intercomConversationId }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Assigned to you. Regenerating with your Notion context.")
      await onRefresh()
    } catch {
      toast.error("Couldn't assign this case.")
    } finally {
      setAssigning(false)
    }
  }

  const reject = async () => {
    setRejecting(true)
    try {
      const res = await fetch("/api/reply-queue/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: item.intercomConversationId,
          suggestionId: item.id,
          action: "reject",
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Suggestion dismissed")
      onDone(item.id)
    } catch {
      toast.error("Couldn't dismiss this suggestion.")
      setRejecting(false)
    }
  }

  const citable = item.sources.filter((s) => s.url)

  return (
    <article className="rounded-md border bg-card transition-colors hover:border-foreground/20">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full flex-col gap-0.5 px-2.5 py-2 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-medium">
            {item.customerName ?? "Customer"}
          </span>
          {item.riskBand === "low_confidence" && (
            <Badge
              variant="outline"
              className="h-4 px-1 text-[10px] font-normal text-muted-foreground"
            >
              review carefully
            </Badge>
          )}
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {relativeTime(item.createdAt)}
          </span>
        </span>
        {item.subject && (
          <span className="truncate text-[11px] text-muted-foreground">{item.subject}</span>
        )}
      </button>

      {expanded && (
        <div className="border-t px-2.5 py-2.5">
          {editing ? (
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-32 text-xs leading-relaxed"
              autoFocus
            />
          ) : (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
              {body}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                  <InfoIcon className="size-3.5" />
                  Why
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 text-xs leading-relaxed">
                <p className="text-foreground/90">{item.justification}</p>
                {citable.length > 0 && (
                  <div className="mt-2 border-t pt-2">
                    <p className="mb-1 font-medium text-muted-foreground">Sources</p>
                    <ul className="flex flex-col gap-1">
                      {citable.map((s, idx) => (
                        <li key={idx}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-foreground/80 underline-offset-2 hover:underline"
                          >
                            <ExternalLinkIcon className="size-3 shrink-0" />
                            <span className="truncate">{s.title ?? s.url}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {nav ? (
              <button
                type="button"
                onClick={openCase}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLinkIcon className="size-3.5" />
                Open case
              </button>
            ) : (
              <Link
                href={caseHref}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLinkIcon className="size-3.5" />
                Open case
              </Link>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-[11px] text-muted-foreground"
              onClick={() => setEditing((e) => !e)}
            >
              <PencilIcon className="size-3.5" />
              {editing ? "Done" : "Edit"}
            </Button>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            {unassigned ? (
              <Button
                size="sm"
                className="ml-auto h-7 px-2.5 text-xs"
                onClick={() => void assignToMe()}
                disabled={assigning}
              >
                {assigning ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <UserPlusIcon className="size-3.5" />
                )}
                Assign to me
              </Button>
            ) : confirming ? (
              <>
                <span className="text-[11px] text-muted-foreground">Are you sure?</span>
                <Button
                  size="sm"
                  className="ml-auto h-7 px-2.5 text-xs"
                  onClick={() => void send()}
                  disabled={sending}
                >
                  {sending && <Loader2Icon className="size-3.5 animate-spin" />}
                  Yes
                </Button>
                {nav ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    onClick={openCase}
                  >
                    No, I need to manually check
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" asChild>
                    <Link href={caseHref}>No, I need to manually check</Link>
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 px-2.5 text-xs text-muted-foreground"
                  onClick={() => void reject()}
                  disabled={sending || rejecting}
                >
                  {rejecting && <Loader2Icon className="size-3.5 animate-spin" />}
                  Reject
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={onApprove}
                  disabled={sending || rejecting}
                >
                  {sending && <Loader2Icon className="size-3.5 animate-spin" />}
                  Approve &amp; send
                </Button>
              </>
            )}
          </div>

          {unassigned && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <UserPlusIcon className="size-3.5 shrink-0" />
              Assigning is a human-gated Intercom write, then the draft refreshes with your Notion access.
            </p>
          )}
          {locked && !confirming && !unassigned && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldAlertIcon className="size-3.5 shrink-0" />
              Verify payout / KYC / media in fadmin before sending.
            </p>
          )}
        </div>
      )}
    </article>
  )
}

function RowSkeleton() {
  return (
    <div className="rounded-md border bg-card px-2.5 py-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="ml-auto h-2.5 w-8" />
      </div>
      <Skeleton className="mt-1.5 h-2.5 w-5/6" />
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      <Skeleton className="mb-1 h-3 w-28" />
      <RowSkeleton />
      <RowSkeleton />
      <RowSkeleton />
    </div>
  )
}

function EmptyState({ error }: { error: string | null }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-full",
          error ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
        )}
      >
        <InboxIcon className="size-5" />
      </div>
      <p className="text-xs font-medium">
        {error ? "Couldn't load the reply queue." : "You're all caught up"}
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {error
          ? "Retrying every 30 seconds. Open a case directly if you need it now."
          : "New customer replies show up here as the AI drafts a suggestion — usually within a few seconds."}
      </p>
    </div>
  )
}
