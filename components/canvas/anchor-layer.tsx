"use client"

import { createContext, useContext } from "react"

// DOM node that sits OUTSIDE React Flow's pannable/zoomable viewport, at the
// same screen position as the canvas pane. Pinned tool cards portal into it
// (see ToolNode) so their embedded native view stops resizing on every pan/
// zoom tick — it only reacts to real window/pane resizes.
export const AnchorLayerContext = createContext<HTMLDivElement | null>(null)

export function useAnchorLayer() {
  return useContext(AnchorLayerContext)
}
