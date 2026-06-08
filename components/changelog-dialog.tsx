"use client"

import { useEffect, useRef, useState } from "react"
import { MegaphoneIcon, XIcon } from "lucide-react"

import type { ChangelogEntry } from "@/app/api/changelog/route"

interface Props {
  open: boolean
  onClose: () => void
}

export function ChangelogDialog({ open, onClose }: Props) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch("/api/changelog")
      .then((r) => r.json())
      .then((data) => setEntries(data.entries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [open])

  // Group by date
  const grouped: Record<string, ChangelogEntry[]> = {}
  for (const e of entries) {
    const d = e.date
    if (!grouped[d]) grouped[d] = []
    grouped[d].push(e)
  }

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + "T00:00:00")
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center sm:items-center">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 mx-4 mt-16 w-full max-w-lg rounded-lg border bg-background shadow-xl sm:mt-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <MegaphoneIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Novidades</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto px-4 py-3"
        >
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : sortedDates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No entries yet.</p>
          ) : (
            sortedDates.map((date) => (
              <div key={date} className="mb-4 last:mb-0">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {formatDate(date)}
                </p>
                <div className="space-y-2">
                  {grouped[date].map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-md border bg-muted/30 px-3 py-2"
                    >
                      <p className="text-sm font-medium">{entry.title}</p>
                      {entry.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                          {entry.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
