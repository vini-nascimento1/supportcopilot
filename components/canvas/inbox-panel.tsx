"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  CircleCheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  InboxIcon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
  StarIcon,
  UserPlusIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCanvasNav } from "@/components/canvas/canvas-nav"
import { broadcastCanvasRefresh, onCanvasRefresh } from "@/lib/canvas-refresh"
import { addPendingOnRequestDrafts } from "@/lib/on-request-drafts"
import {
  CHECKIN_MACRO,
  REVIEW_MACRO,
  customerSilentMinutes,
  inboxSlaSeverity,
  type QuickMacro,
  type SlaSeverity,
} from "@/lib/inbox-sla"
import { cn, relativeTime } from "@/lib/utils"

// Mirrors the server types (lib/intercom.ts SupportCase / IntercomAdmin and
// lib/case-intelligence.ts CaseTip) — those modules are server-only and can't be
// imported into a client component.
type CaseTip = { playbook: string; confidence: "high" | "medium" | "low" }
type SupportCase = {
  id: string
  customer: string
  email: string | null
  state: string
  updatedAt: string | null
  snippet: string
  intercomUrl: string | null
  tip: CaseTip | null
  waitingSince: string | null
  lastAdminReplyAt: string | null
}
type CasesData = { mode: "live" | "demo" | "error"; error: string | null; rows: SupportCase[] }
type IntercomAdmin = { id: string; name: string; email: string | null }

const INBOX_KEY = "fv-canvas-inbox"
const INBOX_EVENT = "fv-canvas-inbox-changed"

// localStorage-backed selection, read via useSyncExternalStore so it's SSR-safe
// (no localStorage access during render) and synced across panes via the event.
function subscribeInbox(cb: () => void) {
  window.addEventListener(INBOX_EVENT, cb)
  return () => window.removeEventListener(INBOX_EVENT, cb)
}
function readInbox(): string {
  try {
    return localStorage.getItem(INBOX_KEY) ?? "mine"
  } catch {
    return "mine"
  }
}

// The "Inbox" tab of the canvas left sidebar: a live, minimal triage list of
// Intercom conversations for one box at a time — Mine / Unassigned / a teammate.
// Every conversation shown is already open (the default filter), so cards stay
// lean: just who + when + a one-line snippet. Work happens through checkbox
// SELECTION + one contextual bulk action at the bottom — "Generate AI replies"
// in Mine, "Assign to me" in the other boxes (a human-gated Intercom write,
// /api/reply-queue/assign). Opening a card switches to it in the workspace.
export function InboxPanel({
  active,
  onCount,
}: {
  active: boolean
  onCount?: (n: number) => void
}) {
  const inbox = useSyncExternalStore(subscribeInbox, readInbox, () => "mine")
  const [admins, setAdmins] = useState<IntercomAdmin[]>([])
  const [data, setData] = useState<CasesData | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [acting, setActing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  // Wall-clock, ticked by the poll below (never Date.now() during render — that
  // would be impure). Drives the per-row SLA staleness colouring so a row can
  // tip amber/red between reloads. Starts at 0 → severity is "none" on first
  // paint (see lib/inbox-sla.ts), then hydrates in the poll effect.
  const [now, setNow] = useState(0)
  const masterRef = useRef<HTMLInputElement>(null)
  // Anchor index for shift-click range selection (the last single-toggled row).
  const anchorRef = useRef<number | null>(null)

  const selectInbox = (key: string) => {
    setData(null) // show the skeleton while the new box loads
    setSelectedIds(new Set()) // selection doesn't carry across boxes
    setConfirmClose(false)
    anchorRef.current = null
    try {
      localStorage.setItem(INBOX_KEY, key)
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(INBOX_EVENT))
  }

  // Teammates for the picker — fetch once when the tab first becomes active.
  useEffect(() => {
    if (!active || admins.length > 0) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/intercom/admins")
        const json = await res.json()
        if (!cancelled && Array.isArray(json.admins)) setAdmins(json.admins)
      } catch {
        // non-fatal — the picker still has Mine / Unassigned
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, admins.length])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases?inbox=${encodeURIComponent(inbox)}`)
      const json = await res.json()
      const nextRows: SupportCase[] = Array.isArray(json.rows) ? json.rows : []
      setData({
        mode: json.mode ?? "error",
        error: typeof json.error === "string" ? json.error : null,
        rows: nextRows,
      })
      // Drop any selected ids that polled away (replied/closed), so the bulk
      // action only ever acts on conversations still in the list.
      const present = new Set(nextRows.map((r) => r.id))
      setSelectedIds((prev) => {
        let changed = false
        const next = new Set<string>()
        prev.forEach((id) => (present.has(id) ? next.add(id) : (changed = true)))
        return changed ? next : prev
      })
    } catch {
      setData((prev) => prev ?? { mode: "error", error: "Couldn't load cases.", rows: [] })
    }
  }, [inbox])

  // Poll every 10s + on canvas refresh, only while this tab is the active,
  // visible one. Reloads immediately when the selected inbox changes (load
  // depends on `inbox`).
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    tick()
    queueMicrotask(() => void load())
    // Snappy refresh — this is the live triage list the agent works from. The
    // same interval advances `now` so SLA tints cross the 30/60-min thresholds
    // without waiting on new data.
    const id = setInterval(() => {
      tick()
      void load()
    }, 10_000)
    const off = onCanvasRefresh(() => void load())
    return () => {
      clearInterval(id)
      off()
    }
  }, [active, load])

  const rows = data?.rows ?? null
  useEffect(() => {
    onCount?.(rows?.length ?? 0)
  }, [rows, onCount])

  const showAssign = inbox !== "mine"
  const allSelected = (rows?.length ?? 0) > 0 && selectedIds.size === rows!.length
  const someSelected = selectedIds.size > 0 && !allSelected
  // Native checkbox indeterminate can only be set imperatively, in an effect.
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someSelected
  }, [someSelected])

  // Toggle one row, or — when shift is held and we have an anchor — select the
  // whole contiguous range from the anchor to here (Gmail/Finder behaviour). The
  // anchor only moves on a plain (non-shift) click, so repeated shift-clicks
  // extend from the same starting row.
  const toggleAt = useCallback(
    (index: number, shift: boolean) => {
      const list = rows ?? []
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (shift && anchorRef.current !== null) {
          const lo = Math.min(anchorRef.current, index)
          const hi = Math.max(anchorRef.current, index)
          for (let i = lo; i <= hi; i++) {
            const id = list[i]?.id
            if (id) next.add(id)
          }
        } else {
          const id = list[index]?.id
          if (id) {
            if (next.has(id)) next.delete(id)
            else next.add(id)
          }
          anchorRef.current = index
        }
        return next
      })
    },
    [rows]
  )

  const toggleAll = useCallback(() => {
    anchorRef.current = null
    setSelectedIds((prev) =>
      prev.size === (rows?.length ?? 0) ? new Set() : new Set((rows ?? []).map((r) => r.id))
    )
  }, [rows])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setConfirmClose(false)
    anchorRef.current = null
  }, [])

  // Manual "Refresh" — runs the whole loop on demand instead of waiting for the
  // poll: reload this inbox now AND force the AI to (re)generate drafts for any
  // non-read conversations that are still missing one (?force=1 bypasses the
  // backfill recency guard). broadcastCanvasRefresh nudges the Queue tab too.
  const manualRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        load(),
        fetch("/api/reply-queue?force=1").catch(() => {}),
      ])
      broadcastCanvasRefresh()
      toast.success("Refreshed — AI drafts are generating; they'll land in the Queue tab.")
    } finally {
      setRefreshing(false)
    }
  }

  // Bulk: generate AI reply drafts for the selected tickets (Mine box). Persists
  // on-request drafts that land in the Queue tab's "On request" group — including
  // already-read tickets the always-on pipeline skips. Generation runs in the
  // background server-side; we kick it off and nudge the Queue.
  const bulkGenerate = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setActing(true)
    try {
      const res = await fetch("/api/reply-queue/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: ids }),
      })
      if (!res.ok) throw new Error(await res.text())
      const json = (await res.json().catch(() => ({}))) as { started?: number; dropped?: number }
      const started = typeof json.started === "number" ? json.started : ids.length
      const dropped = typeof json.dropped === "number" ? json.dropped : 0
      const selectedRows = (rows ?? []).filter((row) => ids.includes(row.id)).slice(0, started)
      addPendingOnRequestDrafts(
        selectedRows.map((row) => ({
          conversationId: row.id,
          customerName: row.customer,
          subject: row.snippet,
        }))
      )
      clearSelection()
      broadcastCanvasRefresh()
      toast.success(
        started === 1
          ? "Drafting a reply — it'll appear in the Queue tab."
          : `Drafting ${started} replies — they'll appear in the Queue tab.${
              dropped > 0 ? ` (${dropped} skipped — too many at once.)` : ""
            }`
      )
    } catch {
      toast.error("Couldn't start generation. Try again.")
    } finally {
      setActing(false)
    }
  }

  // Bulk: assign the selected tickets to me (Unassigned / teammate boxes). Each
  // is a human-gated Intercom write (/api/reply-queue/assign), fired from this
  // explicit click; the draft then (re)generates with my Notion context.
  const bulkAssign = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setActing(true)
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch("/api/reply-queue/assign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: id }),
          }).then((r) => {
            if (!r.ok) throw new Error()
          })
        )
      )
      const ok = results.filter((r) => r.status === "fulfilled").length
      const failed = ids.length - ok
      clearSelection()
      if (ok > 0) {
        toast.success(
          `Assigned ${ok} to you${failed > 0 ? `, ${failed} failed` : ""}. Drafts are regenerating.`
        )
      } else {
        toast.error("Couldn't assign — try again.")
      }
      await load()
      broadcastCanvasRefresh()
    } finally {
      setActing(false)
    }
  }

  // Bulk: close the selected conversations in Intercom. A real, outward-facing
  // write (ADR-0011) — gated behind an explicit confirm click. Each closes as the
  // agent's own admin id via /api/cases/close. Closed tickets leave the open
  // inbox on reload.
  const bulkClose = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setActing(true)
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch("/api/cases/close", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: id }),
          }).then((r) => {
            if (!r.ok) throw new Error()
          })
        )
      )
      const ok = results.filter((r) => r.status === "fulfilled").length
      const failed = ids.length - ok
      clearSelection()
      if (ok > 0) {
        toast.success(`Closed ${ok}${failed > 0 ? `, ${failed} failed` : ""}.`)
      } else {
        toast.error("Couldn't close — try again.")
      }
      await load()
      broadcastCanvasRefresh()
    } finally {
      setActing(false)
    }
  }

  const activeLabel =
    inbox === "mine"
      ? "Mine"
      : inbox === "unassigned"
        ? "Unassigned"
        : admins.find((a) => `admin:${a.id}` === inbox)?.name ?? "Teammate"

  return (
    <div className="flex h-full flex-col">
      {/* Inbox picker + select-all — pinned to the top of the panel. */}
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-2">
        {rows !== null && rows.length > 0 && (
          <input
            ref={masterRef}
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Select all"
            title="Select all"
            className="size-3.5 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary"
          />
        )}
        <Select value={inbox} onValueChange={selectInbox}>
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">Mine</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {admins.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[10px]">Teammates</SelectLabel>
                {admins.map((a) => (
                  <SelectItem key={a.id} value={`admin:${a.id}`}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        {rows !== null && (
          <Badge variant="secondary" className="h-5 shrink-0 px-1.5 font-normal tabular-nums">
            {rows.length}
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 px-0 text-muted-foreground hover:text-foreground"
          onClick={() => void manualRefresh()}
          disabled={refreshing}
          title="Refresh now — reloads this inbox and generates any missing AI drafts"
        >
          <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {data === null && <ListSkeleton />}
        {data !== null && rows !== null && rows.length === 0 && (
          <EmptyState label={activeLabel} error={data.error} />
        )}
        {data !== null && rows !== null && rows.length > 0 && (
          <div className="flex flex-col gap-1.5 p-2">
            {data.mode === "demo" && (
              <p className="px-1 text-[11px] text-muted-foreground">
                Demo data — set INTERCOM_ADMIN_ID to see live conversations.
              </p>
            )}
            {data.error && <p className="px-1 text-xs text-destructive">{data.error}</p>}
            {rows.map((row, index) => (
              <ConversationRow
                key={row.id}
                row={row}
                now={now}
                selected={selectedIds.has(row.id)}
                onToggle={(shift) => toggleAt(index, shift)}
                onActed={async () => {
                  await load()
                  broadcastCanvasRefresh()
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bulk actions — appear only with a selection. Tip: shift-click a second
          checkbox to select the whole range between it and the last one. */}
      {selectedIds.size > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-muted/40 px-2 py-2">
          <span className="text-xs font-medium tabular-nums">{selectedIds.size} selected</span>
          <button
            type="button"
            onClick={clearSelection}
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear
          </button>
          {confirmClose ? (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">
                Close {selectedIds.size}?
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-[11px]"
                onClick={() => setConfirmClose(false)}
                disabled={acting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 gap-1.5 px-2.5 text-[11px]"
                onClick={() => void bulkClose()}
                disabled={acting}
              >
                {acting ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <CircleCheckIcon className="size-3.5" />
                )}
                Close
              </Button>
            </div>
          ) : (
            <div className="ml-auto flex items-center gap-1.5">
              {showAssign ? (
                <Button
                  size="sm"
                  className="h-7 gap-1.5 px-2.5 text-[11px]"
                  onClick={() => void bulkAssign()}
                  disabled={acting}
                >
                  {acting ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <UserPlusIcon className="size-3.5" />
                  )}
                  Assign to me
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 gap-1.5 px-2.5 text-[11px]"
                  onClick={() => void bulkGenerate()}
                  disabled={acting}
                >
                  {acting ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <SparklesIcon className="size-3.5" />
                  )}
                  Generate AI replies
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2.5 text-[11px]"
                onClick={() => setConfirmClose(true)}
                disabled={acting}
                title="Close the selected conversations in Intercom"
              >
                <CircleCheckIcon className="size-3.5" />
                Close
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Subtle left-accent + faint fill per SLA staleness. Selection (agent actively
// working the row) is a stronger signal, so it wins over the tint.
const SEVERITY_ROW_CLASS: Record<Exclude<SlaSeverity, "none">, string> = {
  warn: "border-l-2 border-l-amber-400 bg-amber-50/40 hover:border-foreground/20 dark:border-l-amber-500/70 dark:bg-amber-500/10",
  urgent: "border-l-2 border-l-red-400 bg-red-50/50 hover:border-foreground/20 dark:border-l-red-500/70 dark:bg-red-500/10",
}

function ConversationRow({
  row,
  now,
  selected,
  onToggle,
  onActed,
}: {
  row: SupportCase
  now: number
  selected: boolean
  onToggle: (shift: boolean) => void
  onActed: () => void | Promise<void>
}) {
  const nav = useCanvasNav()
  const open = () => {
    if (nav) nav.open(row.id)
  }

  const severity = inboxSlaSeverity(row.waitingSince, row.lastAdminReplyAt, now)

  return (
    <article
      className={cn(
        "group flex items-start gap-2 rounded-md border bg-card px-2.5 py-2 transition-colors",
        selected
          ? "border-foreground/30 bg-accent/40"
          : severity !== "none"
            ? SEVERITY_ROW_CLASS[severity]
            : "hover:border-foreground/20"
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => {}}
        // onClick (not onChange) carries shiftKey — needed for range selection.
        onClick={(e) => {
          e.stopPropagation()
          onToggle(e.shiftKey)
        }}
        aria-label={`Select ${row.customer}`}
        className="mt-0.5 size-3.5 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary"
      />

      {nav ? (
        <button
          type="button"
          onClick={open}
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
        >
          <RowHeader row={row} />
        </button>
      ) : (
        <Link
          href={`/cases/${row.id}/canvas`}
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
        >
          <RowHeader row={row} />
        </Link>
      )}

      <div className="mt-0.5 flex shrink-0 items-center gap-1">
        {/* Check-in & close — only when the customer has gone quiet on us
            (see lib/inbox-sla.ts). Tint matches the row severity. */}
        {severity !== "none" && (
          <QuickCloseButton
            conversationId={row.id}
            macro={CHECKIN_MACRO}
            icon={ClockIcon}
            tone={severity}
            hint={`Customer quiet ${customerSilentMinutes(row.lastAdminReplyAt, now)}m`}
            onActed={onActed}
          />
        )}
        {/* Review request & close — available on hover for any ticket. */}
        <QuickCloseButton
          conversationId={row.id}
          macro={REVIEW_MACRO}
          icon={StarIcon}
          tone="neutral"
          hoverOnly
          onActed={onActed}
        />
        {row.intercomUrl && (
          <a
            href={row.intercomUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open directly in Intercom"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
      </div>
    </article>
  )
}

// A minimalist per-row quick action: one icon button that, on confirm, sends a
// fixed macro to the customer and then closes the ticket. Sending a real
// customer message + closing is outward-facing and hard to undo, so it's gated
// behind a small confirm popover that previews the exact macro first (never a
// bare one-click send).
const TONE_ICON_CLASS: Record<"warn" | "urgent" | "neutral", string> = {
  warn: "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300",
  urgent: "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300",
  neutral: "text-muted-foreground hover:text-foreground",
}

function QuickCloseButton({
  conversationId,
  macro,
  icon: Icon,
  tone,
  hint,
  hoverOnly,
  onActed,
}: {
  conversationId: string
  macro: QuickMacro
  icon: typeof ClockIcon
  tone: "warn" | "urgent" | "neutral"
  hint?: string
  hoverOnly?: boolean
  onActed: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)

  const run = async () => {
    if (sending) return
    setSending(true)
    try {
      // Send first — if the reply fails we must NOT close (mirrors the queue's
      // send-then-followup ordering). Macro HTML is sent verbatim (html: true).
      const sent = await fetch("/api/draft/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body: macro.html, html: true }),
      })
      if (!sent.ok) throw new Error("send failed")
      const closed = await fetch("/api/cases/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      })
      setOpen(false)
      if (closed.ok) {
        toast.success("Sent & closed.")
      } else {
        toast.warning("Sent, but couldn't close it — try closing manually.")
      }
      await onActed()
    } catch {
      toast.error("Couldn't send — nothing was closed. Try again.")
      setSending(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={macro.label}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "rounded p-0.5 transition-colors",
            TONE_ICON_CLASS[tone],
            hoverOnly && !open && "opacity-0 group-hover:opacity-100"
          )}
        >
          <Icon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 text-xs leading-relaxed"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-medium">{macro.label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        <p className="mt-2 whitespace-pre-line rounded bg-muted/60 p-2 text-[11px] text-foreground/80">
          {macro.text}
        </p>
        <div className="mt-2.5 flex justify-end">
          <Button size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => void run()} disabled={sending}>
            {sending ? <Loader2Icon className="size-3.5 animate-spin" /> : <CircleCheckIcon className="size-3.5" />}
            Send &amp; close
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function RowHeader({ row }: { row: SupportCase }) {
  return (
    <>
      <span className="flex items-center gap-2">
        <span className="truncate text-xs font-medium">{row.customer}</span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {relativeTime(row.updatedAt) || "—"}
        </span>
      </span>
      {row.snippet && (
        <span className="line-clamp-1 text-[11px] text-muted-foreground">{row.snippet}</span>
      )}
    </>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-md border bg-card px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ml-auto h-2.5 w-8" />
          </div>
          <Skeleton className="mt-1.5 h-2.5 w-5/6" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ label, error }: { label: string; error: string | null }) {
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
        {error ? "Couldn't load this inbox." : `No open cases in ${label.toLowerCase()}`}
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {error
          ? "Retrying every 30 seconds."
          : "Switch inbox above to see another box, or check back as new conversations come in."}
      </p>
    </div>
  )
}
