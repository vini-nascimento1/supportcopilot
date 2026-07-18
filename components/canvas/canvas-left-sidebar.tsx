"use client"

import { useState, useSyncExternalStore, type ReactNode } from "react"
import {
  InboxIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RadarIcon,
  SparklesIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useCanvasActive } from "@/components/canvas/active-context"
import { InboxPanel } from "@/components/canvas/inbox-panel"
import { QueuePanel } from "@/components/canvas/queue-panel"
import { TriagePanel } from "@/components/canvas/triage-panel"

// The canvas left sidebar — a fixed, collapsible left rail on every canvas with
// three tabs:
//   • Inbox — live Intercom conversations (Mine / Unassigned / a teammate) with
//     one-click "Assign to me" and open-in-canvas.
//   • Queue — the autonomous AI reply suggestions for the agent's own cases.
//   • Triage — the swept pool of open conversations nobody is working
//     (unassigned or Fin-held), filtered/ranked by the agent's own keyword +
//     audience prefs, with the same one-click "Assign to me".
// Collapse and tab selection persist in localStorage and sync across panes via
// window events. Panels only poll while this pane is the visible one, the
// sidebar is open, and their tab is selected — so background panes don't hammer
// Intercom. Draft-only: nothing leaves the system without an explicit click.

const COLLAPSE_KEY = "fv-canvas-queue-collapsed"
const COLLAPSE_EVENT = "fv-canvas-queue-toggled"
const TAB_KEY = "fv-canvas-left-tab"
const TAB_EVENT = "fv-canvas-left-tab-changed"

type Tab = "inbox" | "queue" | "triage"

function subscribeCollapse(cb: () => void) {
  window.addEventListener(COLLAPSE_EVENT, cb)
  return () => window.removeEventListener(COLLAPSE_EVENT, cb)
}
function readCollapsed(): string {
  try {
    // Collapsed by default — the canvas already shows the app sidebar, so
    // opening this too would eat ~a third of the window. Agents open it when
    // they want to work the inbox/queue; the choice then persists.
    return localStorage.getItem(COLLAPSE_KEY) ?? "1"
  } catch {
    return "1"
  }
}

function subscribeTab(cb: () => void) {
  window.addEventListener(TAB_EVENT, cb)
  return () => window.removeEventListener(TAB_EVENT, cb)
}
function readTab(): string {
  try {
    return localStorage.getItem(TAB_KEY) ?? "inbox"
  } catch {
    return "inbox"
  }
}

export function CanvasLeftSidebar() {
  const paneActive = useCanvasActive()
  const collapsed = useSyncExternalStore(subscribeCollapse, readCollapsed, () => "1") === "1"
  const tab = (useSyncExternalStore(subscribeTab, readTab, () => "inbox") as Tab) ?? "inbox"

  const [inboxCount, setInboxCount] = useState(0)
  const [queueCount, setQueueCount] = useState(0)
  const [triageCount, setTriageCount] = useState(0)

  const toggleCollapse = () => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1")
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT))
  }

  const setTab = (t: Tab) => {
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(TAB_EVENT))
  }

  // Only the visible pane, open, on the selected tab actually polls.
  const inboxActive = paneActive && !collapsed && tab === "inbox"
  const queueActive = paneActive && !collapsed && tab === "queue"
  const triageActive = paneActive && !collapsed && tab === "triage"
  const railCount = tab === "inbox" ? inboxCount : tab === "queue" ? queueCount : triageCount

  return (
    <div
      data-canvas-chrome="left"
      className={cn(
        "absolute left-0 top-0 z-10 flex h-full flex-col border-r bg-card/95 backdrop-blur",
        collapsed ? "w-9" : "w-80"
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 py-3">
          <button
            onClick={toggleCollapse}
            title="Open the sidebar"
            className="text-muted-foreground hover:text-foreground"
          >
            <PanelLeftOpenIcon className="size-4" />
          </button>
          <InboxIcon className="size-4 text-muted-foreground" />
          {railCount > 0 && <Badge className="h-5 px-1.5 text-[10px]">{railCount}</Badge>}
        </div>
      ) : (
        <div className="flex h-10 shrink-0 items-center gap-0.5 border-b px-2">
          <TabButton
            active={tab === "inbox"}
            onClick={() => setTab("inbox")}
            icon={<InboxIcon className="size-3.5" />}
            label="Inbox"
            count={inboxCount}
          />
          <TabButton
            active={tab === "queue"}
            onClick={() => setTab("queue")}
            icon={<SparklesIcon className="size-3.5" />}
            label="Queue"
            count={queueCount}
          />
          <TabButton
            active={tab === "triage"}
            onClick={() => setTab("triage")}
            icon={<RadarIcon className="size-3.5" />}
            label="Triage"
            count={triageCount}
          />
          <button
            onClick={toggleCollapse}
            title="Collapse the sidebar"
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <PanelLeftCloseIcon className="size-4" />
          </button>
        </div>
      )}

      {/* Both panels stay mounted (state + scroll preserved across tab/collapse
          switches); only the active one polls. */}
      <div className={cn("flex min-h-0 flex-1 flex-col", collapsed && "hidden")}>
        <div className={cn("min-h-0 flex-1", tab !== "inbox" && "hidden")}>
          <InboxPanel active={inboxActive} onCount={setInboxCount} />
        </div>
        <div className={cn("min-h-0 flex-1", tab !== "queue" && "hidden")}>
          <QueuePanel active={queueActive} onCount={setQueueCount} />
        </div>
        <div className={cn("min-h-0 flex-1", tab !== "triage" && "hidden")}>
          <TriagePanel active={triageActive} onCount={setTriageCount} />
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  count: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
      {count > 0 && (
        <Badge
          variant="secondary"
          className="h-4 px-1 text-[10px] font-normal tabular-nums"
        >
          {count}
        </Badge>
      )}
    </button>
  )
}
