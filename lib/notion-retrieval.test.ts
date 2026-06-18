import { describe, it, expect } from "vitest"

import { isInternalSource, mapAiSearchResults } from "./notion-retrieval"

// Real captured shape of the hosted-MCP notion-search (ai_search mode) response.
const SAMPLE = {
  type: "ai_search",
  results: [
    {
      id: "30f0f387-1276-8151-9a9d-c128577494f8",
      title: "Troubleshooting Guide",
      url: "https://app.notion.com/p/30f0f387127681519a9dc128577494f8?pvs=1",
      type: "page",
      highlight:
        "Compliance hold - Raise in #payout-issues. Do not attempt to resolve compliance blocks yourself...",
      timestamp: "2 months ago (2026-04-15)",
    },
    {
      id: "google-drive://?url=...&file_id=17pUUuu...&file_type=document",
      title: "Support SOP",
      url: "https://docs.google.com/document/d/17pUUuu7Kx4SAmFqdhN14-Qoxqz9Y7JafdzkMPPHF37k",
      type: "google-drive",
      highlight: "Support SOP ... Strike 1, Strike 2 ...",
      timestamp: "1 year ago (2025-04-29)",
    },
    {
      id: "c4a28e12-cf35-424b-b085-0be966c593b6",
      title: "Guide: Creator Success (CS)",
      url: "https://app.notion.com/p/c4a28e12cf35424bb0850be966c593b6?pvs=1",
      type: "page",
      highlight: "This protects the creator from unauthorised withdrawals...",
      timestamp: "3 months ago (2026-02-25)",
    },
  ],
}

describe("isInternalSource", () => {
  it("a Notion page is first-class knowledge → not internal", () => {
    expect(isInternalSource("page")).toBe(false)
  })

  it("connector/external sources are flagged internal", () => {
    expect(isInternalSource("google-drive")).toBe(true)
    expect(isInternalSource("slack")).toBe(true)
    expect(isInternalSource("linear")).toBe(true)
  })
})

describe("mapAiSearchResults", () => {
  it("maps the real ai_search sample into 3 snippets (limit 5)", () => {
    const snippets = mapAiSearchResults(SAMPLE, 5)
    expect(snippets).toHaveLength(3)
  })

  it("maps the google-drive result field-by-field", () => {
    const snippets = mapAiSearchResults(SAMPLE, 5)
    const drive = snippets[1]
    expect(drive.source).toBe("google-drive")
    expect(drive.isInternalSource).toBe(true)
    expect(drive.text).toBe("Support SOP ... Strike 1, Strike 2 ...")
    expect(drive.url).toBe(
      "https://docs.google.com/document/d/17pUUuu7Kx4SAmFqdhN14-Qoxqz9Y7JafdzkMPPHF37k"
    )
    expect(drive.id).toBe(
      "google-drive://?url=...&file_id=17pUUuu...&file_type=document"
    )
    expect(drive.title).toBe("Support SOP")
    expect(drive.timestamp).toBe("1 year ago (2025-04-29)")
  })

  it("flags both Notion page results as not internal", () => {
    const snippets = mapAiSearchResults(SAMPLE, 5)
    expect(snippets[0].source).toBe("page")
    expect(snippets[0].isInternalSource).toBe(false)
    expect(snippets[0].text).toBe(
      "Compliance hold - Raise in #payout-issues. Do not attempt to resolve compliance blocks yourself..."
    )
    expect(snippets[2].source).toBe("page")
    expect(snippets[2].isInternalSource).toBe(false)
  })

  it("text falls back to empty string when highlight is missing", () => {
    const raw = {
      type: "ai_search",
      results: [
        {
          id: "no-highlight",
          title: "No Highlight Page",
          url: "https://app.notion.com/p/nohighlight",
          type: "page",
          timestamp: "today",
        },
      ],
    }
    const snippets = mapAiSearchResults(raw, 5)
    expect(snippets).toHaveLength(1)
    expect(snippets[0].text).toBe("")
  })

  it("timestamp falls back to null when absent", () => {
    const raw = {
      type: "ai_search",
      results: [
        {
          id: "no-ts",
          title: "No Timestamp Page",
          url: "https://app.notion.com/p/nots",
          type: "page",
          highlight: "some text",
        },
      ],
    }
    const snippets = mapAiSearchResults(raw, 5)
    expect(snippets).toHaveLength(1)
    expect(snippets[0].timestamp).toBeNull()
  })

  it("respects the limit (limit 2 on 3-result sample → first 2 in order)", () => {
    const snippets = mapAiSearchResults(SAMPLE, 2)
    expect(snippets).toHaveLength(2)
    expect(snippets[0].title).toBe("Troubleshooting Guide")
    expect(snippets[1].title).toBe("Support SOP")
  })

  it("limit 0 → empty array", () => {
    expect(mapAiSearchResults(SAMPLE, 0)).toEqual([])
  })

  describe("defensive: never throws on garbage input", () => {
    it("null → []", () => {
      expect(mapAiSearchResults(null, 5)).toEqual([])
    })

    it("non-object (string / number) → []", () => {
      expect(mapAiSearchResults("x", 5)).toEqual([])
      expect(mapAiSearchResults(42, 5)).toEqual([])
    })

    it("object with no results → []", () => {
      expect(mapAiSearchResults({}, 5)).toEqual([])
    })

    it("results is not an array → []", () => {
      expect(mapAiSearchResults({ results: "x" }, 5)).toEqual([])
    })

    it("skips entries missing id OR title OR url; keeps valid ones", () => {
      const raw = {
        type: "ai_search",
        results: [
          { title: "missing id", url: "u", type: "page" },
          { id: "missing-title", url: "u", type: "page" },
          { id: "missing-url", title: "missing url", type: "page" },
          null,
          "garbage",
          {
            id: "valid",
            title: "Valid Page",
            url: "https://app.notion.com/p/valid",
            type: "page",
            highlight: "hi",
          },
        ],
      }
      const snippets = mapAiSearchResults(raw, 5)
      expect(snippets).toHaveLength(1)
      expect(snippets[0].id).toBe("valid")
    })

    it("missing type defaults to a non-empty source and is treated as internal (not a Notion page)", () => {
      const raw = {
        type: "ai_search",
        results: [
          {
            id: "no-type",
            title: "No Type",
            url: "https://example.com/x",
            highlight: "hi",
          },
        ],
      }
      const snippets = mapAiSearchResults(raw, 5)
      expect(snippets).toHaveLength(1)
      expect(snippets[0].isInternalSource).toBe(true)
    })
  })
})
