"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  InboxIcon,
  Loader2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCanvasNav } from "@/components/canvas/canvas-nav"
import { onCanvasRefresh } from "@/lib/canvas-refresh"
import { cn, relativeTime } from "@/lib/utils"

interface QueueRow {
  id: string
  customer: string
  email: string | null
  state: string
  snippet: string
  updatedAt: string | null
}

interface TeammateOption {
  intercom_admin_id: string | null
  name: string | null
}

// Persist the chosen inbox across canvases (same shift, same focus).
const INBOX_KEY = "fv-canvas-queue-inbox"

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

// The Intercom queue as a fixed left sidebar on every canvas (collapsible to
// a thin rail). Clicking a ticket opens that case's canvas — the whole shift
// can be worked without leaving canvas mode.
export function QueueSidebar() {
  const pathname = usePathname()
  const nav = useCanvasNav()
  const [rows, setRows] = useState<QueueRow[] | null>(null)
  const [error, setError] = useState(false)
  const [teammates, setTeammates] = useState<TeammateOption[]>([])
  const [inbox, setInbox] = useState<string>(() => {
    if (typeof window === "undefined") return "mine"
    try {
      return localStorage.getItem(INBOX_KEY) ?? "mine"
    } catch {
      return "mine"
    }
  })

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

  // Load the teammate list once — used to populate the inbox selector.
  useEffect(() => {
    let cancelled = false
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const list: TeammateOption[] = Array.isArray(data.agents) ? data.agents : []
        setTeammates(list.filter((a) => a.intercom_admin_id))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // (Re)load the queue whenever the selected inbox changes; poll every 30s.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/cases?inbox=${encodeURIComponent(inbox)}`)
        const data = await res.json()
        if (!cancelled) {
          setRows(Array.isArray(data.rows) ? data.rows : [])
          setError(data.mode === "error")
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }
    void load()
    const id = setInterval(load, 30_000)
    const off = onCanvasRefresh(() => void load())
    return () => {
      cancelled = true
      clearInterval(id)
      off()
    }
  }, [inbox])

  const onInboxChange = (value: string) => {
    setRows(null)
    setInbox(value)
    try {
      localStorage.setItem(INBOX_KEY, value)
    } catch {
      // ignore
    }
  }

  if (collapsed) {
    return (
      <div
        data-canvas-chrome="left"
        className="absolute left-0 top-0 z-10 flex h-full w-9 flex-col items-center gap-2 border-r bg-card/95 py-3 backdrop-blur"
      >
        <button
          onClick={toggle}
          title="Open the case queue"
          className="text-muted-foreground hover:text-foreground"
        >
          <PanelLeftOpenIcon className="size-4" />
        </button>
        <InboxIcon className="size-4 text-muted-foreground" />
        {rows !== null && rows.length > 0 && (
          <Badge className="h-5 px-1.5 text-[10px]">{rows.length}</Badge>
        )}
      </div>
    )
  }

  return (
    <div
      data-canvas-chrome="left"
      className="absolute left-0 top-0 z-10 flex h-full w-64 flex-col border-r bg-card/95 backdrop-blur"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <InboxIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium">Case queue</span>
        {rows !== null && (
          <Badge variant="secondary" className="h-5 px-1.5 font-normal">
            {rows.length}
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
      <div className="shrink-0 border-b px-2 py-2">
        <Select value={inbox} onValueChange={onInboxChange}>
          <SelectTrigger className="h-7 w-full text-xs">
            <SelectValue placeholder="Inbox" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">My inbox</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {teammates.map((t) => (
              <SelectItem
                key={t.intercom_admin_id as string}
                value={`admin:${t.intercom_admin_id}`}
              >
                {t.name ?? "Teammate"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 overflow-y-auto">
        {rows === null && (
          <div className="flex h-24 items-center justify-center">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {error ? "Couldn't load the queue." : "Queue is clear."}
          </p>
        )}
        {rows?.map((row) => {
          const href = `/cases/${row.id}/canvas`
          // In the keep-alive workspace the active case comes from the nav
          // context (the URL stays /workspace); otherwise it's the route.
          const active = nav ? nav.activeId === row.id : pathname === href
          const cls = cn(
            "flex flex-col gap-0.5 border-b px-3 py-2 last:border-0 hover:bg-muted/50",
            active && "bg-muted",
          )
          const inner = (
            <>
              <span className="flex items-center gap-2">
                <span className="truncate text-xs font-medium">
                  {row.customer}
                </span>
                {row.updatedAt && (
                  <span
                    className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground"
                    title={new Date(row.updatedAt).toLocaleString("en-GB", {
                      timeZone: "Europe/London",
                    })}
                  >
                    {relativeTime(row.updatedAt)}
                  </span>
                )}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {row.snippet}
              </span>
            </>
          )
          // Switch tabs client-side inside the workspace; navigate otherwise.
          return nav ? (
            <button
              key={row.id}
              type="button"
              onClick={() => nav.open(row.id)}
              className={cn(cls, "w-full text-left")}
            >
              {inner}
            </button>
          ) : (
            <Link key={row.id} href={href} className={cls}>
              {inner}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
