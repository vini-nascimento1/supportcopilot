"use client"

// "Hard multitasking" preference for the canvas. When ON, opened canvases are
// kept mounted in a single client host (/workspace) and switching tabs only
// toggles visibility — nothing unmounts, so AI chats / drafts / notes stay live
// at the cost of more memory. Default OFF keeps the lighter route-per-canvas
// behaviour. The flag is a per-device UI preference, so it lives in
// localStorage (same pattern as the tab strip and the edge-visibility toggle).

import { useSyncExternalStore } from "react"

const KEY = "fv-canvas-multitask"
const EVENT = "fv-canvas-multitask-changed"

/** Synchronous read — safe to call from redirect guards on mount. */
export function readMultitask(): boolean {
  if (typeof window === "undefined") return false
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function setMultitask(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0")
  } catch {
    // storage unavailable — preference just won't persist
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}

/** Reactive flag for components that should re-render when it flips. */
export function useCanvasMultitask(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (readMultitask() ? "1" : "0"),
    () => "0",
  ) === "1"
}
