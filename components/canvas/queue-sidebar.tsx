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
import { cn } from "@/lib/utils"

interface QueueRow {
  id: string
  customer: string
  email: string | null
  state: string
  snippet: string
}

const COLLAPSE_KEY = "fv-canvas-queue-collapsed"
const COLLAPSE_EVENT = "fv-canvas-queue-toggled"

function subscribeCollapse(cb: () => void) {
  window.addEventListener(COLLAPSE_EVENT, cb)
  return () => window.removeEventListener(COLLAPSE_EVENT, cb)
}

function readCollapsed(): string {
  try {
    return localStorage.getItem(COLLAPSE_KEY) ?? "0"
  } catch {
    return "0"
  }
}

// The Intercom queue as a fixed left sidebar on every canvas (collapsible to
// a thin rail). Clicking a ticket opens that case's canvas — the whole shift
// can be worked without leaving canvas mode.
export function QueueSidebar() {
  const pathname = usePathname()
  const [rows, setRows] = useState<QueueRow[] | null>(null)
  const [error, setError] = useState(false)

  // Collapse preference in localStorage (expanded by default)
  const collapsed =
    useSyncExternalStore(subscribeCollapse, readCollapsed, () => "0") === "1"
  const toggle = () => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1")
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT))
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/cases")
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
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (collapsed) {
    return (
      <div className="absolute left-0 top-0 z-10 flex h-full w-9 flex-col items-center gap-2 border-r bg-card/95 py-3 backdrop-blur">
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
    <div className="absolute left-0 top-0 z-10 flex h-full w-64 flex-col border-r bg-card/95 backdrop-blur">
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
          const active = pathname === href
          return (
            <Link
              key={row.id}
              href={href}
              className={cn(
                "flex flex-col gap-0.5 border-b px-3 py-2 last:border-0 hover:bg-muted/50",
                active && "bg-muted",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="truncate text-xs font-medium">
                  {row.customer}
                </span>
                <Badge
                  variant={row.state === "open" ? "default" : "outline"}
                  className="ml-auto h-4 shrink-0 px-1 text-[10px]"
                >
                  {row.state}
                </Badge>
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {row.snippet}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
