import { describe, it, expect } from "vitest"

import {
  MAX_DISMISS_IDS,
  MAX_SNOOZE_MS,
  isValidItemId,
  parseDismissBody,
  parseItemIds,
} from "./dismissals"

// The dismiss route is a thin shell over parseDismissBody, so this is where the
// input rules for POST/DELETE /api/briefing/dismiss are pinned down.

const NOW = Date.parse("2026-09-01T12:00:00.000Z")

describe("isValidItemId", () => {
  it("accepts the ids the sources actually mint", () => {
    expect(isValidItemId("intercom:12345")).toBe(true)
    expect(isValidItemId("slack:C0ABC:1788000000.000100")).toBe(true)
    expect(isValidItemId("gmail:18f0c")).toBe(true)
    expect(isValidItemId("calendar:evt_1")).toBe(true)
  })

  it("rejects anything without a known prefix, and anything oversized", () => {
    expect(isValidItemId("")).toBe(false)
    expect(isValidItemId("intercom")).toBe(false)
    expect(isValidItemId("fadmin:1")).toBe(false)
    expect(isValidItemId(42)).toBe(false)
    expect(isValidItemId(`intercom:${"x".repeat(300)}`)).toBe(false)
  })
})

describe("parseItemIds", () => {
  it("deduplicates a valid batch", () => {
    const parsed = parseItemIds({ ids: ["intercom:1", "intercom:1", "gmail:2"] })
    expect(parsed).toEqual({ ok: true, ids: ["intercom:1", "gmail:2"] })
  })

  it("refuses a missing, empty or oversized array", () => {
    expect(parseItemIds({}).ok).toBe(false)
    expect(parseItemIds({ ids: "intercom:1" }).ok).toBe(false)
    expect(parseItemIds({ ids: [] }).ok).toBe(false)
    expect(parseItemIds({ ids: Array(MAX_DISMISS_IDS + 1).fill("intercom:1") }).ok).toBe(false)
  })

  it("refuses a batch where any single id is invalid", () => {
    expect(parseItemIds({ ids: ["intercom:1", "drop table"] }).ok).toBe(false)
  })
})

describe("parseDismissBody", () => {
  const ids = ["intercom:1"]

  it("defaults to a manual dismissal with no wake-up time", () => {
    expect(parseDismissBody({ ids }, NOW)).toEqual({ ok: true, ids, reason: "manual" })
  })

  it("accepts the two reasons a client is allowed to state", () => {
    expect(parseDismissBody({ ids, reason: "manual" }, NOW)).toMatchObject({ reason: "manual" })
    expect(parseDismissBody({ ids, reason: "acted" }, NOW)).toMatchObject({ reason: "acted" })
  })

  it("refuses the server-only reasons and anything unknown", () => {
    // "read" is written from a real Slack/Gmail signal and "snooze" follows
    // from `until`; a client asserting either would be taken on trust.
    expect(parseDismissBody({ ids, reason: "read" }, NOW).ok).toBe(false)
    expect(parseDismissBody({ ids, reason: "snooze" }, NOW).ok).toBe(false)
    expect(parseDismissBody({ ids, reason: "whatever" }, NOW).ok).toBe(false)
    expect(parseDismissBody({ ids, reason: 3 }, NOW).ok).toBe(false)
  })

  it("turns a valid `until` into a snooze and normalises it to ISO", () => {
    const parsed = parseDismissBody({ ids, until: "2026-09-01T15:00:00+01:00" }, NOW)
    expect(parsed).toEqual({
      ok: true,
      ids,
      reason: "snooze",
      until: "2026-09-01T14:00:00.000Z",
    })
  })

  it("lets `until` win over a stated reason", () => {
    expect(parseDismissBody({ ids, reason: "acted", until: new Date(NOW + 3_600_000).toISOString() }, NOW))
      .toMatchObject({ reason: "snooze" })
  })

  it("refuses a snooze that is unparseable, in the past, or too far ahead", () => {
    expect(parseDismissBody({ ids, until: "tomorrow-ish" }, NOW).ok).toBe(false)
    expect(parseDismissBody({ ids, until: 1_760_000_000 }, NOW).ok).toBe(false)
    expect(parseDismissBody({ ids, until: new Date(NOW - 1_000).toISOString() }, NOW).ok).toBe(false)
    expect(parseDismissBody({ ids, until: new Date(NOW).toISOString() }, NOW).ok).toBe(false)
    expect(
      parseDismissBody({ ids, until: new Date(NOW + MAX_SNOOZE_MS + 1_000).toISOString() }, NOW).ok
    ).toBe(false)
    // The boundary itself is fine.
    expect(
      parseDismissBody({ ids, until: new Date(NOW + MAX_SNOOZE_MS).toISOString() }, NOW).ok
    ).toBe(true)
  })

  it("still validates the ids before anything else", () => {
    expect(parseDismissBody({ ids: [], reason: "acted" }, NOW).ok).toBe(false)
    expect(parseDismissBody({ ids: ["nope"], until: new Date(NOW + 60_000).toISOString() }, NOW).ok)
      .toBe(false)
    expect(parseDismissBody(null, NOW).ok).toBe(false)
  })
})
