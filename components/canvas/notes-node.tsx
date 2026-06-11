"use client"

import { useReactFlow, NodeResizer, type Node, type NodeProps } from "@xyflow/react"
import { StickyNoteIcon, XIcon } from "lucide-react"

import { PinButton } from "@/components/canvas/pin-button"

export type NotesData = {
  text: string
}

export type NotesNodeType = Node<NotesData, "notes">

// Agent scratchpad. The text lives in node data, so the canvas layout
// persistence (localStorage, keyed by conversation) saves it for free.
export function NotesNode({ id, data, selected }: NodeProps<NotesNodeType>) {
  const { updateNodeData, deleteElements } = useReactFlow()

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-amber-50 shadow-md dark:bg-amber-950/40">
      <NodeResizer isVisible={selected} minWidth={200} minHeight={140} />
      <div className="flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-amber-200/60 px-3 active:cursor-grabbing dark:border-amber-900/60">
        <StickyNoteIcon className="size-3.5 text-amber-600 dark:text-amber-500" />
        <span className="text-xs font-medium">Notes</span>
        <span className="nodrag ml-auto flex items-center gap-1.5">
          <PinButton nodeId={id} />
        </span>
        <button
          className="nodrag text-muted-foreground hover:text-foreground"
          title="Delete note"
          onClick={() => void deleteElements({ nodes: [{ id }] })}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <textarea
        className="nodrag nowheel h-full w-full resize-none bg-transparent p-3 text-sm outline-none placeholder:text-muted-foreground"
        placeholder="Why did I open these tools? What did I find?…"
        value={data.text}
        onChange={(e) => updateNodeData(id, { text: e.target.value })}
      />
    </div>
  )
}
