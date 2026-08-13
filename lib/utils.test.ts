import { describe, it, expect, vi, afterEach } from "vitest"

import { cn, relativeTime } from "./utils"

describe("cn", () => {
  it("merges conflicting Tailwind classes, keeping the last one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4")
  })

  it("drops falsy/conditional inputs", () => {
    expect(cn("base", false && "hidden", null, undefined, "", "extra")).toBe("base extra")
  })

  it("keeps non-conflicting classes together", () => {
    expect(cn("text-sm", "font-bold")).toBe("text-sm font-bold")
  })
})

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const NOW = new Date("2026-08-12T12:00:00.000Z")
  const isoAgo = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

  it("returns '' for null/undefined/empty input", () => {
    expect(relativeTime(null)).toBe("")
    expect(relativeTime(undefined)).toBe("")
    expect(relativeTime("")).toBe("")
  })

  it("returns '' for an invalid date string", () => {
    expect(relativeTime("not-a-date")).toBe("")
  })

  it("returns 'just now' for anything under 1 minute", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(relativeTime(isoAgo(30_000))).toBe("just now")
  })

  it("boundary: exactly 1 minute", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(relativeTime(isoAgo(60_000))).toBe("1 min ago")
  })

  it("boundary: exactly 60 minutes rolls over to hours", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(relativeTime(isoAgo(60 * 60_000))).toBe("1 hour ago")
  })

  it("boundary: exactly 24 hours rolls over to days", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(relativeTime(isoAgo(24 * 60 * 60_000))).toBe("1 day ago")
  })

  it("boundary: exactly 30 days rolls over to months", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(relativeTime(isoAgo(30 * 24 * 60 * 60_000))).toBe("1 month ago")
  })

  it("boundary: 11 months stays in months (plural)", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(relativeTime(isoAgo(350 * 24 * 60 * 60_000))).toBe("11 months ago")
  })

  it("boundary: 12 months rolls over to years (singular)", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    // days=365 -> months=floor(365/30)=12, so the months branch is skipped
    // and years=floor(365/365)=1 is used instead.
    expect(relativeTime(isoAgo(365 * 24 * 60 * 60_000))).toBe("1 year ago")
  })

  it("a year-plus-old timestamp uses plural years", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(relativeTime(isoAgo(800 * 24 * 60 * 60_000))).toBe("2 years ago")
  })

  it("singular wording for exactly 1 min/hour/day/month", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(relativeTime(isoAgo(60_000))).not.toContain("mins")
    expect(relativeTime(isoAgo(60 * 60_000))).not.toContain("hours")
    expect(relativeTime(isoAgo(24 * 60 * 60_000))).not.toContain("days")
    expect(relativeTime(isoAgo(30 * 24 * 60 * 60_000))).not.toContain("months")
  })
})
