"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ExternalLinkIcon,
  InboxIcon,
  Loader2Icon,
  RefreshCwIcon,
  UserPlusIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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

// The "Inbox" tab of the canvas left sidebar: a live view of Intercom
// conversations for one inbox at a time — Mine / Unassigned / a teammate —
// so the agent can triage and pick up work without leaving the app. Selecting an
// inbox loads only that box (one Intercom search per refresh, not all at once).
// "Assign to me" reuses the human-gated assignment write (/api/reply-queue/assign).
export function InboxPanel({
  active,
  onCount,
}: {
  active: boolean
  onCount?: (n: number) => void
}) {
  const nav = useCanvasNav()
  const inbox = useSyncExternalStore(subscribeInbox, readInbox, () => "mine")
  const [admins, setAdmins] = useState<IntercomAdmin[]>([])
  const [data, setData] = useState<CasesData | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const selectInbox = (key: string) => {
    setData(null) // show the skeleton while the new box loads
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
      setData({
        mode: json.mode ?? "error",
        error: typeof json.error === "string" ? json.error : null,
        rows: Array.isArray(json.rows) ? json.rows : [],
      })
    } catch {
      setData((prev) => prev ?? { mode: "error", error: "Couldn't load cases.", rows: [] })
    }
  }, [inbox])

  // Poll every 30s + on canvas refresh, only while this tab is the active,
  // visible one. Reloads immediately when the selected inbox changes (load
  // depends on `inbox`).
  useEffect(() => {
    if (!active) return
    queueMicrotask(() => void load())
    // Snappy refresh — this is the live triage list the agent works from.
    const id = setInterval(() => void load(), 10_000)
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

  const assignToMe = async (id: string) => {
    setAssigningId(id)
    try {
      const res = await fetch("/api/reply-queue/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Assigned to you.")
      if (nav) nav.open(id)
      await load()
    } catch {
      toast.error("Couldn't assign this case.")
    } finally {
      setAssigningId(null)
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
      {/* Inbox picker — pinned to the top of the panel. */}
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-2">
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
            {rows.map((row) => (
              <ConversationRow
                key={row.id}
                row={row}
                showAssign={showAssign}
                assigning={assigningId === row.id}
                onAssign={() => void assignToMe(row.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ConversationRow({
  row,
  showAssign,
  assigning,
  onAssign,
}: {
  row: SupportCase
  showAssign: boolean
  assigning: boolean
  onAssign: () => void
}) {
  const nav = useCanvasNav()
  const open = () => {
    if (nav) nav.open(row.id)
  }

  return (
    <article className="rounded-md border bg-card transition-colors hover:border-foreground/20">
      {nav ? (
        <button
          type="button"
          onClick={open}
          className="flex w-full flex-col gap-0.5 px-2.5 pt-2 text-left"
        >
          <RowHeader row={row} />
        </button>
      ) : (
        <Link
          href={`/cases/${row.id}/canvas`}
          className="flex w-full flex-col gap-0.5 px-2.5 pt-2 text-left"
        >
          <RowHeader row={row} />
        </Link>
      )}

      <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1.5">
        <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
          {row.state}
        </Badge>
        {row.tip && (
          <span className="truncate text-[10px] text-muted-foreground" title={row.tip.playbook}>
            {row.tip.playbook}
          </span>
        )}
        {row.intercomUrl && (
          <a
            href={row.intercomUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open directly in Intercom"
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
        {showAssign && (
          <Button
            size="sm"
            className="ml-auto h-6 px-2 text-[10px]"
            onClick={onAssign}
            disabled={assigning}
          >
            {assigning ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <UserPlusIcon className="size-3" />
            )}
            Assign to me
          </Button>
        )}
      </div>
    </article>
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
