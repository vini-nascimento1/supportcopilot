import { describe, it, expect } from "vitest"

import {
  resolveToolUrl,
  suggestedTools,
  reconcileRestoredToolUrl,
  type CanvasTool,
} from "./canvas-tools"

describe("resolveToolUrl", () => {
  it("substitutes a known placeholder", () => {
    expect(
      resolveToolUrl("https://fadmin.fanvue.com/{{email}}", { email: "a@b.com" }),
    ).toBe("https://fadmin.fanvue.com/a%40b.com")
  })

  it("returns null when a placeholder can't be filled", () => {
    expect(resolveToolUrl("https://fadmin.fanvue.com/{{email}}", {})).toBeNull()
  })

  it("leaves a template with no placeholders untouched", () => {
    expect(resolveToolUrl("https://fadmin.fanvue.com", {})).toBe(
      "https://fadmin.fanvue.com",
    )
  })
})

describe("suggestedTools", () => {
  const tools: CanvasTool[] = [
    { id: "fadmin", name: "Fadmin", icon: null, urlTemplate: "https://fadmin.fanvue.com", group: "Fanvue", tags: [] },
    { id: "ondato", name: "ONDATO", icon: null, urlTemplate: "https://os.ondato.com", group: "KYC", tags: ["kyc"] },
  ]

  it("always includes Fanvue-group tools", () => {
    expect(suggestedTools(tools, [], "").map((t) => t.id)).toContain("fadmin")
  })

  it("matches by Intercom tag", () => {
    expect(suggestedTools(tools, ["kyc"], "").map((t) => t.id)).toContain("ondato")
  })

  it("matches by ticket-text keyword when the tag is missing", () => {
    expect(
      suggestedTools(tools, [], "please verify my identity").map((t) => t.id),
    ).toContain("ondato")
  })
})

describe("reconcileRestoredToolUrl", () => {
  const ctx = { email: "new@fanvue.com" }

  it("returns null when the card has no urlTemplate (can't re-resolve)", () => {
    expect(
      reconcileRestoredToolUrl({ url: "https://fadmin.fanvue.com/old" }, ctx),
    ).toBeNull()
  })

  it("returns null when the fresh context still can't fill the template", () => {
    expect(
      reconcileRestoredToolUrl(
        { url: "", urlTemplate: "https://fadmin.fanvue.com/{{email}}" },
        {},
      ),
    ).toBeNull()
  })

  it("returns null when the re-resolved URL is unchanged", () => {
    expect(
      reconcileRestoredToolUrl(
        {
          url: "https://fadmin.fanvue.com/new%40fanvue.com",
          urlTemplate: "https://fadmin.fanvue.com/{{email}}",
        },
        ctx,
      ),
    ).toBeNull()
  })

  it("swaps `url` directly for a ghost card", () => {
    expect(
      reconcileRestoredToolUrl(
        {
          url: "https://fadmin.fanvue.com/old%40fanvue.com",
          urlTemplate: "https://fadmin.fanvue.com/{{email}}",
          ghost: true,
        },
        ctx,
      ),
    ).toEqual({ url: "https://fadmin.fanvue.com/new%40fanvue.com" })
  })

  it("sets `pendingUrl` (never yanks) for a loaded, non-ghost card", () => {
    expect(
      reconcileRestoredToolUrl(
        {
          url: "https://fadmin.fanvue.com/old%40fanvue.com",
          urlTemplate: "https://fadmin.fanvue.com/{{email}}",
        },
        ctx,
      ),
    ).toEqual({ pendingUrl: "https://fadmin.fanvue.com/new%40fanvue.com" })
  })
})
