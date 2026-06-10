"use client"

import { useMemo, useState } from "react"
import { validTimezone } from "@/lib/timezones"

function getBrowserTz(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function formatTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  })
}

export function CalendarEventTime({
  iso,
  isAllDay,
  savedTimezone,
}: {
  iso: string | null
  isAllDay: boolean
  savedTimezone?: string | null
}) {
  const [browserTz] = useState(getBrowserTz)
  const tz = validTimezone(savedTimezone ?? browserTz)

  const display = useMemo(() => {
    if (!iso || isAllDay) return null
    const local = formatTime(iso, tz ?? "Europe/London")
    const uk = formatTime(iso, "Europe/London")
    if (local === uk) return <span className="tabular-nums">{local}</span>
    return (
      <span className="tabular-nums">
        {local} / {uk}
      </span>
    )
  }, [iso, isAllDay, tz])

  if (!iso) return <span />
  if (isAllDay) return <span>All day</span>
  return <span className="tabular-nums">{display}</span>
}
