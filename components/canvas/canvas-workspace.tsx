"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { LayersIcon, PlusIcon, XIcon } from "lucide-react"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import {
  isAdhoc,
  readTabs,
  readTabsRaw,
  subscribeTabs,
  writeTabs,
  type CanvasTab,
} from "@/lib/canvas-tabs-store"
import { type CanvasTool } from "@/lib/canvas-tools"
import { CanvasPane } from "@/components/canvas/canvas-pane"

interface Props {
  tools: CanvasTool[]
  downloadUrl?: string
  /** From ?id= — the tab to show first (a conversation id or "adhoc:<id>"). */
  initialActiveId?: string
}

function newAdhocId(): string {
  return `adhoc:${Math.random().toString(36).slice(2, 10)}`
}

function syncUrl(id: string) {
  try {
    window.history.replaceState(null, "", `/workspace?id=${encodeURIComponent(id)}`)
  } catch {
    // ignore — URL sync is best-effort
  }
}

// Keep-alive canvas host. Every canvas you open stays mounted for the session;
// switching tabs only toggles visibility (no route change, no unmount), so AI
// chats, drafts and notes stay live. Panes are mounted lazily — a tab in the
// strip you haven't opened yet doesn't fetch until you first click it — and
// then never torn down until you close it. This is the "hard multitasking"
// mode; the lighter route-per-canvas behaviour lives on /cases/[id]/canvas.
export function CanvasWorkspace({ tools, downloadUrl, initialActiveId }: Props) {
  const raw = useSyncExternalStore(subscribeTabs, readTabsRaw, () => "[]")
  const tabs = useMemo<CanvasTab[]>(() => {
    try {
      const parsed = JSON.parse(raw) as CanvasTab[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }, [raw])

  const [activeId, setActiveId] = useState<string | null>(null)
  // Ids that have been activated at least once — kept mounted (hidden) so they
  // never reload. We render a pane only for ids in this set AND still in the
  // strip.
  const [mounted, setMounted] = useState<string[]>([])
  const [ready, setReady] = useState(false)

  const ensureRegistered = useCallback((id: string, title?: string) => {
    const current = readTabs()
    if (current.some((t) => t.id === id)) return
    writeTabs([...current, { id, title: title ?? (isAdhoc(id) ? "Canvas" : `#${id}`) }])
  }, [])

  const select = useCallback(
    (id: string) => {
      ensureRegistered(id)
      setActiveId(id)
      setMounted((prev) => (prev.includes(id) ? prev : [...prev, id]))
      syncUrl(id)
    },
    [ensureRegistered],
  )

  const addAdhoc = useCallback(() => {
    const id = newAdhocId()
    writeTabs([...readTabs(), { id, title: "Canvas" }])
    select(id)
  }, [select])

  const close = useCallback(
    (id: string) => {
      const current = readTabs()
      const idx = current.findIndex((t) => t.id === id)
      const remaining = current.filter((t) => t.id !== id)
      writeTabs(remaining)
      setMounted((prev) => prev.filter((m) => m !== id))
      if (activeId !== id) return
      const next = remaining[Math.max(0, idx - 1)] ?? remaining[0]
      if (next) select(next.id)
      else addAdhoc()
    },
    [activeId, select, addAdhoc],
  )

  const handleResolveTitle = useCallback((id: string, title: string) => {
    const current = readTabs()
    const tab = current.find((t) => t.id === id)
    if (tab && tab.title !== title) {
      writeTabs(current.map((t) => (t.id === id ? { ...t, title } : t)))
    }
  }, [])

  // One-time bootstrap of the active tab once we're on the client. Reading the
  // tab registry from localStorage and picking the active pane is exactly the
  // "initialise from an external store on mount" case — the synchronous
  // setState here is intentional and runs once.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const current = readTabs()
    if (initialActiveId) {
      select(initialActiveId)
    } else if (current.length > 0) {
      select(current[0].id)
    } else {
      addAdhoc()
    }
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const panes = tabs.filter((t) => mounted.includes(t.id))

  return (
    <div className="flex h-svh w-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-3">
        <SidebarTrigger />
        <LayersIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeId
            return (
              <span
                key={tab.id}
                className={cn(
                  "group flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs",
                  active
                    ? "border-border bg-muted font-medium"
                    : "border-transparent text-muted-foreground hover:bg-muted/50",
                )}
              >
                <button
                  className="max-w-36 truncate"
                  onClick={() => select(tab.id)}
                  title={tab.title}
                >
                  {tab.title}
                </button>
                <button
                  className="rounded p-0.5 opacity-0 hover:bg-muted-foreground/20 group-hover:opacity-100"
                  onClick={() => close(tab.id)}
                  title="Close tab"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            )
          })}
          <button
            onClick={addAdhoc}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50"
            title="New canvas"
          >
            <PlusIcon className="size-3" />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {!ready && <div className="h-full w-full" />}
        {panes.map((tab) => (
          <div
            key={tab.id}
            className={cn("absolute inset-0", tab.id !== activeId && "hidden")}
          >
            <CanvasPane
              tab={tab}
              active={tab.id === activeId}
              tools={tools}
              downloadUrl={downloadUrl}
              onResolveTitle={handleResolveTitle}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
