import "server-only"

import { googleFetch } from "@/lib/auth"

export type CalRange = "today" | "week" | "month"

export type CalendarEvent = {
  id: string
  title: string
  start: string | null
  end: string | null
  isAllDay: boolean
  dateLabel: string   // "2026-06-06" — used for grouping in week/month views
  location?: string
  htmlLink?: string
}

export type GCalResult =
  | { connected: true; events: CalendarEvent[]; calendarLink: string; range: CalRange }
  | { connected: false; error?: string }

// Accepts email for token auto-refresh. Pass null if unknown (refresh disabled).

function buildTimeRange(range: CalRange, now: Date): { timeMin: Date; timeMax: Date } {
  const timeMin = new Date(now)
  const timeMax = new Date(now)

  if (range === "today") {
    timeMin.setHours(0, 0, 0, 0)
    timeMax.setHours(23, 59, 59, 999)
  } else if (range === "week") {
    // Mon–Sun of the current ISO week
    const day = now.getDay() // 0=Sun
    const diffToMon = day === 0 ? -6 : 1 - day
    timeMin.setDate(now.getDate() + diffToMon)
    timeMin.setHours(0, 0, 0, 0)
    timeMax.setDate(timeMin.getDate() + 6)
    timeMax.setHours(23, 59, 59, 999)
  } else {
    // Full calendar month
    timeMin.setDate(1)
    timeMin.setHours(0, 0, 0, 0)
    timeMax.setMonth(now.getMonth() + 1, 0) // last day of current month
    timeMax.setHours(23, 59, 59, 999)
  }

  return { timeMin, timeMax }
}

export async function getCalendarEvents(
  range: CalRange,
  nowIso: string,
  token: string | null,
  email?: string | null
): Promise<GCalResult> {
  if (!token) return { connected: false }

  const now = new Date(nowIso)
  const { timeMin, timeMax } = buildTimeRange(range, now)

  try {
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    )
    url.searchParams.set("timeMin", timeMin.toISOString())
    url.searchParams.set("timeMax", timeMax.toISOString())
    url.searchParams.set("singleEvents", "true")
    url.searchParams.set("orderBy", "startTime")
    url.searchParams.set(
      "maxResults",
      range === "today" ? "10" : range === "week" ? "40" : "80"
    )

    const res = await googleFetch(email ?? null, token, url.toString())
    if (!res || !res.ok) return { connected: false }

    const data = (await res.json()) as {
      items?: Array<{
        id: string
        summary?: string
        start?: { dateTime?: string; date?: string }
        end?: { dateTime?: string; date?: string }
        location?: string
        htmlLink?: string
      }>
    }

    const events: CalendarEvent[] = (data.items ?? []).map((item) => {
      const startRaw = item.start?.dateTime ?? item.start?.date ?? null
      return {
        id: item.id,
        title: item.summary ?? "(No title)",
        start: startRaw,
        end: item.end?.dateTime ?? item.end?.date ?? null,
        isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
        dateLabel: startRaw ? startRaw.slice(0, 10) : "",
        location: item.location,
        htmlLink: item.htmlLink,
      }
    })

    return { connected: true, events, calendarLink: "https://calendar.google.com", range }
  } catch {
    return { connected: false }
  }
}
