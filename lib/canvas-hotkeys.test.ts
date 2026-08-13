import { describe, it, expect } from "vitest"

import { isTypingTarget } from "./canvas-hotkeys"

function el(overrides: Partial<{ tagName: string; isContentEditable: boolean }> = {}) {
  return { tagName: "DIV", isContentEditable: false, ...overrides } as unknown as HTMLElement
}

describe("isTypingTarget", () => {
  it("is false for a null target", () => {
    expect(isTypingTarget(null)).toBe(false)
  })

  it("is false for a target with no tagName", () => {
    expect(isTypingTarget({} as EventTarget)).toBe(false)
  })

  it.each(["INPUT", "TEXTAREA", "SELECT"])("is true for a %s element", (tag) => {
    expect(isTypingTarget(el({ tagName: tag }))).toBe(true)
  })

  it("is case-insensitive on tagName", () => {
    expect(isTypingTarget(el({ tagName: "input" }))).toBe(true)
  })

  it("is false for a plain, non-contenteditable element", () => {
    expect(isTypingTarget(el({ tagName: "DIV" }))).toBe(false)
  })

  it("is true for any contenteditable element regardless of tag", () => {
    expect(isTypingTarget(el({ tagName: "DIV", isContentEditable: true }))).toBe(true)
  })
})

// useCanvasListHotkeys is a thin useEffect/useRef wrapper: it registers a
// window keydown listener and delegates matching to isTypingTarget above.
// There's no separable pure logic left to unit test, and this repo has no
// @testing-library/react (or any hook-rendering harness) to mount it under a
// real effect cycle, so it's intentionally left untested here.
