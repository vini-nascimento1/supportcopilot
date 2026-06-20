"use client"

import { useEffect, useMemo, useState } from "react"
import { validTimezone } from "@/lib/timezones"

const SESSION_KEY = "fv-dashboard-greeting-seen"

const MORNING_PHRASES = [
  "Grab your coffee yet, {name}? ☕️",
  "Rise and shine, {name}! Ready to make today count?",
  "Morning, {name}! Hope you're feeling sharp today.",
  "Coffee in hand, {name}? Let's do this.",
  "Fresh day, fresh cases — you've got this, {name}!",
  "Hope your coffee's as strong as you are today, {name}!",
  "Morning, {name}! Time to show these cases who's boss.",
  "Ready to tackle today's queue, {name}?",
  "Morning, {name}! Hope you got some good rest.",
  "Let's ease into this morning, {name}!",
  "New day, new wins — let's go, {name}!",
  "Morning, {name}! The early crew makes the difference.",
]

const AFTERNOON_PHRASES = [
  "Still going strong, {name}? 💪",
  "Hope lunch was good — back at it, {name}!",
  "Keeping the momentum going, {name}?",
  "Hope the shift's treating you well, {name}.",
  "Crushing it this afternoon, {name}!",
  "You're making a real difference today, {name}.",
  "Halfway there — you're doing great, {name}!",
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
  "Almost there — you're doing great, {name}.",
  "Night mode: activated, {name}! 🌃",
  "Evening, {name}! The quiet hours are yours.",
  "Late nights, big impact, {name}. Keep it up!",
]

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

function pickPhrase(hour: number, name: string, dateKey: string): string {
  const pool = hour < 12 ? MORNING_PHRASES : hour < 18 ? AFTERNOON_PHRASES : EVENING_PHRASES
  const idx = hashString(`${name}:${dateKey}:${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}`) % pool.length
  return pool[idx]!.replace("{name}", name)
}

function getShortGreeting(hour: number): string {
  if (hour < 12) return "Morning"
  if (hour < 18) return "Hey"
  return "Evening"
}

interface DashboardGreetingProps {
  firstName: string
  caseCount: number
  nextMeetingMinutes?: number
  savedTimezone?: string | null
}

function formatMeeting(minutes: number): string {
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function getStoredVisitState(): boolean {
  if (typeof window === "undefined") return true
  try {
    const hasSeen = sessionStorage.getItem(SESSION_KEY)
    if (!hasSeen) sessionStorage.setItem(SESSION_KEY, "1")
    return !hasSeen
  } catch {
    return true
  }
}

function getBrowserTz(): string | undefined {
  if (typeof window === "undefined") return undefined
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function formatToday(date: Date, tz: string | undefined): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  })
}

function formatLocalTime(date: Date, tz: string | undefined): string {
  return date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  })
}

function formatUkTime(date: Date): string {
  return date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Europe/London",
  })
}

export function DashboardGreeting({
  firstName,
  caseCount,
  nextMeetingMinutes,
  savedTimezone,
}: DashboardGreetingProps) {
  const [isFirstVisit, setIsFirstVisit] = useState(false)
  const [browserTz, setBrowserTz] = useState<string | undefined>(undefined)
  const [displayMinutes, setDisplayMinutes] = useState(nextMeetingMinutes)

  useEffect(() => {
    queueMicrotask(() => {
      setIsFirstVisit(getStoredVisitState())
      setBrowserTz(getBrowserTz())
    })
  }, [])

  // Tick down the meeting countdown every 30 seconds
  useEffect(() => {
    if (nextMeetingMinutes === undefined) return
    queueMicrotask(() => setDisplayMinutes(nextMeetingMinutes))
    const id = setInterval(() => {
      setDisplayMinutes((prev) => (prev !== undefined && prev > 0 ? prev - 1 : 0))
    }, 30000)
    return () => clearInterval(id)
  }, [nextMeetingMinutes])

  // User's saved timezone from settings takes priority; fall back to browser auto-detect
  const tz = validTimezone(savedTimezone ?? browserTz ?? "Europe/London")

  const { firstVisitHeading, shortGreeting, todayLabel, localTime, ukTime } = useMemo(() => {
    const now = new Date()
    const hour = tz
      ? parseInt(
          now.toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }),
          10,
        )
      : now.getHours()
    const dateKey = now.toLocaleDateString("en-CA", { timeZone: tz })
    return {
      firstVisitHeading: pickPhrase(hour, firstName, dateKey),
      shortGreeting: getShortGreeting(hour),
      todayLabel: formatToday(now, tz),
      localTime: formatLocalTime(now, tz),
      ukTime: formatUkTime(now),
    }
  }, [tz, firstName])

  const heading = isFirstVisit
    ? firstVisitHeading
    : `${shortGreeting}, ${firstName}! · ${caseCount} case${caseCount === 1 ? "" : "s"} open${
        displayMinutes !== undefined
          ? ` · next meeting in ${formatMeeting(displayMinutes)}`
          : ""
      }`

  return (
    <section className="px-4 pt-4 lg:px-6 lg:pt-6" suppressHydrationWarning>
      <h1
        className={`font-semibold tracking-tight ${
          isFirstVisit ? "text-2xl" : "text-lg"
        }`}
      >
        {heading}
      </h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {todayLabel}{" "}
        <span className="tabular-nums">
          · {localTime} local / {ukTime} UK
        </span>
      </p>
    </section>
  )
}
