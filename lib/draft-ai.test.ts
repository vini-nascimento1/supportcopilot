import { describe, it, expect } from "vitest"

import {
  buildMacroAdaptSystemPrompt,
  buildMacroAdaptUserMessage,
  buildNotionAwareSystemPrompt,
  buildSystemPrompt,
} from "./draft-ai"
import type { NotionSnippet } from "./notion-retrieval"

const snippet = (over: Partial<NotionSnippet>): NotionSnippet => ({
  id: "id",
  title: "Title",
  url: "https://notion.so/x",
  text: "some text",
  source: "page",
  isInternalSource: false,
  timestamp: null,
  ...over,
})

const pageSnippet = snippet({
  title: "Payout Holds Guide",
  text: "Compliance holds are released once the RFI is satisfied.",
  source: "page",
  isInternalSource: false,
})

const driveSnippet = snippet({
  title: "Support SOP",
  text: "Raise compliance holds in #payout-issues; never resolve them yourself.",
  source: "google-drive",
  isInternalSource: true,
})

describe("buildNotionAwareSystemPrompt", () => {
  it("returns the base prompt unchanged when there are no snippets", () => {
    const base = buildSystemPrompt(undefined, [], "Vini", [])
    const out = buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [])
    expect(out).toBe(base)
  })

  it("puts page snippets under the citable 'Support knowledge' heading", () => {
    const out = buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])
    expect(out).toContain("Support knowledge")
    expect(out).toContain("Payout Holds Guide")
    expect(out).toContain("Compliance holds are released once the RFI is satisfied.")
  })

  it("puts connector snippets under a 'DO NOT quote' internal heading", () => {
    const out = buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [driveSnippet])
    expect(out).toContain("DO NOT quote or reveal to the customer")
    expect(out).toContain("google-drive")
    expect(out).toContain("Support SOP")
  })

  it("always appends the firewall rules when snippets are present", () => {
    const out = buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet, driveSnippet])
    expect(out).toContain("Firewall rules for the Notion knowledge above")
    expect(out).toContain("paraphrase")
    expect(out).toContain("never repeat them to the customer")
  })

  it("builds on top of the base prompt (keeps tone + constraints)", () => {
    const out = buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])
    expect(out).toContain("support copilot for Vini")
    expect(out.length).toBeGreaterThan(buildSystemPrompt(undefined, [], "Vini", []).length)
  })
})

describe("buildMacroAdaptSystemPrompt", () => {
  const macroText =
    "Hey! To enable payouts you need to complete KYC verification in your dashboard under Settings → Payouts."

  it("embeds the macro text under an 'Approved macro to adapt' heading", () => {
    const out = buildMacroAdaptSystemPrompt(macroText, "Vini")
    expect(out).toContain("## Approved macro to adapt")
    expect(out).toContain(macroText)
  })

  it("includes the agent name", () => {
    const out = buildMacroAdaptSystemPrompt(macroText, "Vini")
    expect(out).toContain("Vini")
  })

  it("instructs the model to adapt the macro to this case", () => {
    const out = buildMacroAdaptSystemPrompt(macroText, "Vini")
    expect(out.toLowerCase()).toContain("adapt")
  })

  it("instructs the model not to invent policy", () => {
    const out = buildMacroAdaptSystemPrompt(macroText, "Vini")
    expect(out.toLowerCase()).toContain("do not invent")
  })

  it("asks for the customer-facing message only", () => {
    const out = buildMacroAdaptSystemPrompt(macroText, "Vini")
    expect(out.toLowerCase()).toContain("output only the customer-facing message")
  })

  it("mandates a non-empty reply (guards the empty-output bug)", () => {
    const out = buildMacroAdaptSystemPrompt(macroText, "Vini")
    expect(out.toLowerCase()).toContain("never return an empty message")
  })
})

describe("buildMacroAdaptUserMessage", () => {
  const convo = {
    customer: "Alex",
    firstMessage: "How do I turn on payouts?",
    messages: [
      { role: "customer", body: "How do I turn on payouts?" },
      { role: "admin", body: "Let me check that for you." },
      { role: "customer", body: "still stuck, can you help?" },
    ],
  }

  it("includes the conversation thread", () => {
    const out = buildMacroAdaptUserMessage(convo)
    expect(out).toContain("Conversation thread:")
    expect(out).toContain("How do I turn on payouts?")
    expect(out).toContain("still stuck, can you help?")
  })

  it("anchors the task on the macro from the system message", () => {
    const out = buildMacroAdaptUserMessage(convo)
    expect(out).toContain("approved macro from the system message")
    expect(out.toLowerCase()).toContain("always output a complete")
  })

  it("does NOT reuse the generic draft instruction (the bug that ignored the macro)", () => {
    const out = buildMacroAdaptUserMessage(convo)
    expect(out).not.toContain("Write the next message in this conversation")
  })
})
