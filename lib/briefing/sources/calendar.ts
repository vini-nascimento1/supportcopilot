import "server-only"

import { getCalendarEvents, type CalendarEvent } from "@/lib/gcal"
import type { AttentionItem, SourceStatus } from "@/lib/briefing/types"
import { MAX_CONTEXT_CHARS, MAX_TITLE_CHARS, sanitizeLine, untilLabel } from "@/lib/briefing/format"

// Calendar half of the Home briefing: today's events from the agent's primary
// Google Calendar, normalized into the same AttentionItem shape as everything
// else. Read-only — the briefing never creates, edits or responds to an event.

/** An event inside this window is "Needs you now" (mirrors isNeedsYouNow). */
export const IMMINENT_MS = 60 * 60 * 1000

/** How many of today's events a briefing carries. */
export const MAX_CALENDAR_ITEMS = 8

/**
 * One Google event → one AttentionItem. Pure so the urgency boundary and the
 * label are fixture-testable without a Google token.
 */
export function toCalendarItem(
  event: CalendarEvent,
  nowMs: number,
  timeZone?: string | null
): AttentionItem {
  const startMs = event.start ? Date.parse(event.start) : NaN
  const delta = Number.isFinite(startMs) ? startMs - nowMs : Number.POSITIVE_INFINITY
  const imminent = !event.isAllDay && delta >= 0 && delta < IMMINENT_MS

  return {
    id: `calendar:${event.id}`,
    source: "calendar",
    kind: "calendar_event",
    title: sanitizeLine(event.title, MAX_TITLE_CHARS) || "(No title)",
    context: event.isAllDay
      ? "All day"
      : sanitizeLine(event.location ?? "On your calendar today", MAX_CONTEXT_CHARS),
    urgency: imminent ? "now" : "today",
    occurredAt: event.start ?? new Date(nowMs).toISOString(),
    ...(event.start ? { dueAt: event.start } : {}),
    whenLabel: event.isAllDay ? "All day" : untilLabel(event.start, nowMs, timeZone),
    deepLink: event.htmlLink ?? "https://calendar.google.com",
    externalId: event.id,
    actions: ["open"],
  }
}

/** Events that already finished are noise on a "what needs you now" page. */
export function isStillRelevant(event: CalendarEvent, nowMs: number): boolean {
  if (event.isAllDay) return true
  const endMs = event.end ? Date.parse(event.end) : NaN
  if (!Number.isFinite(endMs)) return true
  return endMs >= nowMs
}

export type CalendarSourceResult = { items: AttentionItem[]; status: SourceStatus }

export async function collectCalendarItems(opts: {
  googleToken: string | null
  email: string | null
  nowMs: number
  timeZone?: string | null
}): Promise<CalendarSourceResult> {
  if (!opts.googleToken) {
    return { items: [], status: { source: "calendar", state: "not_connected" } }
  }

  const result = await getCalendarEvents(
    "today",
    new Date(opts.nowMs).toISOString(),
    opts.googleToken,
    opts.email
  )

  // getCalendarEvents collapses "no token" and "the call failed" into the same
  // shape; we already know a token exists, so this branch is a real failure.
  if (!result.connected) {
    return {
      items: [],
      status: { source: "calendar", state: "error", message: "Couldn't read your calendar." },
    }
  }

  const items = result.events
    .filter((e) => isStillRelevant(e, opts.nowMs))
    .slice(0, MAX_CALENDAR_ITEMS)
    .map((e) => toCalendarItem(e, opts.nowMs, opts.timeZone))

  return { items, status: { source: "calendar", state: "ok", count: items.length } }
}
