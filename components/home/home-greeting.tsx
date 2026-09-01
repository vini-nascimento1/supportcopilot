"use client"

import { useMemo, useSyncExternalStore } from "react"

import { validTimezone } from "@/lib/timezones"

// The Home greeting:
//   Tuesday, 1 September
//   Grab your coffee yet, Vinicius? ☕️
//   8:42 AM local · 12:42 PM UK
// The heading is one of the rotating time-of-day phrases the old Dashboard had.
// The pick is a hash of name + date + part of day, so it changes every day (and
// between morning / afternoon / evening) but stays stable across re-renders and
// across server and client, which keeps hydration quiet.
// Timezone: the agent's saved Settings timezone wins, browser detection is the
// fallback (resolved after mount, hence suppressHydrationWarning).

const MORNING_PHRASES = [
  "Grab your coffee yet, {name}? ☕️",
  "Rise and shine, {name}! Ready to make today count?",
  "Morning, {name}! Hope you're feeling sharp today.",
  "Coffee in hand, {name}? Let's do this.",
  "Fresh day, fresh cases. You've got this, {name}!",
  "Hope your coffee's as strong as you are today, {name}!",
  "Morning, {name}! Time to show these cases who's boss.",
  "Ready to tackle today's queue, {name}?",
  "Morning, {name}! Hope you got some good rest.",
  "Let's ease into this morning, {name}!",
  "New day, new wins. Let's go, {name}!",
  "Morning, {name}! The early crew makes the difference.",
]

const AFTERNOON_PHRASES = [
  "Still going strong, {name}? 💪",
  "Hope lunch was good. Back at it, {name}!",
  "Keeping the momentum going, {name}?",
  "Hope the shift's treating you well, {name}.",
  "Crushing it this afternoon, {name}!",
  "You're making a real difference today, {name}.",
  "Halfway there. You're doing great, {name}!",
  "Hope the afternoon rush isn't hitting too hard, {name}.",
  "Proud of the work you're putting in today, {name}.",
  "Let's keep that energy up, {name}!",
  "Afternoon, {name}! The best is yet to come.",
  "Hey, {name}! You're on a roll today.",
]

const EVENING_PHRASES = [
  "The night crew is where it's at, {name}! 🌙",
  "Late-night workers are the real ones, {name}.",
  "Hope you're winding down nicely, {name}.",
  "The night shift wouldn't be the same without you, {name}.",
  "Appreciate you sticking it out this late, {name}.",
  "You've earned the quiet of the night, {name}.",
  "Late shift legend in the house, {name}!",
  "The night owls are running the show, {name}.",
  "Almost there. You're doing great, {name}.",
  "Night mode: activated, {name}! 🌃",
  "Evening, {name}! The quiet hours are yours.",
  "Late nights, big impact, {name}. Keep it up!",
]

type PartOfDay = "morning" | "afternoon" | "evening"

function partOfDay(hour: number): PartOfDay {
  if (hour < 12) return "morning"
  if (hour < 18) return "afternoon"
  return "evening"
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

export function pickGreeting(hour: number, name: string, dateKey: string): string {
  const part = partOfDay(hour)
  const pool =
    part === "morning" ? MORNING_PHRASES : part === "afternoon" ? AFTERNOON_PHRASES : EVENING_PHRASES
  const idx = hashString(`${name}:${dateKey}:${part}`) % pool.length
  return pool[idx]!.replace("{name}", name)
}

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
    const dateKey = now.toLocaleDateString("en-CA", { timeZone: tz })
    return {
      heading: pickGreeting(hour, firstName, dateKey),
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
