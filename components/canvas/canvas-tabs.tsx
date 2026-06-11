"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { PlusIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface CanvasTab {
  /** conversation id, or "adhoc:<id>" for scratch canvases */
  id: string
  title: string
}

const TABS_KEY = "fv-canvas-tabs-v1"
const TABS_EVENT = "fv-canvas-tabs-changed"

function readRaw(): string {
  try {
    return localStorage.getItem(TABS_KEY) ?? "[]"
  } catch {
    return "[]"
  }
}

function writeTabs(tabs: CanvasTab[]) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs.slice(0, 12)))
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(TABS_EVENT))
}

function subscribe(cb: () => void) {
  window.addEventListener(TABS_EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(TABS_EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}

function hrefFor(tab: CanvasTab): string {
  if (tab.id.startsWith("adhoc")) {
    const suffix = tab.id.includes(":") ? tab.id.split(":")[1] : tab.id
    return `/canvas?c=${suffix}`
  }
  return `/cases/${tab.id}/canvas`
}

// Safari-style strip of recently opened canvases. The registry lives in
// localStorage (synced via useSyncExternalStore, also across windows); each
// canvas page registers itself on mount. Closing a tab only removes it from
// the strip — the canvas layout itself stays persisted.
export function CanvasTabs({ current }: { current: CanvasTab }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]")
  const tabs = useMemo<CanvasTab[]>(() => {
    try {
      const parsed = JSON.parse(raw) as CanvasTab[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }, [raw])

  // Register/refresh the current canvas at the front of the strip
  useEffect(() => {
    const existing = tabs.filter((t) => t.id !== current.id)
    const head = tabs[0]
    if (head?.id === current.id && head?.title === current.title) return
    writeTabs([current, ...existing])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id, current.title])

  const closeTab = (id: string) => {
    writeTabs(tabs.filter((t) => t.id !== id))
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const href = hrefFor(tab)
        const active = tab.id.startsWith("adhoc")
          ? pathname === "/canvas" && href.endsWith(`c=${searchParams.get("c")}`)
          : pathname === href
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
            <Link href={href} className="max-w-36 truncate">
              {tab.title}
            </Link>
            <button
              className="rounded p-0.5 opacity-0 hover:bg-muted-foreground/20 group-hover:opacity-100"
              onClick={() => closeTab(tab.id)}
              title="Remove from tabs"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        )
      })}
      <button
        // Generate the id client-side and navigate straight to it — going via
        // /canvas would add a server redirect round-trip (visible as a blank
        // flash before the new canvas loads).
        onClick={() =>
          router.push(`/canvas?c=${Math.random().toString(36).slice(2, 10)}`)
        }
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50"
        title="New canvas"
      >
        <PlusIcon className="size-3" />
      </button>
    </div>
  )
}
