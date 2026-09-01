"use client"

import { useMemo, useSyncExternalStore } from "react"

import { validTimezone } from "@/lib/timezones"

// The greeting from the Home mockup: one line, no phrase pools.
//   Tuesday, 1 September
//   Morning, Vinicius.
//   8:42 AM local · 12:42 PM UK
// Timezone: the agent's saved Settings timezone wins, browser detection is the
// fallback (resolved after mount, hence suppressHydrationWarning).

function getBrowserTz(): string | undefined {
  if (typeof window === "undefined") return undefined
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

const noSubscribe = () => () => {}
const serverTz = (): string | undefined => undefined

function partOfDay(hour: number): string {
  if (hour < 12) return "Morning"
  if (hour < 18) return "Afternoon"
  return "Evening"
}

export function HomeGreeting({
  firstName,
  savedTimezone,
}: {
  firstName: string
  savedTimezone?: string | null
}) {
  // The browser timezone can't be known during SSR, so it resolves after
  // hydration (undefined on the server, then the real zone).
  const browserTz = useSyncExternalStore(noSubscribe, getBrowserTz, serverTz)

  const tz = validTimezone(savedTimezone ?? browserTz ?? "Europe/London")

  const { heading, dateLabel, localTime, ukTime } = useMemo(() => {
    const now = new Date()
    const hour = parseInt(
      now.toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }),
      10,
    )
    return {
      heading: `${partOfDay(hour)}, ${firstName}.`,
      dateLabel: now.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: tz,
      }),
      localTime: now.toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: tz,
      }),
      ukTime: now.toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "Europe/London",
      }),
    }
  }, [tz, firstName])

  return (
    <section suppressHydrationWarning>
      <p className="text-xs font-medium text-muted-foreground">{dateLabel}</p>
      <h2 className="mt-0.5 text-2xl font-semibold tracking-tight text-balance">{heading}</h2>
      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
        {localTime} local · {ukTime} UK
      </p>
    </section>
  )
}
