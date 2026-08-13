import { describe, it, expect } from "vitest"

import { parseSteps } from "./parse-steps"

describe("parseSteps", () => {
  it("returns [] for null/undefined/empty input", () => {
    expect(parseSteps(null)).toEqual([])
    expect(parseSteps(undefined)).toEqual([])
    expect(parseSteps("")).toEqual([])
  })

  it("splits a numbered list and re-attaches the first item's stripped number", () => {
    const text = "1. First step\n2. Second step\n3. Third step"
    expect(parseSteps(text)).toEqual(["First step", "Second step", "Third step"])
  })

  it("does not split on a number embedded mid-sentence inside a list item", () => {
    // "version 2.0" here is not preceded by a newline, so it must not be
    // treated as a new list item even though it sits between two real ones.
    const text = "1. Intro\n2. Mentions version 2.0 update\n3. Outro"
    expect(parseSteps(text)).toEqual(["Intro", "Mentions version 2.0 update", "Outro"])
  })

  it("does not split on a decimal-looking number right after a newline", () => {
    // "\n2.0 " fails the `\d+\.\s+` pattern because "0" immediately follows
    // the dot instead of whitespace, so this must fall through to the
    // bullet/plain-line fallback rather than the numbered-list path.
    const text = "Announcement\n2.0 was released today"
    expect(parseSteps(text)).toEqual(["Announcement", "2.0 was released today"])
  })

  it("falls back to bullet lines when there is no numbered list", () => {
    const text = "- First step\n- Second step\n* Third step"
    expect(parseSteps(text)).toEqual(["First step", "Second step", "Third step"])
  })

  it("falls back to plain lines, dropping blank ones, when there is no list at all", () => {
    const text = "Just a plain line\nAnother line\n\nFinal line"
    expect(parseSteps(text)).toEqual(["Just a plain line", "Another line", "Final line"])
  })
})
