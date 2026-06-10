"use client"

import { useEffect, useState } from "react"

function formatRelative(iso: string, now: number): string {
  const then = new Date(iso).getTime()
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export function LastUpdated({ iso }: { iso: string | null }) {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  if (!iso) return null

  return (
    <span
      className="shrink-0 text-xs text-muted-foreground tabular-nums"
      title={`Last updated ${new Date(iso).toLocaleTimeString("en-GB")}`}
    >
      Updated {formatRelative(iso, now)}
    </span>
  )
}
