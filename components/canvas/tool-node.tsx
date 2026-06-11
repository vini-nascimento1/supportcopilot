"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  NodeResizer,
  useReactFlow,
  useStoreApi,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MinusIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { PinButton } from "@/components/canvas/pin-button"
import { getCanvasHost } from "@/lib/canvas-host"
import { hasBlockingOverlay } from "@/lib/canvas-overlay"
import { ToolIcon } from "@/lib/tool-icons"
import { cn } from "@/lib/utils"

export type ToolNodeData = {
  label: string
  url: string
  icon?: string | null
  /** Suggested-but-unconfirmed: render translucent, load nothing until the
      agent clicks "Open" (nothing loads without confirmation). */
  ghost?: boolean
}

export type ToolNodeType = Node<ToolNodeData, "tool">

// Synchronizes the screen-space rect of the card body with the native
// WebContentsView in the desktop shell. A per-node rAF loop reads
// getBoundingClientRect (cheap for a handful of nodes) so drag, pan, zoom and
// resize are all covered by one mechanism.
export function ToolNode({ id, data, selected }: NodeProps<ToolNodeType>) {
  const host = getCanvasHost()
  const bodyRef = useRef<HTMLDivElement>(null)
  const { deleteElements, updateNodeData } = useReactFlow()
  const store = useStoreApi()

  const [minimized, setMinimized] = useState(false)
  const minimizedRef = useRef(minimized)
  const [title, setTitle] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Live URL of the native view (follows redirects/SSO hops); editable —
  // Enter navigates the view. Resets to the live value on blur/Escape.
  const [liveUrl, setLiveUrl] = useState(data.url)
  const [urlDraft, setUrlDraft] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    minimizedRef.current = minimized
  }, [minimized])

  const ghost = data.ghost === true

  useEffect(() => {
    if (!host || ghost) return
    let raf = 0
    let lastKey = ""
    const unsubscribe = host.onToolEvent((event) => {
      if (event.id !== id) return
      if (event.kind === "title") setTitle(event.value)
      if (event.kind === "loading") setLoading(event.value)
      if (event.kind === "url") setLiveUrl(event.value)
    })
    void host.openTool(id, data.url)

    const tick = () => {
      const el = bodyRef.current
      if (el) {
        const r = el.getBoundingClientRect()
        const zoom = store.getState().transform[2]
        const hidden =
          minimizedRef.current ||
          r.width < 60 ||
          r.height < 60 ||
          hasBlockingOverlay()
        const key = hidden
          ? "hidden"
          : `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)},${zoom.toFixed(2)}`
        if (key !== lastKey) {
          lastKey = key
          if (hidden) {
            host.setToolVisible(id, false)
          } else {
            host.setToolBounds(
              id,
              {
                x: Math.round(r.x),
                y: Math.round(r.y),
                width: Math.round(r.width),
                height: Math.round(r.height),
              },
              zoom,
            )
            host.setToolVisible(id, true)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      unsubscribe()
      host.closeTool(id)
    }
    // host/id/url are stable for the lifetime of the node; ghost flips once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghost])

  const handleClose = useCallback(() => {
    void deleteElements({ nodes: [{ id }] })
  }, [deleteElements, id])

  if (ghost) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-card/50 p-6 text-center opacity-70 shadow-sm",
          selected && "ring-2 ring-ring",
        )}
      >
        <ToolIcon name={data.icon} className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{data.label}</p>
        <p className="text-xs text-muted-foreground">
          Suggested for this case — nothing loads until you confirm.
        </p>
        <div className="nodrag flex gap-2">
          <Button size="sm" onClick={() => updateNodeData(id, { ghost: false })}>
            Open {data.label}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClose}>
            Dismiss
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card shadow-md",
        selected && "ring-2 ring-ring",
      )}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={280}
        minHeight={minimized ? 40 : 200}
      />
      <div className="flex h-10 shrink-0 cursor-grab items-center gap-2 border-b bg-muted/50 px-3 active:cursor-grabbing">
        {loading ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <ToolIcon
            name={data.icon}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
        <span className="truncate text-xs font-medium">
          {data.label}
          {title && (
            <span className="text-muted-foreground"> — {title}</span>
          )}
        </span>
        <div className="nodrag ml-auto flex items-center gap-1">
          <PinButton nodeId={id} />
          {host && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="Reload"
              onClick={() => host.reloadTool(id)}
            >
              <RotateCcwIcon className="size-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="Open in browser"
            onClick={() =>
              window.open(host ? liveUrl : data.url, "_blank", "noopener,noreferrer")
            }
          >
            <ExternalLinkIcon className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title={minimized ? "Restore" : "Minimize"}
            onClick={() => setMinimized((m) => !m)}
          >
            {minimized ? (
              <SquareIcon className="size-3" />
            ) : (
              <MinusIcon className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="Close"
            onClick={handleClose}
          >
            <XIcon className="size-3" />
          </Button>
        </div>
      </div>

      {!minimized && host && (
        <div className="nodrag flex h-7 shrink-0 items-center gap-1 border-b bg-muted/30 px-2">
          <input
            className="h-5 w-full min-w-0 flex-1 rounded bg-transparent px-1 font-mono text-[10px] text-muted-foreground outline-none focus:bg-background focus:text-foreground focus:ring-1 focus:ring-ring"
            value={urlDraft ?? liveUrl}
            spellCheck={false}
            onFocus={(e) => {
              setUrlDraft(liveUrl)
              e.target.select()
            }}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={() => setUrlDraft(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && urlDraft) {
                host.navigateTool(id, urlDraft)
                e.currentTarget.blur()
              }
              if (e.key === "Escape") e.currentTarget.blur()
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-5 shrink-0"
            title="Copy URL"
            onClick={() => {
              void navigator.clipboard.writeText(liveUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            {copied ? (
              <CheckIcon className="size-3 text-emerald-500" />
            ) : (
              <CopyIcon className="size-3" />
            )}
          </Button>
        </div>
      )}

      {!minimized && (
        <div ref={bodyRef} className="relative flex-1 bg-background">
          {/* Desktop shell: the native WebContentsView is positioned exactly
              over this div. Browser fallback: link card. */}
          {!host && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-xs text-muted-foreground">
                Embedded view requires the desktop app.
              </p>
              <Button asChild size="sm" variant="outline">
                <a href={data.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon className="size-3.5" />
                  Open {data.label}
                </a>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
