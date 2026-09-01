import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/gcal", () => ({ getCalendarEvents: vi.fn() }))

import { getCalendarEvents, type CalendarEvent } from "@/lib/gcal"
import { collectCalendarItems, isStillRelevant, toCalendarItem } from "./calendar"
import { isNeedsYouNow } from "@/lib/briefing/types"

const NOW = Date.parse("2026-09-01T12:00:00.000Z")
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "evt-1",
  title: "Payouts sync",
  start: at(48),
  end: at(78),
  isAllDay: false,
  dateLabel: "2026-09-01",
  htmlLink: "https://calendar.google.com/event?eid=abc",
  ...over,
})

describe("toCalendarItem", () => {
  it("normalizes an imminent event into the 'now' band", () => {
    const item = toCalendarItem(event(), NOW, "Europe/London")

    expect(item).toMatchObject({
      id: "calendar:evt-1",
      source: "calendar",
      kind: "calendar_event",
      urgency: "now",
      whenLabel: "in 48 min",
      deepLink: "https://calendar.google.com/event?eid=abc",
      externalId: "evt-1",
    })
    expect(item.dueAt).toBe(at(48))
    // The contract's own rule must agree with the urgency we assigned.
    expect(isNeedsYouNow(item, NOW)).toBe(true)
  })

  it("keeps an event more than an hour out in the calm 'today' band", () => {
    const item = toCalendarItem(event({ start: at(180), end: at(210) }), NOW, "Europe/London")
    expect(item.urgency).toBe("today")
    expect(item.whenLabel).toBe("at 16:00")
    expect(isNeedsYouNow(item, NOW)).toBe(false)
  })

  it("labels an all-day event without a countdown", () => {
    const item = toCalendarItem(event({ isAllDay: true, start: "2026-09-01" }), NOW)
    expect(item.whenLabel).toBe("All day")
    expect(item.urgency).toBe("today")
  })
})

describe("isStillRelevant", () => {
  it("drops an event that already finished", () => {
    expect(isStillRelevant(event({ start: at(-120), end: at(-60) }), NOW)).toBe(false)
  })

  it("keeps one that is running or upcoming", () => {
    expect(isStillRelevant(event({ start: at(-10), end: at(20) }), NOW)).toBe(true)
    expect(isStillRelevant(event(), NOW)).toBe(true)
  })
})

describe("collectCalendarItems", () => {
  beforeEach(() => vi.mocked(getCalendarEvents).mockReset())

  it("reports not_connected without a Google token, and makes no call", async () => {
    const result = await collectCalendarItems({ googleToken: null, email: "a@fanvue.com", nowMs: NOW })
    expect(result.status).toEqual({ source: "calendar", state: "not_connected" })
    expect(getCalendarEvents).not.toHaveBeenCalled()
  })

  it("filters finished events out of the day's list", async () => {
    vi.mocked(getCalendarEvents).mockResolvedValue({
      connected: true,
      range: "today",
      calendarLink: "https://calendar.google.com",
      events: [event({ id: "past", start: at(-120), end: at(-60) }), event()],
    })

    const result = await collectCalendarItems({
      googleToken: "tok",
      email: "a@fanvue.com",
      nowMs: NOW,
    })
    expect(result.items.map((i) => i.externalId)).toEqual(["evt-1"])
    expect(result.status).toEqual({ source: "calendar", state: "ok", count: 1 })
  })

  it("surfaces a failed read as an error, since we know a token exists", async () => {
    vi.mocked(getCalendarEvents).mockResolvedValue({ connected: false })
    const result = await collectCalendarItems({
      googleToken: "tok",
      email: "a@fanvue.com",
      nowMs: NOW,
    })
    expect(result.status.state).toBe("error")
  })
})
