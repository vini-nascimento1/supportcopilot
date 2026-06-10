"use client"

import { useState, useMemo } from "react"

const SESSION_KEY = "fv-dashboard-greeting-seen"

interface DashboardGreetingProps {
  firstName: string
  caseCount: number
  nextMeetingMinutes?: number
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

function getGreeting(hour: number): string {
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

function formatToday(date: Date, tz: string | undefined): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  })
}

export function DashboardGreeting({
  firstName,
  caseCount,
  nextMeetingMinutes,
}: DashboardGreetingProps) {
  const [isFirstVisit] = useState(getStoredVisitState)
  const [browserTz] = useState(getBrowserTz)

  const { greeting, todayLabel } = useMemo(() => {
    const now = new Date()
    const hour = browserTz
      ? parseInt(
          now.toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: browserTz }),
          10,
        )
      : now.getHours()
    return {
      greeting: getGreeting(hour),
      todayLabel: formatToday(now, browserTz),
    }
  }, [browserTz])

  const heading = isFirstVisit
    ? `${greeting}, ${firstName}! 👋`
    : `${firstName} · ${caseCount} case${caseCount === 1 ? "" : "s"} open${
        nextMeetingMinutes !== undefined
          ? ` · next meeting in ${formatMeeting(nextMeetingMinutes)}`
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
      <p className="mt-0.5 text-sm text-muted-foreground">{todayLabel}</p>
    </section>
  )
}
