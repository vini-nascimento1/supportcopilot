import { describe, it, expect, vi, afterEach } from "vitest"

import { clipToolBounds, clampPinnedScreenRect } from "./canvas-bounds"

// No jsdom in this vitest project (node environment), so DOMRect/Element are
// only ambient TS types, not runtime globals. clipToolBounds only reads
// left/top/right/bottom off the rect, and getBoundingClientRect/
// querySelectorAll/getAttribute off the pane and its chrome children — so
// minimal fakes matching just that shape are enough.
function fakeRect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function chromeEl(dock: "left" | "right", rect: DOMRect): Element {
  return {
    getBoundingClientRect: () => rect,
    getAttribute: (name: string) => (name === "data-canvas-chrome" ? dock : null),
  } as unknown as Element
}

function fakePane(paneRect: DOMRect, chromeEls: Element[] = []): Element {
  return {
    getBoundingClientRect: () => paneRect,
    querySelectorAll: () => chromeEls as unknown as NodeListOf<Element>,
  } as unknown as Element
}

describe("clipToolBounds", () => {
  it("passes the rect through unclipped when there's no pane", () => {
    const result = clipToolBounds(fakeRect(10, 20, 210, 220), null)
    expect(result).toEqual({ x: 10, y: 20, width: 200, height: 200 })
  })

  it("still applies the min-visible floor with no pane", () => {
    // 40x200: width alone is under MIN_VISIBLE, even though there's no pane to blame
    const result = clipToolBounds(fakeRect(10, 20, 50, 220), null)
    expect(result).toBeNull()
  })

  it("clips the rect down to the pane's bounds", () => {
    const pane = fakePane(fakeRect(0, 0, 300, 200))
    // rect extends past the pane's right and bottom edges
    const result = clipToolBounds(fakeRect(100, 50, 400, 400), pane)
    expect(result).toEqual({ x: 100, y: 50, width: 200, height: 150 })
  })

  it("insets past a left-docked chrome element that vertically overlaps the rect", () => {
    const chrome = chromeEl("left", fakeRect(0, 50, 150, 450))
    const pane = fakePane(fakeRect(0, 0, 500, 500), [chrome])
    const result = clipToolBounds(fakeRect(100, 100, 400, 400), pane)
    expect(result).toEqual({ x: 150, y: 100, width: 250, height: 300 })
  })

  it("insets past a right-docked chrome element that vertically overlaps the rect", () => {
    const chrome = chromeEl("right", fakeRect(350, 50, 500, 450))
    const pane = fakePane(fakeRect(0, 0, 500, 500), [chrome])
    const result = clipToolBounds(fakeRect(100, 100, 400, 400), pane)
    expect(result).toEqual({ x: 100, y: 100, width: 250, height: 300 })
  })

  it("ignores a chrome element that doesn't vertically overlap the rect", () => {
    // chrome sits entirely below the rect's vertical range (top 500 >= rect bottom 400)
    const chrome = chromeEl("left", fakeRect(0, 500, 150, 600))
    const pane = fakePane(fakeRect(0, 0, 500, 500), [chrome])
    const result = clipToolBounds(fakeRect(100, 100, 400, 400), pane)
    expect(result).toEqual({ x: 100, y: 100, width: 300, height: 300 })
  })

  it("skips a chrome element with zero width or height", () => {
    const zeroWidth = chromeEl("left", fakeRect(100, 100, 100, 400)) // width 0
    const pane = fakePane(fakeRect(0, 0, 500, 500), [zeroWidth])
    const result = clipToolBounds(fakeRect(100, 100, 400, 400), pane)
    expect(result).toEqual({ x: 100, y: 100, width: 300, height: 300 })
  })

  it("returns null once the pane clip drops width or height below MIN_VISIBLE", () => {
    const pane = fakePane(fakeRect(0, 0, 500, 500))
    // clips down to 50x50
    const result = clipToolBounds(fakeRect(450, 450, 600, 600), pane)
    expect(result).toBeNull()
  })

  describe("document-level chrome (fixed overlays outside the pane)", () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it("insets past chrome found on document even when the pane has none (AI Assistant panel/FAB)", () => {
      const chrome = chromeEl("right", fakeRect(350, 50, 500, 450))
      const pane = fakePane(fakeRect(0, 0, 500, 500), [])
      vi.stubGlobal("document", {
        querySelectorAll: () => [chrome] as unknown as NodeListOf<Element>,
      })
      const result = clipToolBounds(fakeRect(100, 100, 400, 400), pane)
      expect(result).toEqual({ x: 100, y: 100, width: 250, height: 300 })
    })

    it("still ignores document-level chrome without vertical overlap", () => {
      const chrome = chromeEl("right", fakeRect(350, 450, 500, 500))
      const pane = fakePane(fakeRect(0, 0, 500, 500), [])
      vi.stubGlobal("document", {
        querySelectorAll: () => [chrome] as unknown as NodeListOf<Element>,
      })
      const result = clipToolBounds(fakeRect(100, 100, 400, 400), pane)
      expect(result).toEqual({ x: 100, y: 100, width: 300, height: 300 })
    })
  })
})

describe("clampPinnedScreenRect", () => {
  it("leaves a rect unchanged when it already fits", () => {
    const result = clampPinnedScreenRect({ left: 100, top: 50, width: 300, height: 200 }, 1000, 800)
    expect(result).toEqual({ left: 100, top: 50, width: 300, height: 200 })
  })

  it("shrinks a rect larger than the current pane down to pane size", () => {
    const result = clampPinnedScreenRect({ left: 0, top: 0, width: 800, height: 600 }, 400, 300)
    expect(result).toEqual({ left: 0, top: 0, width: 400, height: 300 })
  })

  it("floors at MIN_VISIBLE even if the pane itself is smaller", () => {
    const result = clampPinnedScreenRect({ left: 0, top: 0, width: 100, height: 100 }, 40, 30)
    expect(result).toEqual({ left: 0, top: 0, width: 60, height: 60 })
  })

  it("repositions left (not just clips width) when left+width would overflow the pane", () => {
    const result = clampPinnedScreenRect({ left: 450, top: 50, width: 200, height: 100 }, 500, 500)
    expect(result).toEqual({ left: 300, top: 50, width: 200, height: 100 })
  })

  it("repositions top (not just clips height) when top+height would overflow the pane", () => {
    const result = clampPinnedScreenRect({ left: 50, top: 450, width: 100, height: 200 }, 500, 500)
    expect(result).toEqual({ left: 50, top: 300, width: 100, height: 200 })
  })

  it("clamps negative left/top to 0", () => {
    const result = clampPinnedScreenRect({ left: -50, top: -30, width: 100, height: 100 }, 500, 500)
    expect(result).toEqual({ left: 0, top: 0, width: 100, height: 100 })
  })
})
