"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react"
import { InboxIcon, Loader2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { relativeTime } from "@/lib/utils"

interface QueueRow {
  id: string
  customer: string
  email: string | null
  state: string
  snippet: string
  updatedAt: string | null
}

export type QueueNodeData = Record<string, never>

export type QueueNodeType = Node<QueueNodeData, "queue">

// Live Intercom queue as a canvas card — same /api/cases feed as the
// dashboard, polled every 30s. Clicking a case opens its own canvas, so the
// whole shift can be worked without leaving canvas mode.
export function QueueNode({ selected }: NodeProps<QueueNodeType>) {
  const [rows, setRows] = useState<QueueRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/cases")
        const data = await res.json()
        if (!cancelled) {
          setRows(Array.isArray(data.rows) ? data.rows : [])
          setError(data.mode === "error")
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }
    void load()
    const id = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card shadow-md">
      <NodeResizer isVisible={selected} minWidth={260} minHeight={200} />
      <div className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b bg-muted/50 px-3 active:cursor-grabbing">
        <InboxIcon className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Case queue</span>
        {rows !== null && (
          <Badge variant="secondary" className="ml-auto h-5 px-1.5 font-normal">
            {rows.length}
          </Badge>
        )}
      </div>
      <div className="nodrag nowheel flex-1 overflow-y-auto">
        {rows === null && (
          <div className="flex h-full items-center justify-center">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {error ? "Couldn't load the queue." : "Queue is clear."}
          </p>
        )}
        {rows?.map((row) => (
          <Link
            key={row.id}
            href={`/cases/${row.id}/canvas`}
            className="flex flex-col gap-0.5 border-b px-3 py-2 last:border-0 hover:bg-muted/50"
          >
            <span className="flex items-center gap-2">
              <span className="truncate text-xs font-medium">{row.customer}</span>
              {row.updatedAt && (
                <span
                  className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground"
                  title={new Date(row.updatedAt).toLocaleString("en-GB", {
                    timeZone: "Europe/London",
                  })}
                >
                  {relativeTime(row.updatedAt)}
                </span>
              )}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {row.snippet}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
