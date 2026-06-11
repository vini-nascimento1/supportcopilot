"use client"

import { NodeResizer, type Node, type NodeProps } from "@xyflow/react"
import { SparklesIcon } from "lucide-react"

import { DraftPanel } from "@/components/draft-panel"
import { PinButton } from "@/components/canvas/pin-button"

export type DraftNodeData = {
  conversationId: string
  playbookId?: string
  playbookName?: string
}

export type DraftNodeType = Node<DraftNodeData, "draft">

// The existing AI draft panel as a canvas card. The header is the drag
// handle (the panel itself is nodrag/nowheel so text selection and internal
// scrolling work); the frame fills the node bounds exactly, so the selection
// outline matches the visible card.
export function DraftNode({ id, data, selected }: NodeProps<DraftNodeType>) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card shadow-md">
      <NodeResizer isVisible={selected} minWidth={340} minHeight={300} />
      <div className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b bg-muted/50 px-3 active:cursor-grabbing">
        <SparklesIcon className="size-3.5 text-primary" />
        <span className="text-xs font-medium">AI draft reply</span>
        <span className="nodrag ml-auto">
          <PinButton nodeId={id} />
        </span>
      </div>
      <div className="nodrag nowheel min-h-0 flex-1 overflow-y-auto p-2">
        <DraftPanel
          conversationId={data.conversationId}
          playbookId={data.playbookId}
          playbookName={data.playbookName}
        />
      </div>
    </div>
  )
}
