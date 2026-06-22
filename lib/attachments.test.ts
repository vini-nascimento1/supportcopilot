import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { encodeImageAttachments } from "./attachments"
import type { ConversationAttachment } from "./intercom"

// Helper: build a ConversationAttachment with sane defaults.
function attachment(overrides: Partial<ConversationAttachment> = {}): ConversationAttachment {
  return {
    name: "shot.png",
    url: "https://cdn.example.com/shot.png",
    contentType: "image/png",
    filesize: 1024,
    ...overrides,
  }
}

// Helper: a customer message carrying the given attachments.
function customerMsg(attachments: ConversationAttachment[]) {
  return { role: "customer", attachments }
}

// A fetch stub that always succeeds with 8 bytes — well under MAX_IMAGE_BYTES.
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("encodeImageAttachments", () => {
  it("returns [] when no messages have attachments", async () => {
    const result = await encodeImageAttachments([customerMsg([]), customerMsg([])])
    expect(result).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("encodes an image/png attachment into a data URI, preserving the name", async () => {
    const result = await encodeImageAttachments([
      customerMsg([attachment({ name: "receipt.png", contentType: "image/png" })]),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("receipt.png")
    expect(result[0].dataUri.startsWith("data:image/png;base64,")).toBe(true)
  })

  it("skips a non-image attachment (application/pdf)", async () => {
    const result = await encodeImageAttachments([
      customerMsg([
        attachment({ name: "doc.pdf", url: "https://cdn.example.com/doc.pdf", contentType: "application/pdf" }),
      ]),
    ])
    expect(result).toEqual([])
    // A rejected content type is filtered before any download.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("skips an oversized attachment (known filesize > cap) without fetching it", async () => {
    const oversized = attachment({
      name: "huge.png",
      contentType: "image/png",
      filesize: 5 * 1024 * 1024 + 1, // one byte over MAX_IMAGE_BYTES
    })
    const result = await encodeImageAttachments([customerMsg([oversized])])
    expect(result).toEqual([])
    // Oversized attachments are short-circuited before spending a download.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("caps the number of encoded images at 4, keeping the most recent", async () => {
    const images = Array.from({ length: 6 }, (_, i) =>
      attachment({ name: `img-${i}.png`, url: `https://cdn.example.com/img-${i}.png`, contentType: "image/png" }),
    )
    const result = await encodeImageAttachments([customerMsg(images)])
    expect(result).toHaveLength(4)
    const names = result.map((r) => r.name)
    // Most recent kept, oldest dropped.
    expect(names).toContain("img-5.png")
    expect(names).not.toContain("img-0.png")
  })

  it("dedupes attachments that share a URL", async () => {
    const dupe = attachment({ name: "same.png", url: "https://cdn.example.com/same.png" })
    const result = await encodeImageAttachments([
      customerMsg([dupe]),
      customerMsg([{ ...dupe }]), // same url, different object
    ])
    expect(result).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("ignores attachments on agent (admin) messages — only the customer's images are sent", async () => {
    const result = await encodeImageAttachments([
      { role: "admin", attachments: [attachment({ name: "agent.png", url: "https://cdn.example.com/agent.png" })] },
      customerMsg([attachment({ name: "customer.png", url: "https://cdn.example.com/customer.png" })]),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("customer.png")
  })

  it("refuses non-https / internal-host URLs (SSRF guard)", async () => {
    const result = await encodeImageAttachments([
      customerMsg([
        attachment({ name: "meta.png", url: "https://169.254.169.254/meta.png" }), // metadata IP
        attachment({ name: "plain.png", url: "http://cdn.example.com/plain.png" }), // not https
        attachment({ name: "ok.png", url: "https://cdn.example.com/ok.png" }),
      ]),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("ok.png")
    // Only the safe URL was fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
