"use client"

// Shared registry of open canvas tabs. Lives in localStorage so it survives
// reloads and syncs across windows; both the Safari-style strip on the legacy
// routes (canvas-tabs.tsx) and the keep-alive workspace host read/write it
// through here so the format never drifts.

export interface CanvasTab {
  /** conversation id, or "adhoc:<id>" for scratch canvases */
  id: string
  title: string
}

const KEY = "fv-canvas-tabs-v1"
const EVENT = "fv-canvas-tabs-changed"
export const MAX_TABS = 12

export function readTabsRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "[]"
  } catch {
    return "[]"
  }
}

export function readTabs(): CanvasTab[] {
  try {
    const parsed = JSON.parse(readTabsRaw()) as CanvasTab[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeTabs(tabs: CanvasTab[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tabs.slice(0, MAX_TABS)))
  } catch {
    // ignore — strip just won't persist
  }
  window.dispatchEvent(new Event(EVENT))
}

// Pure append/prepend-with-eviction: registers `tab` into `current`, moving
// it to the front ("start") or back ("end", default) if already present, and
// — if that would push the list past MAX_TABS — evicting the OLDEST tab
// rather than the one just registered. `writeTabs`'s own slice is only a
// backstop; without this, appending the 13th tab truncated the tab that was
// just added instead of the stale one, leaving `select()` pointing at a tab
// no longer in the registry (the "13th tab blanks the canvas" bug).
// Callers still need to writeTabs() the result — this doesn't touch storage.
export function registerTab(
  current: CanvasTab[],
  tab: CanvasTab,
  position: "start" | "end" = "end",
): CanvasTab[] {
  const rest = current.filter((t) => t.id !== tab.id)
  const next = position === "start" ? [tab, ...rest] : [...rest, tab]
  if (next.length <= MAX_TABS) return next
  return position === "start" ? next.slice(0, MAX_TABS) : next.slice(next.length - MAX_TABS)
}

export function subscribeTabs(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}

export function isAdhoc(id: string): boolean {
  return id.startsWith("adhoc")
}
