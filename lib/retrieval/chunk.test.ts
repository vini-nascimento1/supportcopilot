import { describe, it, expect } from "vitest"

import {
  checksum,
  chunkMacro,
  chunkNotionPage,
  chunkPlaybook,
  chunkResponse,
  diffChunks,
  estimateTokens,
  normalizeWhitespace,
  splitByHeadings,
  windowText,
  type PlaybookInput,
} from "./chunk"

const playbook: PlaybookInput = {
  id: "pb-1",
  caseType: "Chargebacks from the fan's perspective",
  aliases: ["unauthorised transaction", "pending charge"],
  recognize: "Fan raised a bank dispute or claims an unrecognised charge.",
  checks: "Check 3DS status in Fadmin. Apple Pay never triggers 3DS.",
  resolution: "Never tell the fan to dispute. Explain a pending charge as an authorisation hold.",
  dosDonts: "DON'T instruct a fan to raise a bank dispute.",
}

describe("checksum", () => {
  it("is deterministic across calls", () => {
    expect(checksum("hello world")).toBe(checksum("hello world"))
  })

  it("changes when content changes", () => {
    expect(checksum("hello world")).not.toBe(checksum("hello world!"))
  })
})

describe("normalizeWhitespace", () => {
  it("collapses runs and trims, but keeps paragraph breaks", () => {
    expect(normalizeWhitespace("a   b\r\n\r\n\r\n\r\nc  ")).toBe("a b\n\nc")
  })
})

describe("chunkPlaybook", () => {
  it("emits one chunk per populated field, not one per playbook", () => {
    const chunks = chunkPlaybook(playbook)
    expect(chunks).toHaveLength(4)
    expect(chunks.map((c) => c.section)).toEqual(["recognize", "checks", "resolution", "dos_donts"])
  })

  it("skips empty fields instead of emitting blank chunks", () => {
    const chunks = chunkPlaybook({ ...playbook, checks: null, dosDonts: "   " })
    expect(chunks.map((c) => c.section)).toEqual(["recognize", "resolution"])
  })

  it("carries the case type and aliases into every chunk so it survives isolation", () => {
    for (const chunk of chunkPlaybook(playbook)) {
      expect(chunk.content).toContain("Chargebacks from the fan's perspective")
      expect(chunk.content).toContain("unauthorised transaction")
    }
  })

  it("marks playbooks internal_only — they name Fadmin, ban codes and Slack channels", () => {
    expect(chunkPlaybook(playbook).every((c) => c.visibility === "internal_only")).toBe(true)
  })

  it("gives each chunk a distinct natural key", () => {
    const keys = chunkPlaybook(playbook).map((c) => `${c.section}:${c.chunkIndex}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  // Real playbook fields reach ~4,700 chars. One oversized vector matches
  // everything weakly — the exact failure field-level chunking exists to avoid.
  it("windows an oversized field instead of emitting one blurry chunk", () => {
    const huge = Array.from({ length: 140 }, (_, i) => `Step ${i}: do the thing carefully and completely.`).join("\n\n")
    const chunks = chunkPlaybook({ ...playbook, resolution: huge })
    const resolutionChunks = chunks.filter((c) => c.section === "resolution")
    expect(resolutionChunks.length).toBeGreaterThan(1)
  })

  it("keeps the natural key unique when a field windows into several chunks", () => {
    const huge = Array.from({ length: 140 }, (_, i) => `Step ${i}: do the thing carefully and completely.`).join("\n\n")
    const keys = chunkPlaybook({ ...playbook, resolution: huge }).map((c) => `${c.section}:${c.chunkIndex}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("repeats the case type on every window of a split field", () => {
    const huge = Array.from({ length: 140 }, (_, i) => `Step ${i}: do the thing carefully and completely.`).join("\n\n")
    const chunks = chunkPlaybook({ ...playbook, resolution: huge }).filter((c) => c.section === "resolution")
    for (const c of chunks) expect(c.content).toContain("Chargebacks from the fan's perspective")
  })
})

describe("chunkResponse and chunkMacro", () => {
  it("treats approved response templates as customer safe", () => {
    const [chunk] = chunkResponse({ id: "r1", title: "Pending payout", body: "Your payout is on the way.", playbookId: null })
    expect(chunk.visibility).toBe("customer_safe")
    expect(chunk.content).toContain("Pending payout")
  })

  it("treats a public macro as customer safe and an internal macro as internal", () => {
    const [pub] = chunkMacro({ id: "m1", name: "Payout delay", bodyText: "Sorry for the delay.", visibility: "public" })
    const [priv] = chunkMacro({ id: "m2", name: "Fraud note", bodyText: "Escalate to fraud.", visibility: "internal" })
    expect(pub.visibility).toBe("customer_safe")
    expect(priv.visibility).toBe("internal_only")
  })

  it("drops empty bodies rather than indexing blanks", () => {
    expect(chunkMacro({ id: "m3", name: "Empty", bodyText: "  ", visibility: "public" })).toEqual([])
    expect(chunkResponse({ id: "r2", title: "Empty", body: "", playbookId: null })).toEqual([])
  })

  // The longest real macro is ~4,900 chars (~1,230 tokens).
  it("windows a long macro and keeps the title on every window", () => {
    const long = Array.from({ length: 140 }, (_, i) => `Paragraph ${i} of a long policy macro explaining things.`).join("\n\n")
    const chunks = chunkMacro({ id: "m4", name: "Long policy", bodyText: long, visibility: "public" })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.content).toContain("Long policy")
    expect(new Set(chunks.map((c) => c.chunkIndex)).size).toBe(chunks.length)
  })

  it("windows a long response template too", () => {
    const long = Array.from({ length: 140 }, (_, i) => `Paragraph ${i} of a long response template.`).join("\n\n")
    const chunks = chunkResponse({ id: "r3", title: "Long template", body: long, playbookId: null })
    expect(chunks.length).toBeGreaterThan(1)
    expect(new Set(chunks.map((c) => c.chunkIndex)).size).toBe(chunks.length)
  })

  it("still emits exactly one chunk for a normal-length macro", () => {
    const chunks = chunkMacro({ id: "m5", name: "Short", bodyText: "Sorry about the delay.", visibility: "public" })
    expect(chunks).toHaveLength(1)
    expect(chunks[0].chunkIndex).toBe(0)
  })
})

describe("splitByHeadings", () => {
  it("builds a full heading path from the heading stack", () => {
    const sections = splitByHeadings("Refunds", "# Exemptions\n## Fraudulent Transactions\nOnly within 90 days.")
    expect(sections.at(-1)?.headingPath).toBe("Refunds > Exemptions > Fraudulent Transactions")
  })

  it("keeps preamble text before the first heading under the page title", () => {
    const sections = splitByHeadings("Refunds", "Intro paragraph.\n\n# Exemptions\nBody.")
    expect(sections[0].headingPath).toBe("Refunds")
    expect(sections[0].body).toContain("Intro paragraph.")
  })

  it("pops the stack when returning to a shallower heading level", () => {
    const sections = splitByHeadings("Guide", "# A\n## A1\nx\n# B\ny")
    expect(sections.map((s) => s.headingPath)).toEqual(["Guide > A > A1", "Guide > B"])
  })

  it("drops sections whose body is empty", () => {
    const sections = splitByHeadings("Guide", "# Empty\n\n# Real\nbody")
    expect(sections).toHaveLength(1)
    expect(sections[0].headingPath).toBe("Guide > Real")
  })
})

describe("windowText", () => {
  it("returns a short body as a single window", () => {
    expect(windowText("short body")).toEqual(["short body"])
  })

  it("splits a long body into multiple windows", () => {
    const para = "word ".repeat(200).trim() // ~1000 chars => ~250 tokens
    const body = [para, para, para, para, para].join("\n\n") // ~1250 tokens
    const windows = windowText(body)
    expect(windows.length).toBeGreaterThan(1)
  })

  it("overlaps windows so a fact split at a boundary survives intact somewhere", () => {
    // Production proportions: 800-token window, 100-token overlap, paragraphs
    // of ~105 tokens (larger than the overlap budget, which is the case that
    // used to produce no overlap at all).
    const paras = Array.from({ length: 12 }, (_, i) => `P${i} ` + "filler ".repeat(60).trim())
    const windows = windowText(paras.join("\n\n"))
    expect(windows.length).toBeGreaterThan(1)
    const firstWindowTail = windows[0].split("\n\n").at(-1)
    expect(windows[1]).toContain(firstWindowTail as string)
  })

  it("still overlaps when a paragraph is larger than the overlap budget", () => {
    const paras = Array.from({ length: 6 }, (_, i) => `P${i} ` + "filler ".repeat(60).trim())
    const windows = windowText(paras.join("\n\n"), 300, 20)
    expect(windows.length).toBeGreaterThan(1)
    expect(windows[1]).toContain(windows[0].split("\n\n").at(-1) as string)
  })

  it("splits a single paragraph that is bigger than the whole window", () => {
    const giant = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} with some filler words.`).join(" ")
    const windows = windowText(giant, 100, 20)
    expect(windows.length).toBeGreaterThan(1)
    for (const w of windows) expect(estimateTokens(w)).toBeLessThanOrEqual(140)
  })

  it("splits a single sentence with no punctuation rather than dropping it", () => {
    const runOn = "word ".repeat(500).trim()
    const windows = windowText(runOn, 100, 20)
    expect(windows.length).toBeGreaterThan(1)
    expect(windows.join(" ").split("word").length - 1).toBe(500)
  })

  it("never emits an empty window", () => {
    expect(windowText("a\n\n\n\nb", 1, 0).every((w) => w.trim().length > 0)).toBe(true)
  })
})

describe("chunkNotionPage", () => {
  const page = {
    id: "n1",
    title: "Refunds",
    url: "https://notion.so/refunds",
    text: "# Exemptions\n## Fraudulent Transactions\nOnly consider transactions within 90 days.",
    sourceType: "page",
  }

  it("marks a Notion page customer_safe and a connector source internal_only", () => {
    expect(chunkNotionPage(page)[0].visibility).toBe("customer_safe")
    expect(chunkNotionPage({ ...page, sourceType: "slack" })[0].visibility).toBe("internal_only")
  })

  it("defaults an unknown source type to internal, failing closed", () => {
    expect(chunkNotionPage({ ...page, sourceType: "" })[0].visibility).toBe("internal_only")
  })

  it("embeds the heading path in the content so an isolated window keeps its context", () => {
    const [chunk] = chunkNotionPage(page)
    expect(chunk.content).toContain("Refunds > Exemptions > Fraudulent Transactions")
    expect(chunk.headingPath).toBe("Refunds > Exemptions > Fraudulent Transactions")
  })

  it("numbers chunks sequentially across sections", () => {
    const long = "para ".repeat(400).trim()
    const chunks = chunkNotionPage({ ...page, text: `# A\n${long}\n\n# B\n${long}` })
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i))
  })
})

describe("diffChunks", () => {
  const fresh = chunkPlaybook(playbook)

  it("re-embeds nothing when every checksum matches", () => {
    const existing = fresh.map((c) => ({ section: c.section, chunkIndex: c.chunkIndex, checksum: c.checksum }))
    const diff = diffChunks(fresh, existing)
    expect(diff.toUpsert).toEqual([])
    expect(diff.toDelete).toEqual([])
    expect(diff.unchanged).toBe(4)
  })

  it("re-embeds only the chunk whose content changed", () => {
    const existing = fresh.map((c) => ({ section: c.section, chunkIndex: c.chunkIndex, checksum: c.checksum }))
    existing[2] = { ...existing[2], checksum: "stale" }
    const diff = diffChunks(fresh, existing)
    expect(diff.toUpsert).toHaveLength(1)
    expect(diff.toUpsert[0].section).toBe("resolution")
    expect(diff.unchanged).toBe(3)
  })

  it("deletes orphans so a shortened source stops serving removed policy", () => {
    const existing = [
      ...fresh.map((c) => ({ section: c.section, chunkIndex: c.chunkIndex, checksum: c.checksum })),
      { section: "resolution", chunkIndex: 99, checksum: "old" },
    ]
    const diff = diffChunks(fresh, existing)
    expect(diff.toDelete).toEqual([{ section: "resolution", chunkIndex: 99 }])
  })

  it("treats an empty store as a full ingest", () => {
    const diff = diffChunks(fresh, [])
    expect(diff.toUpsert).toHaveLength(4)
    expect(diff.unchanged).toBe(0)
  })
})

describe("estimateTokens", () => {
  it("scales with length", () => {
    expect(estimateTokens("")).toBe(0)
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("a".repeat(400))).toBe(100)
  })
})
