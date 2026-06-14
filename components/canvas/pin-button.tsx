"use client"

import { useSyncExternalStore } from "react"
import { useReactFlow } from "@xyflow/react"
import { PinIcon, PinOffIcon } from "lucide-react"

import {
  isPinned,
  removePin,
  setPin,
  subscribePins,
} from "@/lib/canvas-pins"
import { cn } from "@/lib/utils"

// Header pin toggle. Pinning freezes the card at its current spot on EVERY
// canvas; unpinning makes it draggable again.
export function PinButton({ nodeId }: { nodeId: string }) {
  const { getNode, updateNode } = useReactFlow()
  const pinned = useSyncExternalStore(
    subscribePins,
    () => isPinned(nodeId),
    () => false,
  )

  const toggle = () => {
    const node = getNode(nodeId)
    if (!node) return
    if (pinned) {
      removePin(nodeId)
      updateNode(nodeId, { draggable: true, className: undefined })
    } else {
      setPin(nodeId, {
        position: node.position,
        width: node.width ?? undefined,
        height: node.height ?? undefined,
      })
      // React Flow only auto-adds the `nopan` class to *draggable* nodes. A
      // pinned node is draggable:false, so without this any mousedown-drag on
      // the card pans the whole canvas — which blocks text selection and
      // swallows clicks. Add nopan explicitly so the card stays interactive.
      updateNode(nodeId, { draggable: false, className: "nopan" })
    }
  }

  return (
    <button
      className={cn(
        "nodrag shrink-0 transition-colors",
        pinned
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
      title={pinned ? "Unpin (free to move)" : "Pin here on every canvas"}
      onClick={toggle}
    >
      {pinned ? (
        <PinIcon className="size-3.5" />
      ) : (
        <PinOffIcon className="size-3.5" />
      )}
    </button>
  )
}
