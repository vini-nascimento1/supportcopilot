import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  acquireVerbooSlot,
  releaseVerbooSlot,
  withVerbooSlot,
  parseRetryAfterMs,
} from "./verboo-throttle"

describe("parseRetryAfterMs", () => {
  it("returns null for absent / empty / unparseable values", () => {
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs(undefined)).toBeNull()
    expect(parseRetryAfterMs("")).toBeNull()
    expect(parseRetryAfterMs("   ")).toBeNull()
    expect(parseRetryAfterMs("soon")).toBeNull()
  })

  it("reads delta-seconds as milliseconds", () => {
    expect(parseRetryAfterMs("0")).toBe(0)
    expect(parseRetryAfterMs("2")).toBe(2000)
    expect(parseRetryAfterMs("30")).toBe(30000)
  })

  it("reads an HTTP date as a delay from now", () => {
    const base = new Date("2026-07-08T12:00:00Z").getTime()
    vi.useFakeTimers()
    vi.setSystemTime(base)
    // 5s in the future
    expect(parseRetryAfterMs(new Date(base + 5000).toUTCString())).toBe(5000)
    // A past date clamps to 0, never negative
    expect(parseRetryAfterMs(new Date(base - 5000).toUTCString())).toBe(0)
    vi.useRealTimers()
  })
})

describe("verboo slot gate", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("caps concurrency: the (MAX_CONCURRENCY+1)th acquire waits until a release", async () => {
    // Default MAX_CONCURRENCY is 3. Fill the three slots.
    await acquireVerbooSlot()
    await acquireVerbooSlot()
    await acquireVerbooSlot()

    let fourthResolved = false
    const fourth = acquireVerbooSlot().then(() => {
      fourthResolved = true
    })

    // Give the polling loop a couple of ticks — it must still be blocked.
    await new Promise((r) => setTimeout(r, 120))
    expect(fourthResolved).toBe(false)

    // Freeing one slot lets the queued acquire through.
    releaseVerbooSlot()
    await fourth
    expect(fourthResolved).toBe(true)

    // Clean up the slots we still hold (3: two originals + the fourth).
    releaseVerbooSlot()
    releaseVerbooSlot()
    releaseVerbooSlot()
  })

  it("withVerbooSlot releases even when fn throws", async () => {
    await expect(
      withVerbooSlot(async () => {
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")

    // If the slot leaked, four sequential acquires would deadlock. They resolve
    // fast because the failed call released its slot.
    await withVerbooSlot(async () => "ok")
    await withVerbooSlot(async () => "ok")
    await withVerbooSlot(async () => "ok")
    await withVerbooSlot(async () => "ok")
  })

  it("rejects a pending acquire when its abort signal fires", async () => {
    // Saturate concurrency so the next acquire has to wait.
    await acquireVerbooSlot()
    await acquireVerbooSlot()
    await acquireVerbooSlot()

    const controller = new AbortController()
    const pending = acquireVerbooSlot(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })

    releaseVerbooSlot()
    releaseVerbooSlot()
    releaseVerbooSlot()
  })
})
