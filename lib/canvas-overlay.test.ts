import { describe, it, expect, afterEach, vi } from "vitest"

import { hasBlockingOverlay } from "./canvas-overlay"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("hasBlockingOverlay", () => {
  it("returns false when document doesn't exist (SSR / non-DOM context)", () => {
    expect(hasBlockingOverlay()).toBe(false)
  })

  it("returns true when the selector finds a match", () => {
    vi.stubGlobal("document", { querySelector: () => ({}) })
    expect(hasBlockingOverlay()).toBe(true)
  })

  it("returns false when the selector finds nothing", () => {
    vi.stubGlobal("document", { querySelector: () => null })
    expect(hasBlockingOverlay()).toBe(false)
  })

  it("queries the exact combined selector for both the dialog case and the manual escape hatch", () => {
    const querySelector = vi.fn(() => null)
    vi.stubGlobal("document", { querySelector })
    hasBlockingOverlay()
    expect(querySelector).toHaveBeenCalledWith(
      '[role="dialog"][data-state="open"], [data-canvas-overlay]',
    )
  })
})
