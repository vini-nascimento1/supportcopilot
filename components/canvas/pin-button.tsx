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
      updateNode(nodeId, { draggable: true })
    } else {
      setPin(nodeId, {
        position: node.position,
        width: node.width ?? undefined,
        height: node.height ?? undefined,
      })
      updateNode(nodeId, { draggable: false })
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
