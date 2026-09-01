"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ExternalLinkIcon,
  InboxIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  RotateCwIcon,
  SendIcon,
  SparklesIcon,
  UserPlusIcon,
} from "lucide-react"

import { StatusTag, Tag } from "@/components/ui/status-tag"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { SendConfirmDialog } from "@/components/send-confirm-dialog"
import { usePlatform } from "@/hooks/use-platform"
import { LOCK_REASON_GENERIC } from "@/lib/briefing/format"
import { cn, relativeTime } from "@/lib/utils"
import {
  byOldest,
  fetchQueue,
  intercomConversationUrl,
  isLocked,
  postAssignToMe,
  postReject,
  postSendAndResolve,
  type DraftingItem,
  type QueueItem,
} from "@/components/queue/queue-actions"

// The reply queue as a standalone surface: the same drafts the Canvas sidebar
// shows, reviewable and sendable from a phone or from plain web with no
// Electron shell. Rendered by app/queue/page.tsx.
//
// Deliberately narrower than components/canvas/queue-panel.tsx — no multi-select,
// no bulk bar, no drafting-stuck retry machinery. One draft at a time, one tap
// to expand, one tap plus a confirmation dialog to send. The outbound calls come
// from the shared module so the payloads can never drift from Canvas.
//
// Lock rule, identical on every surface: a needs_check draft is never sendable
// here. The server enforces it too (POST /api/draft/send answers 409 without a
// confirmation), but this UI simply doesn't offer the button — it offers the
// desktop app and Intercom instead, because the fadmin check has to happen
// somewhere the agent can actually see fadmin.

const POLL_MS = 15_000

export function QueueList({
  intercomAppId,
  downloadUrl,
}: {
  intercomAppId: string | null
  downloadUrl: string | null
}) {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [drafting, setDrafting] = useState<DraftingItem[]>([])
  const [onRequest, setOnRequest] = useState<QueueItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Monotonic id for the in-flight load: a manual refresh can race the poll,
  // and a stale response must not clobber fresher state.
  const loadRequestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current
    try {
      const data = await fetchQueue()
      if (requestId !== loadRequestIdRef.current) return
      setItems(data.items)
      setDrafting(data.drafting)
      setOnRequest(data.onRequest)
      setError(data.error)
    } catch {
      if (requestId !== loadRequestIdRef.current) return
      setError("Couldn't load the reply queue.")
      setItems((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    // Deferred out of the effect body (same as queue-panel.tsx) so the first
    // fetch's setState lands after render rather than cascading inside it.
    queueMicrotask(() => void load())
    const id = setInterval(() => {
      // Don't poll a backgrounded tab — this route reconciles against live
      // Intercom on every call.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      void load()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  // Drop a row the agent just sent, dismissed or claimed.
  const remove = useCallback((id: string) => {
    setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev))
    setOnRequest((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const ready = useMemo(
    () => (items ?? []).filter((i) => !isLocked(i)).sort(byOldest),
    [items]
  )
  const needsCheck = useMemo(() => (items ?? []).filter(isLocked).sort(byOldest), [items])
  const onRequestSorted = useMemo(() => [...onRequest].sort(byOldest), [onRequest])
  const total = ready.length + needsCheck.length + onRequestSorted.length

  const rowProps = { intercomAppId, downloadUrl, onDone: remove, onRefresh: load }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
          Drafts waiting on you. Nothing goes out without your tap.
        </p>
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />}
          Refresh
        </Button>
      </div>

      {error && <p className="text-[13px] text-destructive">{error}</p>}

      {items === null && <QueueSkeleton />}

      {items !== null && total === 0 && !error && <EmptyState drafting={drafting.length} />}

      {items !== null && total > 0 && (
        <div className="flex min-w-0 flex-col gap-5">
          {ready.length > 0 && (
            <Section title="Ready to send" hint="One tap sends it. Oldest first." count={ready.length}>
              {ready.map((item) => (
                <QueueCard key={item.id} item={item} {...rowProps} />
              ))}
            </Section>
          )}

          {needsCheck.length > 0 && (
            <Section
              title="Needs your check"
              hint="Sending is locked until someone verifies these in fadmin."
              count={needsCheck.length}
            >
              {needsCheck.map((item) => (
                <QueueCard key={item.id} item={item} {...rowProps} />
              ))}
            </Section>
          )}

          {onRequestSorted.length > 0 && (
            <Section
              title="On request"
              hint="Drafts you asked for, including tickets you have already replied to."
              count={onRequestSorted.length}
            >
              {onRequestSorted.map((item) => (
                <QueueCard key={item.id} item={item} {...rowProps} />
              ))}
            </Section>
          )}
        </div>
      )}

      {drafting.length > 0 && total > 0 && (
        <p className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <SparklesIcon className="size-3.5 shrink-0 text-primary" />
          {drafting.length} more {drafting.length === 1 ? "reply is" : "replies are"} still being
          written.
        </p>
      )}
    </div>
  )
}

function Section({
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
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-sm font-medium">{title}</h2>
        <Tag className="tabular-nums">{count}</Tag>
      </div>
      <p className="text-[12px] leading-snug text-muted-foreground">{hint}</p>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </section>
  )
}

function QueueCard({
  item,
  intercomAppId,
  downloadUrl,
  onDone,
  onRefresh,
}: {
  item: QueueItem
  intercomAppId: string | null
  downloadUrl: string | null
  onDone: (id: string) => void
  onRefresh: () => Promise<void>
}) {
  const { isDesktopApp } = usePlatform()
  const locked = isLocked(item)
  const unassigned = item.ownerId === null
  const caseHref = `/cases/${item.intercomConversationId}/canvas`
  const intercomHref = intercomConversationUrl(item.intercomConversationId, intercomAppId)

  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState(item.body)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<"send" | "reject" | "assign" | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const send = async () => {
    // Belt and braces: this button is never rendered for a locked draft, and
    // the server would refuse it anyway. Keep the guard so a future edit to the
    // markup can't quietly make a locked row sendable.
    if (locked || unassigned || busy) return
    setBusy("send")
    const result = await postSendAndResolve(item, body, { needsCheckConfirmed: false })
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't send. Open the case and try there.")
      setBusy(null)
      return
    }
    toast.success(`Sent to ${item.customerName ?? "the customer"}`)
    onDone(item.id)
    if (!result.resolvedOk) {
      toast.warning("Sent to Intercom, but couldn't clear the queue yet. Refreshing.")
      void onRefresh()
    }
  }

  const reject = async () => {
    if (busy) return
    setBusy("reject")
    const result = await postReject(item)
    if (!result.ok) {
      toast.error("Couldn't dismiss this suggestion.")
      setBusy(null)
      return
    }
    toast.success("Suggestion dismissed")
    onDone(item.id)
  }

  const assign = async () => {
    if (busy) return
    setBusy("assign")
    const result = await postAssignToMe(item)
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't assign this case.")
      setBusy(null)
      return
    }
    if (result.drafted) {
      toast.success("Assigned to you. Regenerating with your Notion context.")
    } else {
      toast.warning("Assigned to you, but the draft didn't regenerate — retrying in the background.")
    }
    await onRefresh()
    setBusy(null)
  }

  const citable = item.sources.filter((s) => s.url)

  return (
    <article className="min-w-0 overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full min-w-0 flex-col gap-1 px-3 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {item.customerName ?? "Customer"}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {relativeTime(item.createdAt)}
          </span>
        </span>
        {item.subject && (
          <span className="block min-w-0 truncate text-[12px] text-muted-foreground">
            {item.subject}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-1.5">
          {locked && <StatusTag tone="warn">Locked</StatusTag>}
          {item.riskBand === "low_confidence" && <StatusTag>Review</StatusTag>}
          {unassigned && <Tag>Unassigned</Tag>}
        </span>
      </button>

      {expanded && (
        <div className="min-w-0 border-t bg-muted/40 px-3 py-3">
          {locked && (
            <div className="mb-2.5 flex min-w-0 items-start gap-2.5 rounded-md border bg-card px-3 py-2.5 text-[12.5px] leading-snug text-muted-foreground">
              <LockIcon className="mt-0.5 size-3.5 shrink-0 text-foreground" />
              <div className="min-w-0">
                <b className="block font-semibold text-foreground">Verify in fadmin before sending</b>
                {LOCK_REASON_GENERIC} fadmin only opens in the desktop app.
              </div>
            </div>
          )}

          {editing && !locked ? (
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-40 text-[13px] leading-relaxed"
              autoFocus
            />
          ) : (
            <p
              className={cn(
                "text-[13px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90",
                locked && "opacity-60"
              )}
            >
              {body}
            </p>
          )}

          {item.justification && (
            <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground/80">Why: </span>
              {item.justification}
            </p>
          )}

          {citable.length > 0 && (
            <ul className="mt-2 flex min-w-0 flex-col gap-1">
              {citable.map((s, idx) => (
                <li key={idx} className="min-w-0">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-0 max-w-full items-center gap-1 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
                  >
                    <ExternalLinkIcon className="size-3 shrink-0" />
                    <span className="truncate">{s.title ?? s.url}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
            {locked ? (
              <>
                {isDesktopApp ? (
                  <Button size="sm" asChild>
                    <Link href={caseHref}>
                      <ExternalLinkIcon />
                      Open the case
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <a
                      href={downloadUrl ?? caseHref}
                      target={downloadUrl ? "_blank" : undefined}
                      rel={downloadUrl ? "noopener noreferrer" : undefined}
                    >
                      <ExternalLinkIcon />
                      Open on desktop
                    </a>
                  </Button>
                )}
                {intercomHref && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={intercomHref} target="_blank" rel="noopener noreferrer">
                      Open in Intercom
                    </a>
                  </Button>
                )}
              </>
            ) : unassigned ? (
              <>
                <Button size="sm" onClick={() => void assign()} disabled={busy !== null}>
                  {busy === "assign" ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <UserPlusIcon />
                  )}
                  Assign to me
                </Button>
                {intercomHref && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={intercomHref} target="_blank" rel="noopener noreferrer">
                      Open in Intercom
                    </a>
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={busy !== null}
                  title="Send is an irreversible outbound message to the customer"
                >
                  {busy === "send" ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                  Approve &amp; send
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing((e) => !e)}
                  disabled={busy !== null}
                >
                  <PencilIcon />
                  {editing ? "Done" : "Edit"}
                </Button>
                {intercomHref && (
                  <Button size="sm" variant="ghost" asChild>
                    <a href={intercomHref} target="_blank" rel="noopener noreferrer">
                      Open in Intercom
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => void reject()}
                  disabled={busy !== null}
                >
                  {busy === "reject" && <Loader2Icon className="animate-spin" />}
                  Reject
                </Button>
              </>
            )}
          </div>

          {unassigned && !locked && (
            <p className="mt-2 flex min-w-0 items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
              <UserPlusIcon className="mt-0.5 size-3.5 shrink-0" />
              Claim it first — assigning is a human-gated Intercom write, then the draft refreshes
              with your Notion access.
            </p>
          )}

          <SendConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            onConfirm={() => {
              setConfirmOpen(false)
              void send()
            }}
          />
        </div>
      )}
    </article>
  )
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border bg-card px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="ml-auto h-3 w-10" />
          </div>
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ drafting }: { drafting: number }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <InboxIcon className="size-5" />
      </div>
      <p className="text-sm font-medium">
        {drafting > 0 ? "Drafting your replies" : "You're all caught up"}
      </p>
      <p className="max-w-xs text-[12px] leading-snug text-muted-foreground">
        {drafting > 0
          ? `${drafting} ${drafting === 1 ? "reply is" : "replies are"} being written now — they show up here in a few seconds.`
          : "Replies for the conversations assigned to you appear here as they are drafted."}
      </p>
    </div>
  )
}
