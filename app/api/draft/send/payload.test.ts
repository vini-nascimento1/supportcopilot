import { describe, it, expect } from "vitest"
import { buildIntercomReplyPayload, MAX_OUTBOUND_FILES } from "./payload"

describe("buildIntercomReplyPayload", () => {
  it("builds a text-only comment reply", () => {
    const p = buildIntercomReplyPayload({ adminId: "42", htmlBody: "<p>hi</p>" })
    expect(p).toEqual({ type: "admin", message_type: "comment", admin_id: "42", body: "<p>hi</p>" })
    expect("attachment_files" in p).toBe(false)
  })

  it("attaches files as attachment_files (base64) when provided", () => {
    const p = buildIntercomReplyPayload({
      adminId: "42",
      htmlBody: "<p>here</p>",
      attachmentFiles: [{ name: "fix.png", contentType: "image/png", data: "AAA" }],
    })
    expect(p.attachment_files).toEqual([{ content_type: "image/png", name: "fix.png", data: "AAA" }])
  })

  it("caps the number of attachments at MAX_OUTBOUND_FILES", () => {
    const files = Array.from({ length: MAX_OUTBOUND_FILES + 3 }, (_, i) => ({ name: `f${i}.png`, contentType: "image/png", data: "AAA" }))
    const p = buildIntercomReplyPayload({ adminId: "42", htmlBody: "<p>x</p>", attachmentFiles: files })
    expect(p.attachment_files?.length).toBe(MAX_OUTBOUND_FILES)
  })
})
