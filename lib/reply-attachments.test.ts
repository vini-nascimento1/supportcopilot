import { describe, it, expect } from "vitest"
import { isImageType, MAX_OUTBOUND_FILES, ALLOWED_SEND_TYPES } from "./reply-attachments"

describe("reply-attachments", () => {
  it("recognizes images", () => {
    expect(isImageType("image/png")).toBe(true)
    expect(isImageType("application/pdf")).toBe(false)
  })
  it("allows images + pdf for sending", () => {
    expect(ALLOWED_SEND_TYPES.has("image/png")).toBe(true)
    expect(ALLOWED_SEND_TYPES.has("application/pdf")).toBe(true)
  })
  it("caps outbound files", () => {
    expect(MAX_OUTBOUND_FILES).toBe(8)
  })
})
