"use client"

import { useState } from "react"

const SESSION_KEY = "fv-dashboard-greeting-seen"

interface DashboardGreetingProps {
  greeting: string
  firstName: string
  todayLabel: string
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
  // SessionStorage read in lazy initializer: no effect needed.
  // SSR falls through to true (full greeting).
  if (typeof window === "undefined") return true
  try {
    const hasSeen = sessionStorage.getItem(SESSION_KEY)
    if (!hasSeen) sessionStorage.setItem(SESSION_KEY, "1")
    return !hasSeen
  } catch {
    return true
  }
}

export function DashboardGreeting({
  greeting,
  firstName,
  todayLabel,
  caseCount,
  nextMeetingMinutes,
}: DashboardGreetingProps) {
  const [isFirstVisit] = useState(getStoredVisitState)

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
