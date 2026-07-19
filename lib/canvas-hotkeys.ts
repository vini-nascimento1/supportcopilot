"use client"

import { useEffect, useRef } from "react"

// Keyboard accessibility for the canvas list panels (Inbox / Queue / Triage).
// Every panel wires the same two shortcuts so muscle memory carries across tabs:
//   • Ctrl/Cmd + A     → toggle select-all (select everything, or clear).
//   • Ctrl/Cmd + Enter → fire the tab's primary bulk action on the selection
//     (Inbox: Generate/Assign · Queue: Approve & send · Triage: Assign + draft).
// The listener is only attached for the ACTIVE tab (exactly one is active at a
// time — see canvas-left-sidebar), so the shortcuts never fire from a hidden
// panel or a collapsed sidebar.

/**
 * True when the event originated from a field where the user is typing —
 * inputs, textareas, selects, or any contenteditable. We must NOT hijack
 * Ctrl+A (select text) or Ctrl+Enter (submit that field, e.g. the composer /
 * inline draft edit) while the caret is in one of these.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== "string") return false
  const tag = el.tagName.toUpperCase()
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return el.isContentEditable === true
}

/**
 * Register the shared canvas-list shortcuts while `active`. Handlers are read
 * through a ref so the latest closures (over current selection/state) always
 * run without re-subscribing on every render.
 */
export function useCanvasListHotkeys(opts: {
  active: boolean
  onSelectAll?: () => void
  onPrimary?: () => void
}) {
  const ref = useRef(opts)
  ref.current = opts

  useEffect(() => {
    if (!opts.active) return
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      if (isTypingTarget(e.target)) return
      const key = e.key.toLowerCase()
      if (key === "a" && ref.current.onSelectAll) {
        e.preventDefault()
        ref.current.onSelectAll()
      } else if (key === "enter" && ref.current.onPrimary) {
        e.preventDefault()
        ref.current.onPrimary()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [opts.active])
}
