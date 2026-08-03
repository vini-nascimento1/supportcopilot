import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  acquireAiSlot,
  releaseAiSlot,
  withAiSlot,
  parseRetryAfterMs,
  AI_THROTTLE_LIMITS,
} from "./ai-throttle"

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

describe("shared-key slot gate", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("caps concurrency: the (maxConcurrency+1)th acquire waits until a release", async () => {
    // Read the cap off the module rather than hardcoding it — the defaults are
    // env-tunable and get retuned as the org's rate limits change.
    const cap = AI_THROTTLE_LIMITS.maxConcurrency
    for (let i = 0; i < cap; i++) await acquireAiSlot()

    let extraResolved = false
    const extra = acquireAiSlot().then(() => {
      extraResolved = true
    })

    // Give the polling loop a couple of ticks — it must still be blocked.
    await new Promise((r) => setTimeout(r, 120))
    expect(extraResolved).toBe(false)

    // Freeing one slot lets the queued acquire through.
    releaseAiSlot()
    await extra
    expect(extraResolved).toBe(true)

    // Clean up the slots we still hold (cap: the originals minus the one we
    // released, plus the queued acquire that took its place).
    for (let i = 0; i < cap; i++) releaseAiSlot()
  })

  it("withAiSlot releases even when fn throws", async () => {
    await expect(
      withAiSlot(async () => {
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")

    // If the slot leaked, filling the pool sequentially would deadlock. These
    // resolve fast because the failed call released its slot.
    for (let i = 0; i <= AI_THROTTLE_LIMITS.maxConcurrency; i++) {
      await withAiSlot(async () => "ok")
    }
  })

  it("rejects a pending acquire when its abort signal fires", async () => {
    // Saturate concurrency so the next acquire has to wait.
    const cap = AI_THROTTLE_LIMITS.maxConcurrency
    for (let i = 0; i < cap; i++) await acquireAiSlot()

    const controller = new AbortController()
    const pending = acquireAiSlot(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })

    for (let i = 0; i < cap; i++) releaseAiSlot()
  })
})
