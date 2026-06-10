"use client"

import { useCallback, useRef, useState } from "react"
import Link from "next/link"
import {
  TrashIcon,
  MailIcon,
  MailOpenIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { GmailThreadSummary } from "@/lib/gmail-client"

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (isToday) {
    return d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })
  }
  const isThisYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: isThisYear ? undefined : "numeric",
  })
}

export function GmailThreadList({
  threads,
  connected,
  filter,
}: {
  threads: GmailThreadSummary[]
  connected: boolean
  filter: string
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [acting, setActing] = useState(false)
  const masterRef = useRef<HTMLInputElement>(null)

  const allSelected = threads.length > 0 && selected.size === threads.length
  const someSelected = selected.size > 0 && !allSelected

  // Update indeterminate state on master checkbox
  if (masterRef.current) {
    masterRef.current.indeterminate = someSelected
  }

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === threads.length) return new Set()
      return new Set(threads.map((t) => t.id))
    })
  }, [threads])

  async function bulkAction(action: "trash" | "mark-read") {
    const ids = Array.from(selected)
    if (ids.length === 0) return

    setActing(true)
    try {
      const res = await fetch("/api/gmail/threads/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? `Failed to ${action}`)
        return
      }

      const labels: Record<string, string> = {
        trash: "Moved to trash",
        "mark-read": "Marked as read",
      }
      toast.success(`${ids.length} thread${ids.length === 1 ? "" : "s"} ${(labels[action] ?? action).toLowerCase()}`)
      setSelected(new Set())
      window.location.reload()
    } catch {
      toast.error("Network error — try again")
    } finally {
      setActing(false)
    }
  }

  if (!connected) return null

  return (
    <>
      {/* Master checkbox row (sticky header) */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
        <input
          ref={masterRef}
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="size-4 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary"
        />
        <span className="text-xs text-muted-foreground">
          {selected.size > 0
            ? `${selected.size} of ${threads.length} selected`
            : `${threads.length} conversations`}
        </span>
      </div>

      <div className="flex flex-col">
        {/* Thread rows */}
        {threads.map((thread) => {
          const isSelected = selected.has(thread.id)
          return (
            <div
              key={thread.id}
              className={`group flex items-center gap-3 border-b px-4 py-2.5 transition-colors lg:px-6 ${
                isSelected ? "bg-accent/50" : "hover:bg-muted/50"
              }`}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(thread.id)}
                className="size-4 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary"
              />

              {/* Thread content — clickable link */}
              <Link
                href={`/gmail/${thread.id}`}
                className="min-w-0 flex-1"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("input[type=checkbox]")) {
                    e.preventDefault()
                  }
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className={`truncate text-sm ${thread.isUnread ? "font-semibold" : ""}`}>
                    {thread.fromName || thread.from}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(thread.date)}
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`truncate text-sm ${thread.isUnread ? "font-medium" : "text-muted-foreground"}`}>
                    {thread.subject}
                  </span>
                  {thread.messageCount > 1 && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ({thread.messageCount})
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{thread.snippet}</p>
              </Link>

              {/* Unread dot */}
              {thread.isUnread && (
                <div className="size-2 shrink-0 rounded-full bg-blue-500" />
              )}
            </div>
          )
        })}

        {threads.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <MailIcon className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Inbox is empty</p>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center gap-3 px-4 py-3 lg:px-6">
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              disabled={acting}
              onClick={() => bulkAction("mark-read")}
            >
              <MailOpenIcon className="mr-1.5 size-3.5" />
              Mark as read
            </Button>
            {filter !== "trash" && (
              <Button
                size="sm"
                variant="outline"
                disabled={acting}
                onClick={() => bulkAction("trash")}
              >
                <TrashIcon className="mr-1.5 size-3.5" />
                Move to trash
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
