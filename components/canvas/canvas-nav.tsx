"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"

// When the canvas runs inside the keep-alive workspace, opening a conversation
// should switch tabs client-side (no route change, no reload) instead of
// navigating to /cases/[id]/canvas and bouncing through the mode guard back to
// /workspace — a round-trip that tears the whole keep-alive host down and
// reloads it. The workspace provides this; on the route-per-canvas pages it's
// absent and callers fall back to a normal <Link>.
type CanvasNav = {
  /** Activate (or mount) the canvas for this conversation id. */
  open: (conversationId: string) => void
  /** The conversation id currently shown, for active-state highlighting. */
  activeId: string | null
}

const CanvasNavContext = createContext<CanvasNav | null>(null)

export function CanvasNavProvider({
  open,
  activeId,
  children,
}: {
  open: (conversationId: string) => void
  activeId: string | null
  children: ReactNode
}) {
  const value = useMemo(() => ({ open, activeId }), [open, activeId])
  return <CanvasNavContext.Provider value={value}>{children}</CanvasNavContext.Provider>
}

/** Null on the route-per-canvas pages (no keep-alive host). */
export function useCanvasNav(): CanvasNav | null {
  return useContext(CanvasNavContext)
}
