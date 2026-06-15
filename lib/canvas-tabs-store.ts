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
