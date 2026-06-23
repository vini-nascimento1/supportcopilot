"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ExternalLinkIcon,
  InboxIcon,
  InfoIcon,
  Loader2Icon,
  PencilIcon,
  ShieldAlertIcon,
  SparklesIcon,
  UserPlusIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCanvasNav } from "@/components/canvas/canvas-nav"
import { onCanvasRefresh } from "@/lib/canvas-refresh"
import {
  readPendingOnRequestDrafts,
  removePendingOnRequestDrafts,
  subscribePendingOnRequestDrafts,
  type PendingOnRequestDraft,
} from "@/lib/on-request-drafts"
import { relativeTime } from "@/lib/utils"

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
// A non-read conversation whose AI draft is still being generated (no ready row
// yet). Mirrors the `drafting` payload from /api/reply-queue.
type DraftingItem = {
  conversationId: string
  customerName: string | null
  subject: string | null
}

const byOldest = (a: QueueItem, b: QueueItem) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()

// The autonomous non-read AI reply queue: pre-computed suggestions for the
// conversations assigned to the signed-in agent, in two bands. The agent
// approves the send with one click (human-gated). Draft-only: nothing leaves the
// system without that click. Rendered as the "Queue" tab of the canvas left
// sidebar (see canvas-left-sidebar.tsx).
export function QueuePanel({
  active,
  onCount,
}: {
  active: boolean
  onCount?: (n: number) => void
}) {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [drafting, setDrafting] = useState<DraftingItem[]>([])
  // Drafts the agent generated on demand from the Inbox for tickets that are no
  // longer non-read (already replied). Durable — never staled by reconciliation.
  const [onRequest, setOnRequest] = useState<QueueItem[]>([])
  const [manualDrafting, setManualDrafting] = useState<PendingOnRequestDraft[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reply-queue")
      const data = await res.json()
      const nextItems: QueueItem[] = Array.isArray(data.items) ? data.items : []
      const nextDrafting: DraftingItem[] = Array.isArray(data.drafting) ? data.drafting : []
      const nextOnRequest: QueueItem[] = Array.isArray(data.onRequest) ? data.onRequest : []
      setItems(nextItems)
      setDrafting(nextDrafting)
      setOnRequest(nextOnRequest)
      removePendingOnRequestDrafts(
        [...nextItems, ...nextOnRequest].map((item) => item.intercomConversationId)
      )
      setError(typeof data.error === "string" ? data.error : null)
    } catch {
      setError("Couldn't load the reply queue.")
      setItems((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    const sync = () => setManualDrafting(readPendingOnRequestDrafts())
    sync()
    return subscribePendingOnRequestDrafts(sync)
  }, [])

  // Poll every 30s + on canvas refresh, but only while this tab is the active,
  // visible one — no background polling when the agent is on the Inbox tab or
  // the sidebar is collapsed.
  useEffect(() => {
    if (!active) return
    queueMicrotask(() => void load())
    // Each poll reconciles against live Intercom (server-side), so keep it a
    // touch lighter than the inbox list.
    const id = setInterval(() => void load(), 15_000)
    const off = onCanvasRefresh(() => void load())
    return () => {
      clearInterval(id)
      off()
    }
  }, [active, load])

  const remove = useCallback((id: string) => {
    setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev))
    setOnRequest((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const ready = items?.filter((i) => i.riskBand !== "needs_check").sort(byOldest) ?? []
  const needsCheck = items?.filter((i) => i.riskBand === "needs_check").sort(byOldest) ?? []
  const onRequestSorted = [...onRequest].sort(byOldest)
  const visibleIds = new Set([
    ...drafting.map((item) => item.conversationId),
    ...(items ?? []).map((item) => item.intercomConversationId),
    ...onRequest.map((item) => item.intercomConversationId),
  ])
  const manualDraftingVisible: DraftingItem[] = manualDrafting
    .filter((item) => !visibleIds.has(item.conversationId))
    .map((item) => ({
      conversationId: item.conversationId,
      customerName: item.customerName,
      subject: item.subject,
    }))
  const draftingVisible = [...drafting, ...manualDraftingVisible]
  const total = (items?.length ?? 0) + draftingVisible.length + onRequest.length

  useEffect(() => {
    onCount?.((items?.length ?? 0) + draftingVisible.length + onRequest.length)
  }, [items, draftingVisible.length, onRequest.length, onCount])

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {items === null && <QueueSkeleton />}
        {items !== null && total === 0 && <EmptyState error={error} />}
        {items !== null && total > 0 && (
          <div className="flex flex-col gap-4 p-2">
            {error && <p className="px-1 text-xs text-destructive">{error}</p>}
            {draftingVisible.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <SparklesIcon className="size-3 text-primary" />
                  <h2 className="text-xs font-medium">Drafting</h2>
                  <Badge
                    variant="secondary"
                    className="h-4 px-1 text-[10px] font-normal tabular-nums"
                  >
                    {draftingVisible.length}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1.5">
                  {draftingVisible.map((d) => (
                    <DraftingCard key={d.conversationId} item={d} />
                  ))}
                </div>
              </section>
            )}
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
            {onRequestSorted.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <SparklesIcon className="size-3 text-primary" />
                  <h2 className="text-xs font-medium">On request</h2>
                  <Badge
                    variant="secondary"
                    className="h-4 px-1 text-[10px] font-normal tabular-nums"
                  >
                    {onRequestSorted.length}
                  </Badge>
                </div>
                <p className="px-1 text-[11px] leading-snug text-muted-foreground">
                  Drafts you generated from the Inbox — including tickets you&apos;ve already
                  replied to. Send or dismiss right here.
                </p>
                <div className="flex flex-col gap-1.5">
                  {onRequestSorted.map((i) => (
                    <QueueRow key={i.id} item={i} onDone={remove} onRefresh={load} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Placeholder card shown while the AI is generating a draft for a non-read
// conversation — an animated sparkle, who it's for, a typing-dots ellipsis, and
// shimmering skeleton lines. Replaced by the real QueueRow on the next poll.
function DraftingCard({ item }: { item: DraftingItem }) {
  return (
    <article className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center gap-2 px-2.5 pt-2">
        <SparklesIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
        <span className="truncate text-xs font-medium text-muted-foreground">
          Drafting a reply for{" "}
          <span className="text-foreground">{item.customerName ?? "the customer"}</span>
        </span>
        <TypingDots />
      </div>
      {item.subject && (
        <p className="truncate px-2.5 pt-0.5 text-[11px] text-muted-foreground/70">
          {item.subject}
        </p>
      )}
      <div className="flex flex-col gap-1.5 px-2.5 pb-2.5 pt-2">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-11/12" />
        <Skeleton className="h-2.5 w-2/3" />
      </div>
    </article>
  )
}

// Three softly-staggered pulsing dots — a lightweight "…thinking" affordance.
function TypingDots() {
  return (
    <span className="ml-auto inline-flex shrink-0 gap-0.5 text-primary" aria-hidden>
      <span className="animate-pulse">•</span>
      <span className="animate-pulse [animation-delay:200ms]">•</span>
      <span className="animate-pulse [animation-delay:400ms]">•</span>
    </span>
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
// inline quick-edit, and the approve actions.
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
        className={
          error
            ? "flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"
            : "flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
        }
      >
        <InboxIcon className="size-5" />
      </div>
      <p className="text-xs font-medium">
        {error ? "Couldn't load the reply queue." : "You're all caught up"}
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {error
          ? "Retrying every 30 seconds. Open a case directly if you need it now."
          : "Suggestions for conversations assigned to you show up here as the AI drafts them — usually within a few seconds."}
      </p>
    </div>
  )
}
