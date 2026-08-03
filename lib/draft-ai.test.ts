import { describe, it, expect } from "vitest"

import {
  buildAgentGreeting,
  buildImproveSystemPrompt,
  buildImproveUserMessage,
  buildMacroAdaptSystemPrompt,
  buildMacroAdaptUserMessage,
  buildDraftVerifierMessages,
  buildVerifierGroundingContext,
  buildNotionAwareSystemPrompt,
  buildSlackTranslationPrompt,
  buildSystemPrompt,
  buildUserMessage,
  buildVisionEvidenceMessages,
  getTextDraftModel,
  getAuxDraftModel,
  getDefaultReasoningEffort,
} from "./draft-ai"
import type { OpenAIMessage } from "./draft-ai"
import type { NotionSnippet } from "./notion-retrieval"
import type { PlaybookListItem } from "./playbooks"
import type { IntercomArticle } from "./intercom"

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
    expect(out).toContain("Notion snippets are knowledge/search context, not live account data")
  })

  it("moves expired transient Notion pages out of customer-facing support knowledge", () => {
    const expiredOutage = snippet({
      title: "Chats outage incident",
      text: "Our system is in outage and chats are temporarily unavailable.",
      source: "page",
      isInternalSource: false,
      timestamp: "2025-10-23",
    })
    const out = buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [expiredOutage])
    expect(out).toContain("Expired or unverified transient context")
    expect(out).not.toContain("Support knowledge — you MAY ground your reply")
    expect(out).toContain("Never tell a customer that Fanvue is currently in an outage")
  })

  it("builds on top of the base prompt (keeps tone + constraints)", () => {
    const out = buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])
    expect(out).toContain("support copilot for Vini")
    expect(out.length).toBeGreaterThan(buildSystemPrompt(undefined, [], "Vini", []).length)
  })
})

describe("grounding and capability boundaries", () => {
  it("tells draft models not to pretend they checked live account systems", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    expect(out).toContain("Capability boundaries")
    expect(out).toContain("You do NOT have live access to Fadmin")
    expect(out).toContain("Never claim or imply that you checked")
  })

  it("allows Slack drafts to use reviewed-account language when the thread supports it", () => {
    const out = buildSlackTranslationPrompt("support", [
      { userName: "Agent", text: "I checked Fadmin and confirmed the account is active.", ts: "1" },
    ])
    expect(out).toContain("use first-person customer-facing wording such as \"I've reviewed your account\"")
    expect(out).not.toContain("Instead use: \"following a review,\"")
  })

  it("builds a verifier prompt that removes unsupported account-check claims", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Use the KB only." },
      { role: "user", content: "Customer says payouts are missing." },
    ]
    const out = buildDraftVerifierMessages(messages, "I've checked your account and confirmed your payout is blocked.")
    expect(out[0].content).toContain("strict grounding verifier")
    expect(out[0].content).toContain("Remove or soften any claim")
    expect(out[1].content).toContain("I've checked your account")
  })
})

describe("buildVerifierGroundingContext", () => {
  const playbook: PlaybookListItem = {
    id: "pb-1",
    caseType: "Payout delayed",
    source: "test",
    status: "reviewed",
    aliases: [],
    lastValidated: null,
    recognize: "Creator asks why payout is delayed",
    checks: "Check Fadmin.",
    resolution: "Explain the standard pending window.",
    dosDonts: "Don't promise a specific date.",
    requiresManualAction: false,
  }
  const article: IntercomArticle = {
    id: "art-1",
    title: "How payouts work",
    description: "Overview",
    bodySnippet: "Payouts settle after 7 days.",
  }

  it("includes the playbook resolution and dos/donts, and KB articles", () => {
    const out = buildVerifierGroundingContext(playbook, [article])
    expect(out).toContain("Payout delayed")
    expect(out).toContain("Explain the standard pending window.")
    expect(out).toContain("Don't promise a specific date.")
    expect(out).toContain("How payouts work")
    expect(out).toContain("Payouts settle after 7 days.")
  })

  it("includes only customer-safe Notion snippets, not internal-only ones", () => {
    const safe = snippet({ title: "Public KB", text: "Safe fact", isInternalSource: false })
    const internal = snippet({ title: "Internal note", text: "Secret internal detail", isInternalSource: true })
    const out = buildVerifierGroundingContext(undefined, [], [safe, internal])
    expect(out).toContain("Safe fact")
    expect(out).not.toContain("Secret internal detail")
  })

  it("omits the instructional/behavioral rules that the generation prompt needs", () => {
    const out = buildVerifierGroundingContext(playbook, [article])
    // These are the big instructional blocks unique to the generation system
    // prompt — the whole point of this function is to leave them out.
    expect(out).not.toContain("AGENT_IDENTITY_RULES")
    expect(out).not.toContain("You ARE the agent handling this")
    expect(out).not.toContain("Tone rules")
    expect(out).not.toContain("Capability boundaries")
  })

  it("returns an empty string when there is nothing to ground on", () => {
    expect(buildVerifierGroundingContext(undefined, [])).toBe("")
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

// Minimal conversation fixture shared across the multimodal-draft tests below.
const multimodalConvo = {
  customer: "Jane",
  firstMessage: "hi",
  messages: [{ role: "customer", body: "help" }],
}

describe("model configuration", () => {
  // There is no text-vs-vision routing any more: the default model is
  // multimodal, so one model serves string turns and image_url turns alike.
  it("defaults both the text and aux models to Luna", () => {
    expect(getTextDraftModel()).toBe("gpt-5.6-luna")
    expect(getAuxDraftModel()).toBe("gpt-5.6-luna")
  })

  it("honours env overrides for each model independently", () => {
    const prevText = process.env.OPENAI_TEXT_MODEL
    const prevAux = process.env.OPENAI_AUX_MODEL
    process.env.OPENAI_TEXT_MODEL = "gpt-5.6-terra"
    process.env.OPENAI_AUX_MODEL = "gpt-5.4-nano"
    try {
      expect(getTextDraftModel()).toBe("gpt-5.6-terra")
      expect(getAuxDraftModel()).toBe("gpt-5.4-nano")
    } finally {
      if (prevText === undefined) delete process.env.OPENAI_TEXT_MODEL
      else process.env.OPENAI_TEXT_MODEL = prevText
      if (prevAux === undefined) delete process.env.OPENAI_AUX_MODEL
      else process.env.OPENAI_AUX_MODEL = prevAux
    }
  })

  // gpt-5.x rejects `temperature`; reasoning effort is the knob that replaced it,
  // and it must stay low by default so drafts don't spend the token budget
  // thinking before any reply text is emitted.
  it("defaults reasoning effort to low", () => {
    expect(getDefaultReasoningEffort()).toBe("low")
  })
})

describe("buildUserMessage", () => {
  const ATTACHED_NOTICE = "The customer attached"
  const LATEST_CUSTOMER_INSTRUCTION = "The latest Customer message above"

  it("with no images arg returns a string with thread + final instruction and no attached notice", () => {
    const result = buildUserMessage(multimodalConvo)
    expect(typeof result).toBe("string")
    const text = result as string
    expect(text).toContain("Customer:")
    expect(text).toContain(LATEST_CUSTOMER_INSTRUCTION)
    expect(text).not.toContain(ATTACHED_NOTICE)
  })

  it("labels AI helper messages separately from customer messages", () => {
    const result = buildUserMessage({
      customer: "Jane",
      firstMessage: "I need help",
      messages: [
        { role: "customer", body: "I need help" },
        { role: "ai", body: "Fin suggested this answer." },
        { role: "admin", body: "Let me check." },
      ],
    })
    expect(typeof result).toBe("string")
    const text = result as string
    expect(text).toContain("Customer: I need help")
    expect(text).toContain("AI helper: Fin suggested this answer.")
    expect(text).toContain("Agent: Let me check.")
    expect(text).not.toContain("Customer: Fin suggested this answer.")
    expect(text).toContain("do not treat them as customer requests")
  })

  it("with an empty images array returns the identical string as the no-arg case", () => {
    const withArg = buildUserMessage(multimodalConvo, [])
    const withoutArg = buildUserMessage(multimodalConvo)
    expect(typeof withArg).toBe("string")
    expect(withArg).toBe(withoutArg)
  })

  it("with images returns an array: text part first, then ordered image_url parts", () => {
    const images = [
      { name: "a.png", dataUri: "data:image/png;base64,AAA" },
      { name: "b.png", dataUri: "data:image/png;base64,BBB" },
    ]
    const result = buildUserMessage(multimodalConvo, images)
    expect(Array.isArray(result)).toBe(true)
    const parts = result as Exclude<ReturnType<typeof buildUserMessage>, string>

    expect(parts).toHaveLength(3)

    expect(parts[0].type).toBe("text")
    const textPart = parts[0] as { type: "text"; text: string }
    expect(textPart.text).toContain("The customer attached 2 image(s)")

    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAA" },
    })
    expect(parts[2]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,BBB" },
    })
  })

  it("with image evidence returns text-only context for the final draft model", () => {
    const result = buildUserMessage(multimodalConvo, [], "- The screenshot shows an expired ID error.")
    expect(typeof result).toBe("string")
    const text = result as string
    expect(text).toContain("Customer image evidence")
    expect(text).toContain("expired ID error")

    // The extracted evidence replaces the images entirely, so the draft turn
    // carries no image_url part — the point of the two-step flow.
    const messages: OpenAIMessage[] = [
      { role: "system", content: "you are a copilot" },
      { role: "user", content: result },
    ]
    expect(messages.every((m) => typeof m.content === "string")).toBe(true)
  })
})

describe("buildVisionEvidenceMessages", () => {
  it("builds a vision-only evidence extraction turn for image analysis", () => {
    const messages = buildVisionEvidenceMessages(multimodalConvo, [
      { name: "screen.png", dataUri: "data:image/png;base64,AAA" },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[1].role).toBe("user")
    expect(Array.isArray(messages[1].content)).toBe(true)
    // The image rides along as an image_url part; the model reading it is the
    // aux model, passed explicitly by buildGroundedDraftUserMessage.
    const parts = messages[1].content as { type: string }[]
    expect(parts.some((p) => p.type === "image_url")).toBe(true)
  })
})

describe("buildImproveSystemPrompt", () => {
  it("instructs to improve an existing draft and keep English + policy", () => {
    const out = buildImproveSystemPrompt("Vini").toLowerCase()
    expect(out).toContain("improve")
    expect(out).toContain("english only")
    expect(out).toContain("do not")
    expect(out).toContain("only the")
  })
})

describe("buildImproveUserMessage", () => {
  const convo = { customer: "Jane", firstMessage: "payout failed", messages: [{ role: "customer", body: "still stuck" }] }
  it("embeds the current draft and the thread", () => {
    const out = buildImproveUserMessage(convo, "hey we cant change payout now")
    expect(out).toContain("hey we cant change payout now")
    expect(out).toContain("Current draft to improve")
    expect(out).toContain("still stuck")
  })
})

describe("buildAgentGreeting", () => {
  it("embeds the agent's name in the mandated opening line", () => {
    expect(buildAgentGreeting("Vincenzo")).toBe(
      "Hey! 👋 Thanks for reaching out to Fanvue Support, I'm Vincenzo. I'll do my best to assist you today! 😊"
    )
  })

  it("drops the 'I'm X' clause when there is no real agent name", () => {
    const generic = "Hey! 👋 Thanks for reaching out to Fanvue Support. I'll do my best to assist you today! 😊"
    expect(buildAgentGreeting("the support team")).toBe(generic)
    expect(buildAgentGreeting("")).toBe(generic)
  })
})
