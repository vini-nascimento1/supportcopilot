"use client"

import { Handle, Position } from "@xyflow/react"

// Every card needs these for the "link wire" feature to work at all: React
// Flow can only route an edge to/from a node that has a matching Handle in
// its DOM — without one, edges silently fail to render (no path to draw) and
// dragging a new connection from the card has nothing to grab. One target
// (left) + one source (right), both with the default (null) id so the
// existing edges — none of which specify a handle id — resolve automatically.
export function CardHandles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border !border-border !bg-muted-foreground/60"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border !border-border !bg-muted-foreground/60"
      />
    </>
  )
}
