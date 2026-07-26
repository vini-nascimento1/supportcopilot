import { describe, it, expect } from "vitest"

import { stripEmDashes, presetStripsEmDashes, toneInstructionFor } from "./tone-presets"

describe("stripEmDashes", () => {
  it("splits a spaced em dash before a capitalized word into two sentences", () => {
    expect(
      stripEmDashes(
        "I can do that — I will review the account on file and identify which posts are being treated as non-compliant."
      )
    ).toBe(
      "I can do that. I will review the account on file and identify which posts are being treated as non-compliant."
    )
  })

  it("splits before a lowercase word and capitalizes it", () => {
    expect(stripEmDashes("This is great — thanks for the update.")).toBe(
      "This is great. Thanks for the update."
    )
  })

  it("tolerates a markdown bold marker right after the dash", () => {
    expect(
      stripEmDashes(
        "Good question — **there isn't a way in the creator dashboard for you to directly view a fan's email verification status.**"
      )
    ).toBe(
      "Good question. **There isn't a way in the creator dashboard for you to directly view a fan's email verification status.**"
    )
  })

  it("falls back to a comma join when no word character follows", () => {
    expect(stripEmDashes("Wait for it —")).toBe("Wait for it,")
  })

  it("leaves text with no em dash untouched", () => {
    const text = "There is nothing to change here."
    expect(stripEmDashes(text)).toBe(text)
  })

  it("handles multiple em dashes in the same text", () => {
    expect(stripEmDashes("First point — clear. Second point — also clear.")).toBe(
      "First point. Clear. Second point. Also clear."
    )
  })
})

describe("presetStripsEmDashes", () => {
  it("is true only for the human preset", () => {
    expect(presetStripsEmDashes("human")).toBe(true)
    expect(presetStripsEmDashes("professional")).toBe(false)
    expect(presetStripsEmDashes("warm")).toBe(false)
    expect(presetStripsEmDashes("custom")).toBe(false)
    expect(presetStripsEmDashes(null)).toBe(false)
    expect(presetStripsEmDashes(undefined)).toBe(false)
  })
})

describe("toneInstructionFor", () => {
  it("returns null when no preset is set", () => {
    expect(toneInstructionFor(null, null)).toBeNull()
  })

  it("returns the preset's instruction text for a known preset", () => {
    expect(toneInstructionFor("warm", null)).toContain("Tone: Warm")
  })

  it("returns the custom text (prefixed) when preset is custom", () => {
    expect(toneInstructionFor("custom", "Be extra concise.")).toBe(
      "Tone: Custom (agent-defined). Be extra concise."
    )
  })

  it("returns null for custom with empty text", () => {
    expect(toneInstructionFor("custom", "   ")).toBeNull()
  })

  it("returns null for an unknown preset id", () => {
    expect(toneInstructionFor("nonexistent", null)).toBeNull()
  })
})
