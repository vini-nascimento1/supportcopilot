"use client"

import { createContext, useContext, useSyncExternalStore } from "react"
import { useReactFlow } from "@xyflow/react"
import { PinIcon, PinOffIcon } from "lucide-react"

import {
  isPinned,
  removePin,
  setPin,
  subscribePins,
} from "@/lib/canvas-pins"
import { cn } from "@/lib/utils"

export interface SavedNodeGeometry {
  position: { x: number; y: number }
  width?: number
  height?: number
}

// Lets the unpin action put a card back where THIS case had it, instead of
// stranding it at the global pin spot. Provided by CaseCanvas (see
// case-canvas.tsx, SavedLayoutContext.Provider) — the default is "nothing
// saved" so PinButton still degrades gracefully without a provider.
const SavedLayoutContext = createContext<
  (nodeId: string) => SavedNodeGeometry | undefined
>(() => undefined)
export const SavedLayoutProvider = SavedLayoutContext.Provider

// Strips only the "nopan" token pin-on adds (see below), preserving any other
// classes the card already had — unlike a blanket `className: undefined`.
function stripNopan(className: string | undefined): string | undefined {
  if (!className) return undefined
  const stripped = className
    .split(" ")
    .filter((c) => c && c !== "nopan")
    .join(" ")
  return stripped || undefined
}

// Header pin toggle. Pinning freezes the card at its current spot on EVERY
// canvas; unpinning makes it draggable again.
export function PinButton({ nodeId }: { nodeId: string }) {
  const { getNode, updateNode } = useReactFlow()
  const getSavedGeometry = useContext(SavedLayoutContext)
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
      // Restore this case's own geometry if it has one saved — without this
      // the card stays at the pin's global position/size forever, since
      // applyPins already overwrote it at mount (see case-canvas.tsx).
      const saved = getSavedGeometry(nodeId)
      updateNode(nodeId, {
        ...(saved
          ? {
              position: saved.position,
              ...(saved.width !== undefined ? { width: saved.width } : {}),
              ...(saved.height !== undefined ? { height: saved.height } : {}),
            }
          : {}),
        draggable: true,
        className: stripNopan(node.className),
      })
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
      updateNode(nodeId, {
        draggable: false,
        className: node.className ? `${node.className} nopan` : "nopan",
      })
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
