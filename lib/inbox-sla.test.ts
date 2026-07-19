import { describe, it, expect } from "vitest"

import {
  inboxSlaSeverity,
  isWaitingOnCustomer,
  customerSilentMinutes,
  CHECKIN_MACRO,
  REVIEW_MACRO,
  SLA_WARN_MINUTES,
  SLA_URGENT_MINUTES,
} from "./inbox-sla"

const NOW = Date.parse("2026-07-18T12:00:00.000Z")
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

describe("isWaitingOnCustomer", () => {
  it("is true when we replied last and nobody is waiting on us", () => {
    expect(isWaitingOnCustomer(null, minsAgo(10))).toBe(true)
  })
  it("is false when the ticket is waiting on US (waitingSince set)", () => {
    expect(isWaitingOnCustomer(minsAgo(5), minsAgo(90))).toBe(false)
  })
  it("is false when we never replied", () => {
    expect(isWaitingOnCustomer(null, null)).toBe(false)
  })
})

describe("inboxSlaSeverity", () => {
  it("is 'none' before the clock hydrates (nowMs <= 0)", () => {
    expect(inboxSlaSeverity(null, minsAgo(120), 0)).toBe("none")
  })

  it("is 'none' when the ticket is waiting on US (waitingSince set)", () => {
    // Customer messaged 90m ago and we owe a reply — the check-in macro would be wrong.
    expect(inboxSlaSeverity(minsAgo(90), minsAgo(200), NOW)).toBe("none")
  })

  it("is 'none' when we never replied (nothing to nudge)", () => {
    expect(inboxSlaSeverity(null, null, NOW)).toBe("none")
  })

  it("is 'none' when we replied under the warn threshold", () => {
    expect(inboxSlaSeverity(null, minsAgo(SLA_WARN_MINUTES - 1), NOW)).toBe("none")
  })

  it("is 'warn' once customer silence reaches the warn threshold", () => {
    expect(inboxSlaSeverity(null, minsAgo(SLA_WARN_MINUTES), NOW)).toBe("warn")
    expect(inboxSlaSeverity(null, minsAgo(45), NOW)).toBe("warn")
  })

  it("is 'urgent' once customer silence reaches the urgent threshold", () => {
    expect(inboxSlaSeverity(null, minsAgo(SLA_URGENT_MINUTES), NOW)).toBe("urgent")
    expect(inboxSlaSeverity(null, minsAgo(180), NOW)).toBe("urgent")
  })

  it("is 'none' on an unparseable timestamp", () => {
    expect(inboxSlaSeverity(null, "not-a-date", NOW)).toBe("none")
  })
})

describe("customerSilentMinutes", () => {
  it("returns whole minutes since our last reply", () => {
    expect(customerSilentMinutes(minsAgo(42), NOW)).toBe(42)
  })
  it("returns 0 when unknown or unhydrated", () => {
    expect(customerSilentMinutes(null, NOW)).toBe(0)
    expect(customerSilentMinutes(minsAgo(42), 0)).toBe(0)
  })
})

describe("macros", () => {
  it("check-in macro keeps the exact team wording", () => {
    expect(CHECKIN_MACRO.text).toContain("just checking in")
    expect(CHECKIN_MACRO.text).toContain("Have a great day")
    expect(CHECKIN_MACRO.html.startsWith("<p>")).toBe(true)
  })
  it("review macro includes the TrustPilot link", () => {
    expect(REVIEW_MACRO.text).toContain("TRUSTPILOT: https://uk.trustpilot.com/evaluate/fanvue.com")
    expect(REVIEW_MACRO.html).toContain('href="https://uk.trustpilot.com/evaluate/fanvue.com"')
  })
})
