import { describe, it, expect } from "vitest"

import { snoozeAtLabel, snoozeOptions, snoozeToastLabel } from "./snooze"

// Fixed LOCAL dates, so these pass in any timezone (snooze.ts is local-time by
// design). September 2026: the 2nd is a Wednesday, the 4th a Friday, the 6th a
// Sunday, the 7th a Monday.
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min, 0, 0)

const FRIDAY_AFTERNOON = local(2026, 9, 4, 15, 20)
const SUNDAY_EVENING = local(2026, 9, 6, 21, 0)
const WEDNESDAY_LATE = local(2026, 9, 2, 20, 0)

describe("snoozeOptions", () => {
  it("offers later today, tomorrow and next Monday on a Friday afternoon", () => {
    const options = snoozeOptions(FRIDAY_AFTERNOON)
    expect(options.map((o) => o.key)).toEqual(["later_today", "tomorrow", "next_monday"])
    expect(options.map((o) => o.label)).toEqual(["Later today", "Tomorrow 9:00", "Mon 9:00"])
    expect(options[0].until).toEqual(local(2026, 9, 4, 18, 20))
    expect(options[1].until).toEqual(local(2026, 9, 5, 9))
    expect(options[2].until).toEqual(local(2026, 9, 7, 9))
  })

  it("drops later today once now + 3h passes 19:00", () => {
    expect(snoozeOptions(WEDNESDAY_LATE).map((o) => o.key)).toEqual(["tomorrow", "next_monday"])
    expect(snoozeOptions(WEDNESDAY_LATE)[0].until).toEqual(local(2026, 9, 3, 9))
    expect(snoozeOptions(WEDNESDAY_LATE)[1].until).toEqual(local(2026, 9, 7, 9))
  })

  it("keeps later today while it still lands before 19:00", () => {
    // 15:59 + 3h = 18:59, in. 16:01 + 3h = 19:01, out.
    expect(snoozeOptions(local(2026, 9, 2, 15, 59))[0].key).toBe("later_today")
    expect(snoozeOptions(local(2026, 9, 2, 16, 1))[0].key).toBe("tomorrow")
  })

  it("offers next week instead of next Monday when tomorrow is that Monday", () => {
    const options = snoozeOptions(SUNDAY_EVENING)
    expect(options.map((o) => o.key)).toEqual(["tomorrow", "next_week"])
    expect(options[0].until).toEqual(local(2026, 9, 7, 9))
    expect(options[1].label).toBe("Next week")
    expect(options[1].until).toEqual(local(2026, 9, 14, 9))
  })

  it("never resolves in the past, and never more than 14 days out", () => {
    for (const now of [FRIDAY_AFTERNOON, SUNDAY_EVENING, WEDNESDAY_LATE, local(2026, 9, 7, 8, 5)]) {
      for (const option of snoozeOptions(now)) {
        expect(option.until.getTime()).toBeGreaterThan(now.getTime())
        expect(option.until.getTime() - now.getTime()).toBeLessThan(14 * 24 * 60 * 60 * 1000)
      }
    }
  })

  it("treats Monday's next Monday as seven days out", () => {
    const monday = local(2026, 9, 7, 10, 0)
    const options = snoozeOptions(monday)
    expect(options.at(-1)).toMatchObject({ key: "next_monday", until: local(2026, 9, 14, 9) })
  })
})

describe("snoozeAtLabel", () => {
  it("drops the weekday for the same day and keeps it otherwise", () => {
    expect(snoozeAtLabel(local(2026, 9, 4, 18, 20), FRIDAY_AFTERNOON)).toBe("18:20")
    expect(snoozeAtLabel(local(2026, 9, 5, 9), FRIDAY_AFTERNOON)).toBe("Sat 09:00")
    expect(snoozeAtLabel(local(2026, 9, 7, 9), FRIDAY_AFTERNOON)).toBe("Mon 09:00")
  })
})

describe("snoozeToastLabel", () => {
  it("reads as a sentence after 'Snoozed until'", () => {
    expect(snoozeToastLabel(local(2026, 9, 4, 18, 20), FRIDAY_AFTERNOON)).toBe("later today")
    expect(snoozeToastLabel(local(2026, 9, 5, 9), FRIDAY_AFTERNOON)).toBe("tomorrow 9:00")
    expect(snoozeToastLabel(local(2026, 9, 7, 9), FRIDAY_AFTERNOON)).toBe("Mon 9:00")
    expect(snoozeToastLabel(local(2026, 9, 14, 9), SUNDAY_EVENING)).toBe("Mon 9:00")
  })

  it("says tomorrow across a month boundary", () => {
    expect(snoozeToastLabel(local(2026, 10, 1, 9), local(2026, 9, 30, 17))).toBe("tomorrow 9:00")
  })
})
