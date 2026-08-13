import { describe, it, expect, vi } from "vitest"

import { validTimezone, formatLocalAndUkTime, formatLocalDate, getLocalHour } from "./timezones"

describe("validTimezone", () => {
  it("returns a valid IANA zone unchanged", () => {
    expect(validTimezone("America/New_York")).toBe("America/New_York")
  })

  it("falls back to Europe/London for an invalid zone", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(validTimezone("Not/A_Zone")).toBe("Europe/London")
    vi.restoreAllMocks()
  })

  it("falls back for null/undefined without throwing", () => {
    expect(validTimezone(null)).toBe("Europe/London")
    expect(validTimezone(undefined)).toBe("Europe/London")
  })

  it("honours a custom fallback", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(validTimezone("Not/A_Zone", "Asia/Tokyo")).toBe("Asia/Tokyo")
    expect(validTimezone(null, "Asia/Tokyo")).toBe("Asia/Tokyo")
    vi.restoreAllMocks()
  })
})

describe("formatLocalAndUkTime", () => {
  const iso = "2026-01-15T12:00:00Z"
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: true }

  it("formats the given instant in both the local zone and UK time", () => {
    const result = formatLocalAndUkTime(iso, "America/New_York")
    // computed the same way the source does, so this stays correct across ICU versions
    expect(result.local).toBe(new Date(iso).toLocaleString("en-US", { ...opts, timeZone: "America/New_York" }))
    expect(result.uk).toBe(new Date(iso).toLocaleString("en-US", { ...opts, timeZone: "Europe/London" }))
    // and pinned to concrete values for this fixed instant (noon UTC, Jan = EST/GMT)
    expect(result.local).toBe("7:00 AM")
    expect(result.uk).toBe("12:00 PM")
  })

  it("falls back local time to UK when localTz is invalid or missing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const invalid = formatLocalAndUkTime(iso, "Not/A_Zone")
    expect(invalid.local).toBe(invalid.uk)
    expect(invalid.local).toBe("12:00 PM")

    const missing = formatLocalAndUkTime(iso, null)
    expect(missing.local).toBe(missing.uk)
    vi.restoreAllMocks()
  })
})

describe("formatLocalDate", () => {
  // Aug 12 00:00 UTC is still Aug 11 evening in Los Angeles (UTC-7 in August) —
  // exercises the case where the local timezone shifts the calendar day.
  const date = new Date("2026-08-12T00:00:00Z")

  it("formats a known date/timezone combination", () => {
    expect(formatLocalDate(date, "Europe/London")).toBe("Wednesday 12 August")
    expect(formatLocalDate(date, "America/Los_Angeles")).toBe("Tuesday 11 August")
  })

  it("falls back to UK formatting for an invalid timezone", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(formatLocalDate(date, "Not/A_Zone")).toBe(formatLocalDate(date, "Europe/London"))
    vi.restoreAllMocks()
  })
})

describe("getLocalHour", () => {
  const pinned = new Date("2026-08-12T15:30:00Z").getTime()

  it("returns the current hour in the given timezone", () => {
    vi.useFakeTimers()
    vi.setSystemTime(pinned)
    expect(getLocalHour("America/Los_Angeles")).toBe(8) // PDT = UTC-7
    expect(getLocalHour("Asia/Tokyo")).toBe(0) // UTC+9, rolls into the next day
    vi.useRealTimers()
  })

  it("falls back to the UK hour for an invalid timezone", () => {
    vi.useFakeTimers()
    vi.setSystemTime(pinned)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(getLocalHour("Not/A_Zone")).toBe(getLocalHour("Europe/London"))
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
})
