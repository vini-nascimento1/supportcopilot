"use client"

import { createContext, useContext } from "react"

// True when the canvas this card lives on is the visible/active pane. On the
// legacy route-per-canvas pages there is only ever one canvas, so the default
// is true. In the keep-alive workspace (/workspace) inactive panes stay mounted
// but hidden, and pass active=false so heavy side effects (embedded tool
// webviews) can pause until the pane is shown again.
export const CanvasActiveContext = createContext(true)

export function useCanvasActive(): boolean {
  return useContext(CanvasActiveContext)
}
