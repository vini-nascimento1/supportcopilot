import { describe, it, expect } from "vitest"

import { readApiError } from "./api-error"

const mockResponse = (status: number, text: () => Promise<string>) =>
  ({ status, text } as unknown as Response)

describe("readApiError", () => {
  it("returns the error string from a JSON body", async () => {
    const res = mockResponse(400, () => Promise.resolve(JSON.stringify({ error: "Invalid input" })))
    expect(await readApiError(res)).toBe("Invalid input")
  })

  it("falls back to the raw text when the JSON body has no usable error field", async () => {
    const body = JSON.stringify({ message: "not the field we look for" })
    const res = mockResponse(500, () => Promise.resolve(body))
    expect(await readApiError(res)).toBe(body)
  })

  it("falls back to the raw text when error is present but blank", async () => {
    const body = JSON.stringify({ error: "   " })
    const res = mockResponse(500, () => Promise.resolve(body))
    expect(await readApiError(res)).toBe(body)
  })

  it("returns the raw text when the body isn't JSON at all", async () => {
    const res = mockResponse(502, () => Promise.resolve("Bad Gateway"))
    expect(await readApiError(res)).toBe("Bad Gateway")
  })

  it("returns a default 'Request failed (<status>)' message for an empty body with no fallback", async () => {
    const res = mockResponse(503, () => Promise.resolve(""))
    expect(await readApiError(res)).toBe("Request failed (503)")
  })

  it("returns the provided fallback for an empty body", async () => {
    const res = mockResponse(503, () => Promise.resolve(""))
    expect(await readApiError(res, "Service unavailable")).toBe("Service unavailable")
  })

  it("falls back gracefully (doesn't throw) when response.text() itself rejects", async () => {
    const res = mockResponse(500, () => Promise.reject(new Error("stream already read")))
    expect(await readApiError(res, "Something went wrong")).toBe("Something went wrong")
  })

  it("uses the default status message when text() rejects and no fallback is given", async () => {
    const res = mockResponse(500, () => Promise.reject(new Error("stream already read")))
    expect(await readApiError(res)).toBe("Request failed (500)")
  })
})
