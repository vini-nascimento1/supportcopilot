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
  REPLY_STYLE_NUDGE,
  ANTI_AI_SLOP_RULES,
  buildEvidenceSection,
  buildEvidenceSystemPrompt,
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

// A live draft reopened a refund decision it had already stated as final,
// because the customer's follow-up message (repeating the same demand) also
// happened to restate a date that was a day off due to timezone. The model
// treated that incidental detail as new information worth investigating,
// instead of recognizing the message as the same already-answered demand.
describe("closing the conversation — a restated demand is not new information", () => {
  it("tells the model an incidental detail in a repeated demand doesn't justify reopening a final decision", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    expect(out).toContain("A restated demand is not new information")
    expect(out).toContain("Only genuinely new, material evidence")
  })
})

// A fan asked, for the third time, a plain yes/no confirmation of what two
// agents had already told them ("so I just wait and the money comes back,
// right?"). The draft contradicted its own agent's in-thread answer, said the
// transactions "need to be checked" after all, and asked for the transaction
// date and last 4 card digits — pushing back instead of closing the loop.
describe("confirm, don't re-open — an already-answered question just gets agreed with", () => {
  const builders: Array<[string, string]> = [
    ["buildSystemPrompt", buildSystemPrompt(undefined, [], "Vini", [])],
    ["buildNotionAwareSystemPrompt", buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])],
    ["buildImproveSystemPrompt", buildImproveSystemPrompt("Vini")],
    ["buildMacroAdaptSystemPrompt", buildMacroAdaptSystemPrompt("Some approved macro text.", "Vini")],
  ]

  it.each(builders)("%s makes agree-and-close the default for an answered question", (_name, out) => {
    expect(out).toContain("The default for an already-answered question is to agree and close it")
    expect(out).toContain("A short reply that closes the loop is a COMPLETE reply")
  })

  it.each(builders)("%s makes a yes/no question get the direct answer first", (_name, out) => {
    expect(out).toContain("A yes/no question gets the answer first")
    expect(out).toContain("A confirmation of something already explained deserves one or two sentences")
  })

  it.each(builders)("%s forbids overturning an answer an agent already gave in the thread", (_name, out) => {
    expect(out).toContain("Never contradict, walk back, or cast doubt on an answer a Fanvue agent already gave")
    expect(out).toContain("A restated demand is not new information, and neither is a re-described one")
  })

  it.each(builders)("%s forbids inventing a check to justify a longer reply", (_name, out) => {
    expect(out).toContain("Do not invent a new check, question, or piece of missing information")
  })

  it("stops the draft asking for card digits once the thread already identifies the payment", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    expect(out).toContain("Only ask for those card digits when the transaction is genuinely unidentified")
    expect(out).toContain("banking app wording does not overrule what Fanvue's own records show")
  })

  it.each(builders)("%s states a precedence order so a shape rule can't manufacture substance", (_name, out) => {
    expect(out).toContain("When two rules in this prompt conflict")
    expect(out).toContain("Don't re-open what is already settled")
    expect(out).toContain("A formatting rule is never a reason to add OR remove substance")
  })

  it.each(builders)("%s names the target reply shape, not just the prohibitions", (_name, out) => {
    expect(out).toContain("What a good reply looks like")
    expect(out).toContain("Answer the actual question in the first sentence")
    expect(out).toContain("The target is a reply the customer can't argue with, not a short one")
    expect(out).toContain("What actually has to go is padding, not length")
  })

  // The call-to-action rule is what made a confirm-and-close draft bolt an
  // invented question onto the end — generation demanded a CTA while the
  // verifier was told to strip it, so the two layers fought each other.
  it("makes the call-to-action conditional in generation, not just in the verifier", () => {
    for (const out of [buildSystemPrompt(undefined, [], "Vini", []), buildMacroAdaptSystemPrompt("Macro.", "Vini")]) {
      expect(out).toContain("when the reply actually needs one")
      expect(out).not.toContain("- End with exactly one clear call-to-action.\n")
    }
  })

  // A blanket "if the playbook doesn't cover it, ask a clarifying question"
  // made asking the DEFAULT for every uncovered case — which is most tail
  // cases — and it sat in "Critical constraints", outranking the closing rules.
  it("makes the model read the thread before falling back to a clarifying question", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    expect(out).toContain("read the thread before asking anything")
    expect(out).toContain("Only when the answer genuinely is not available anywhere")
  })

  // The tone block's disclaimer says it "never overrides any rule above", which
  // is only true if nothing outranking it is printed below it.
  it("keeps the tone preference last so the closure rules still outrank it", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [], false, false, "Warm and human.")
    expect(out.indexOf("## Closing the conversation")).toBeLessThan(out.indexOf("## This agent's personal tone preference"))
  })

  it("makes the verifier strip a re-opened loop and unnecessary asks", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Use the KB only." },
      { role: "user", content: "AGENT: the payment never landed on our side. CUSTOMER: so I just wait, right?" },
    ]
    const out = buildDraftVerifierMessages(
      messages,
      "The transactions need to be checked. Please provide the transaction date and the last four digits of the card."
    )
    expect(out[0].content).toContain("Do not let the draft re-open a settled point")
    expect(out[0].content).toContain("Cut asks for information the reply does not need")
    expect(out[0].content).toContain("Never lengthen a short, correct confirming draft")
  })
})

// Retrieval v2: ranked cited evidence replaces the single-playbook injection.
// The defect being fixed is measured — playbook-matched drafts were approved
// 57.6% of the time vs 67.5% when nothing matched (n=1,201) — so "we found
// nothing" has to be a first-class, well-handled outcome, not a fallback.
describe("buildEvidenceSection", () => {
  const safe = {
    title: "Payout Already Submitted (Pending)",
    headingPath: "Payouts > Pending",
    sourceKind: "response",
    content: "Pending payouts settle within 5-7 business days.",
    visibility: "customer_safe" as const,
  }
  const internal = {
    title: "Red Flag Handbook",
    headingPath: "Fraud > Escalation",
    sourceKind: "playbook",
    content: "Escalate to #fraud-issues with the account handle.",
    visibility: "internal_only" as const,
  }

  it("tells the model to ask rather than guess when nothing was retrieved", () => {
    const out = buildEvidenceSection([])
    expect(out).toContain("Nothing in the knowledge base matched")
    expect(out).toContain("do NOT reach for a loosely-related policy")
    expect(out).toContain("ask ONE focused question")
  })

  it("numbers passages so claims can be tied to a specific citation", () => {
    const out = buildEvidenceSection([safe])
    expect(out).toContain("[1] Payout Already Submitted (Pending)")
    expect(out).toContain("Payouts > Pending")
  })

  it("puts customer-safe and internal passages in separate sections", () => {
    const out = buildEvidenceSection([safe, internal])
    expect(out).toContain("you MAY ground the customer-facing reply on these")
    expect(out).toContain("DO NOT quote or reveal to the customer")
  })

  it("never files internal content under the groundable heading", () => {
    const out = buildEvidenceSection([internal])
    const safeHeading = out.indexOf("you MAY ground")
    expect(safeHeading).toBe(-1)
    expect(out).toContain("DO NOT quote or reveal to the customer")
  })

  it("numbers internal passages continuing from the customer-safe ones", () => {
    const out = buildEvidenceSection([safe, internal])
    expect(out).toContain("[1] Payout Already Submitted (Pending)")
    expect(out).toContain("[2] Red Flag Handbook")
  })

  it("states that ranked evidence is not a guarantee of fit", () => {
    const out = buildEvidenceSection([safe])
    expect(out).toContain("ranked, not guaranteed")
    expect(out).toContain("ask a question instead of stretching the closest one")
  })

  it("forbids treating retrieved docs as proof this customer's account was checked", () => {
    const out = buildEvidenceSection([safe])
    expect(out).toContain("never proof that THIS customer's payout, KYC, profile, or media was checked")
  })
})

describe("buildEvidenceSystemPrompt", () => {
  const passages = [
    {
      title: "Chargebacks",
      headingPath: null,
      sourceKind: "macro",
      content: "Zero tolerance: a disputed charge bans the account.",
      visibility: "customer_safe" as const,
    },
  ]

  it("keeps every hard rule from the base prompt", () => {
    const out = buildEvidenceSystemPrompt(passages, "Vini", [])
    expect(out).toContain("Capability boundaries")
    expect(out).toContain("Never send a customer to a chargeback or bank dispute")
    expect(out).toContain("You ARE the agent handling this")
    expect(out).toContain("Policy integrity")
  })

  it("appends the evidence block", () => {
    const out = buildEvidenceSystemPrompt(passages, "Vini", [])
    expect(out).toContain("Retrieved knowledge (ranked by relevance")
    expect(out).toContain("[1] Chargebacks")
  })

  it("handles the abstain case without losing the rule stack", () => {
    const out = buildEvidenceSystemPrompt([], "Vini", [])
    expect(out).toContain("Nothing in the knowledge base matched")
    expect(out).toContain("Never send a customer to a chargeback or bank dispute")
  })
})

// A live draft told a fan to open an Apple Cash "Report an Issue" dispute over a
// pending charge. Under Fanvue's zero-tolerance chargeback policy that advice
// would have banned the fan's own account, so the rule is a hard part of every
// prompt rather than a playbook that may or may not match — these lock that in.
describe("chargeback / bank-dispute guardrail", () => {
  const builders: Array<[string, string]> = [
    ["buildSystemPrompt", buildSystemPrompt(undefined, [], "Vini", [])],
    ["buildNotionAwareSystemPrompt", buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])],
    ["buildImproveSystemPrompt", buildImproveSystemPrompt("Vini")],
    ["buildMacroAdaptSystemPrompt", buildMacroAdaptSystemPrompt("Some approved macro text.", "Vini")],
  ]

  it.each(builders)("%s forbids sending the customer to a bank dispute", (_name, out) => {
    expect(out).toContain("Never send a customer to a chargeback or bank dispute")
    expect(out).toContain("zero-tolerance chargeback policy")
    expect(out).toContain("Report an Issue")
  })

  it.each(builders)("%s explains a pending charge as an authorisation hold", (_name, out) => {
    expect(out).toContain("authorisation hold, not a completed payment")
  })

  it.each(builders)("%s asks for BIN + last 4 only, never full card details", (_name, out) => {
    expect(out).toContain("BIN (first 6 digits)")
    expect(out).toContain("Never ask for a full card number, expiry date, or CVV")
  })

  it("makes the verifier delete dispute advice as a last line of defence", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Use the KB only." },
      { role: "user", content: "Customer does not recognise a charge." },
    ]
    const out = buildDraftVerifierMessages(messages, "Please tap Report an Issue and report it as unauthorised.")
    expect(out[0].content).toContain("DELETE any advice to dispute a charge")
    expect(out[0].content).toContain("authorisation hold")
  })
})

// A $5.46 buyer's-remorse refund request got "I'll review your refund request
// and provide an update here once the review is complete" — a stall on an answer
// the playbook already settles as an outright no. Deferring also leaves the
// outcome looking open, which is one step away from the worse failure: listing
// the exemption grounds and coaching the customer into manufacturing a claim.
describe("refund posture — answer up front, never coach the exemptions", () => {
  const builders: Array<[string, string]> = [
    ["buildSystemPrompt", buildSystemPrompt(undefined, [], "Vini", [])],
    ["buildNotionAwareSystemPrompt", buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])],
    ["buildImproveSystemPrompt", buildImproveSystemPrompt("Vini")],
    ["buildMacroAdaptSystemPrompt", buildMacroAdaptSystemPrompt("Some approved macro text.", "Vini")],
  ]

  it.each(builders)("%s states the no-refund default as the answer itself", (_name, out) => {
    expect(out).toContain("Fanvue runs a no-refund policy, and that IS the answer")
  })

  it.each(builders)("%s forbids deferring a no-refund answer into a fake review", (_name, out) => {
    expect(out).toContain("Never defer a no-refund answer into a review that isn't happening")
  })

  it.each(builders)("%s forbids listing or inviting the exemption grounds", (_name, out) => {
    expect(out).toContain("Never list, hint at, or invite the exemption grounds")
  })

  it.each(builders)("%s still handles the cancellation half of the request", (_name, out) => {
    expect(out).toContain("Manage My Subscriptions")
  })

  it("keeps AGENT_IDENTITY_RULES from being read as a licence to defer", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    expect(out).toContain(`never use "I'll review this" as a way to avoid giving an answer you already have`)
  })

  it("makes the verifier cut both the stall and the coaching", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Use the KB only." },
      { role: "user", content: "Fan wants a refund, changed their mind." },
    ]
    const out = buildDraftVerifierMessages(
      messages,
      "I'll review your refund request and provide an update here once the review is complete."
    )
    expect(out[0].content).toContain("cut the stall and cut the coaching")
    expect(out[0].content).toContain("coaches them into manufacturing a claim")
  })
})

// The mandated greeting is prepended in code, then the model opened its own text
// with a bare "Hello," — two greetings stacked in one message. The old rule
// banned a "greeting, thanks line, or your own name", which the model evidently
// did not read as covering a one-word salutation.
describe("greeting is injected exactly once", () => {
  it("bans a second salutation when the greeting is code-injected", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [], false, true)
    expect(out).toContain("Do not write any opening greeting, salutation, thanks line, or your own name")
    expect(out).toContain("becomes a SECOND greeting")
    expect(out).toContain(`do not begin with "Hello"`)
  })

  it("still asks for a warm greeting when nothing is injected", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [], false, false)
    expect(out).toContain("Open with a warm greeting")
  })

  it("makes the verifier delete a doubled greeting", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Use the KB only." },
      { role: "user", content: "Fan wants a refund." },
    ]
    const out = buildDraftVerifierMessages(messages, "Hello,\n\nI have your transaction details on file.")
    expect(out[0].content).toContain("Delete a second greeting")
    expect(out[0].content).toContain("Only one greeting per message")
  })
})

// A live draft said "I'll ... request a review if needed" for a check the
// agent performs themselves in Fadmin — "request" implies handing it to a
// separate reviewing party, which isn't what happens. Same family as the
// AGENT_IDENTITY_RULES ban on "our team will review" / "escalate to a real
// agent": the agent IS the one doing the work, so say so directly.
describe("no vague 'request/submit a review' framing for self-performed checks", () => {
  const builders: Array<[string, string]> = [
    ["buildSystemPrompt", buildSystemPrompt(undefined, [], "Vini", [])],
    ["buildNotionAwareSystemPrompt", buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])],
    ["buildMacroAdaptSystemPrompt", buildMacroAdaptSystemPrompt("Some approved macro text.", "Vini")],
  ]

  it.each(builders)("%s tells the model to say it's doing the check, not requesting it", (_name, out) => {
    expect(out).toContain("don't describe it as \"requesting\" or \"submitting\" it to someone else")
    expect(out).toContain("I'll review this now")
  })
})

// gpt-5-family tic: ending a reply with "Reply 'cancel it' and I'll…", which
// reads as an automated keyword bot rather than the human agent it claims to be.
describe("no keyword-gated confirmations", () => {
  it("bans magic-word replies and asks for a plain go-ahead instead", () => {
    expect(REPLY_STYLE_NUDGE).toContain("Never gate an action behind a magic word")
    expect(REPLY_STYLE_NUDGE).toContain("Type CONFIRM")
    expect(REPLY_STYLE_NUDGE).toContain("Just confirm you'd like me to go ahead")
  })
})

describe("buildVerifierGroundingContext", () => {
  const playbook: PlaybookListItem = {
    id: "pb-1",
    caseType: "Payout delayed",
    source: "test",
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

  it("includes a timezone caveat so a customer-stated date one day off UTC isn't flagged as a discrepancy", () => {
    const result = buildUserMessage(multimodalConvo)
    expect(typeof result).toBe("string")
    const text = result as string
    expect(text).toContain("server UTC")
    expect(text).toContain("one calendar day ahead or behind")
    expect(text).toContain("don't ask the customer to confirm or clarify a date solely because it's a day off")
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

// A creator asked why the autonomous AI chatbot's controls were missing on a new
// account. The full answer existed internally — staged rollout, not the NSFW flag
// the help article names, and recreating the account would not grant it — but the
// draft listed what it could not verify, handed the case to "the technical/account
// team", and restated the customer's own three questions as what that team "would
// need to verify". CAPABILITY_BOUNDARY_RULES ("says the team will look into it")
// had out-literalled AGENT_IDENTITY_RULES' ban on third-person handoffs.
describe("no-access is never the answer", () => {
  const builders: Array<[string, string]> = [
    ["buildSystemPrompt", buildSystemPrompt(undefined, [], "Vini", [])],
    ["buildNotionAwareSystemPrompt", buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])],
    ["buildImproveSystemPrompt", buildImproveSystemPrompt("Vini")],
    ["buildMacroAdaptSystemPrompt", buildMacroAdaptSystemPrompt("Some approved macro text.", "Vini")],
  ]

  it.each(builders)("%s bans building the reply out of blind spots", (_name, out) => {
    expect(out).toContain("Your lack of access is never the content of the reply")
    expect(out).toContain("Answer with what you DO know")
  })

  it.each(builders)("%s bans mirroring the customer's questions back", (_name, out) => {
    expect(out).toContain("Never mirror the customer's own questions back as the reply")
  })

  it("no longer tells the model to say the team will look into it", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    expect(out).not.toContain("says the team will look into it")
  })

  it("ranks substance above the capability hedge in the precedence list", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    expect(out).toContain("Say what you know before you say what you can't reach")
    expect(out).toContain("never a licence to answer with your own limitations")
  })

  it("makes the verifier cut a blind-spot reply and a mirrored question list", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Use the KB only." },
      { role: "user", content: "Creator asks why AI chatbot settings are missing." },
    ]
    const out = buildDraftVerifierMessages(
      messages,
      "I'm unable to verify account classifications, eligibility flags or rollout restrictions from this side, so this will need a technical/account-team check."
    )
    expect(out[0].content).toContain("Cut a reply that is built out of what the agent cannot verify")
    expect(out[0].content).toContain("Delete a restatement of the customer's own questions")
  })
})

// Vincenzo, 2026-08-30: he will not promise a customer he'll go look internally
// when there is no path to look through. Support cannot enable the AI chatbot at
// all — that request goes creator -> sales rep -> product — so "I'll put this
// forward internally" was a commitment the agent could not keep. The real
// escalation paths (payments, fraud, moderation) must keep working.
describe("no unbacked promise of internal action", () => {
  const builders: Array<[string, string]> = [
    ["buildSystemPrompt", buildSystemPrompt(undefined, [], "Vini", [])],
    ["buildNotionAwareSystemPrompt", buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])],
    ["buildImproveSystemPrompt", buildImproveSystemPrompt("Vini")],
    ["buildMacroAdaptSystemPrompt", buildMacroAdaptSystemPrompt("Some approved macro text.", "Vini")],
  ]

  it.each(builders)("%s requires a real named path before promising follow-up", (_name, out) => {
    expect(out).toContain("Never promise an internal action you have no path for")
    expect(out).toContain("Outside those, do not invent one")
  })

  it.each(builders)("%s bans promising a date, queue position or feature access", (_name, out) => {
    expect(out).toContain("Never promise or imply a date, a queue position, or an outcome")
    expect(out).toContain("never tell a customer a feature will be enabled for them")
  })

  it("keeps the genuine payments/fraud/moderation escalation framing intact", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    // The narrow fix must not break AGENT_IDENTITY_RULES' prescribed wording for
    // the escalations that really do happen.
    expect(out).toContain("I'll raise this with our payments team and follow up here")
    expect(out).toContain("Payments/payout escalations, fraud reviews and moderation referrals are real workflows")
  })

  it("makes the verifier delete an unbacked internal promise", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Use the KB only." },
      { role: "user", content: "Creator wants the AI chatbot enabled." },
    ]
    const out = buildDraftVerifierMessages(
      messages,
      "I'll put your account forward for chatbot access internally and update you here."
    )
    expect(out[0].content).toContain("Delete an unbacked promise of internal action")
  })
})

// Vincenzo, 2026-09-08: the word "fraud" and "the fraud team" kept leaking into
// customer-facing drafts (bans, chargebacks, unrecognised charges) even though
// the underlying handling was correct — a wording leak, not a policy gap.
describe("never says 'fraud' to the customer", () => {
  const builders: Array<[string, string]> = [
    ["buildSystemPrompt", buildSystemPrompt(undefined, [], "Vini", [])],
    ["buildNotionAwareSystemPrompt", buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])],
    ["buildImproveSystemPrompt", buildImproveSystemPrompt("Vini")],
  ]

  it.each(builders)("%s bans writing \"fraud\" or naming the fraud team", (_name, out) => {
    expect(out).toContain('Never write the word "fraud" or name "the fraud team" in the customer-facing message')
  })

  it("makes the verifier scrub a leaked mention of fraud", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Use the KB only." },
      { role: "user", content: "Why was my account banned?" },
    ]
    const out = buildDraftVerifierMessages(
      messages,
      "This was flagged by our fraud team and your account has been banned as a result."
    )
    expect(out[0].content).toContain('Scrub the word "fraud" and any mention of "the fraud team"')
  })
})

// Vincenzo, 2026-09-12 (Case Handling & Tone Refresher): drafts were arriving
// as a bare verdict — no acknowledgement in front of a refusal, facts stated
// with no consequence attached, and nothing at the end telling the customer
// whether the ball was with them or with us. The flagged payout refusal was
// reopened and reversed by the next agent.
describe("opening, middle and close — a reply has to have a shape", () => {
  const builders: Array<[string, string]> = [
    ["buildSystemPrompt", buildSystemPrompt(undefined, [], "Vini", [])],
    ["buildNotionAwareSystemPrompt", buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])],
    ["buildImproveSystemPrompt", buildImproveSystemPrompt("Vini")],
  ]

  it.each(builders)("%s carries the three-part reply arc", (_name, out) => {
    expect(out).toContain("## Every reply has an opening, a middle and a close")
    expect(out).toContain("one short sentence acknowledging where they stand comes FIRST")
    expect(out).toContain("Every fact you state carries its consequence with it")
    expect(out).toContain("never leave them wondering what happens now")
  })

  it.each(builders)("%s keeps the arc from inventing a next step", (_name, out) => {
    expect(out).toContain("shape never manufactures substance")
    expect(out).toContain("The arc decides how an answer is laid out, never what it contains")
  })

  it.each(builders)("%s still bans re-asking what the thread already answers", (_name, out) => {
    expect(out).toContain("Never re-ask what the customer already told you")
  })

  it("keeps the answer-first rule but carves out the acknowledgement line", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    expect(out).toContain("Answer the actual question in the first sentence")
    expect(out).toContain("bad news gets a single acknowledgement sentence in front of it")
  })

  it("makes the verifier repair a bare refusal instead of softening the outcome", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Payout blocked: content removed as stolen." },
      { role: "user", content: "Please approve my payout." },
    ]
    const out = buildDraftVerifierMessages(
      messages,
      "Your payout request can't be approved because the content removed from your account was identified as stolen, and no earnings were generated from it!"
    )
    expect(out[0].content).toContain("Never let bad news arrive bare")
    expect(out[0].content).toContain("strip any exclamation mark from the bad-news line")
    expect(out[0].content).toContain("never soften, hedge or change the outcome itself")
    expect(out[0].content).toContain("Give a stated fact its consequence")
    expect(out[0].content).toContain("Make the draft end on what happens now")
    expect(out[0].content).toContain("Never invent a step, a check, a review or a timeline just to have an ending")
  })
})

// Vincenzo, 2026-09-12: a fan billed for two subscriptions said "I was scammed
// by the site" and the queued draft asked for the card's BIN and last 4 digits
// so the charges could be verified — on two subscriptions the thread had
// already identified. The case was answerable on the first reply.
describe("subscription and free-trial billing — explain it, don't investigate it", () => {
  const builders: Array<[string, string]> = [
    ["buildSystemPrompt", buildSystemPrompt(undefined, [], "Vini", [])],
    ["buildNotionAwareSystemPrompt", buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])],
    ["buildImproveSystemPrompt", buildImproveSystemPrompt("Vini")],
  ]

  it.each(builders)("%s carries the free-trial conversion facts", (_name, out) => {
    expect(out).toContain("## How Fanvue subscriptions and free trials actually bill")
    expect(out).toContain("automatically becomes a paid one unless it is cancelled before the trial ends")
    expect(out).toContain("cancelling at least 24 hours before the renewal date")
    expect(out).toContain("the payment has gone through and is non-refundable")
  })

  it.each(builders)("%s explains what a subscription actually buys", (_name, out) => {
    expect(out).toContain(
      "it is not a guarantee of future posts, of a posting schedule, or of ongoing activity"
    )
    expect(out).toContain("posting rarely, or having less content than the fan hoped is not a refund ground")
  })

  it.each(builders)("%s gives the exact cancellation path and link", (_name, out) => {
    expect(out).toContain("Settings → Payments & Subscriptions → Manage My Subscriptions")
    expect(out).toContain("https://www.fanvue.com/settings/payments/subscriptions")
    expect(out).toContain("does not reverse a charge already taken")
  })

  it.each(builders)("%s stops an identified charge from opening a card lookup", (_name, out) => {
    expect(out).toContain('"Unidentified" means the charge itself is a mystery')
    expect(out).toContain("Asking that customer for BIN and last 4 is wrong twice over")
    expect(out).toContain("is the no-ground case, not the fraud case")
  })

  it.each(builders)("%s lets the first no-refund answer be a full explanation", (_name, out) => {
    expect(out).toContain("The first no-refund answer is the one that has to be complete")
    expect(out).toContain("answers the next three messages they were going to send")
  })

  it.each(builders)("%s still bans coaching the exemption grounds", (_name, out) => {
    expect(out).toContain("Never list, hint at, or invite the exemption grounds")
  })

  it("makes the verifier cut the card-digit ask on an identified subscription", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Fan has two active subscriptions; one converted from a free trial." },
      { role: "user", content: "No i was scammed by the site" },
    ]
    const out = buildDraftVerifierMessages(
      messages,
      "Could you share the first 6 and last 4 digits of your card so I can verify these transactions?"
    )
    expect(out[0].content).toContain("Cut a card-digit ask on a charge the source already identifies")
    expect(out[0].content).toContain("calling it a scam does not make it unidentified")
    expect(out[0].content).toContain("Do not shorten a first full billing or policy explanation into a bare verdict")
  })
})

// Adapted 2026-09-12 from the "anti-ai-slop-writing" skill
// (github.com/jalaalrd/anti-ai-slop-writing) so drafts stop reading as
// AI-written: banned corporate vocabulary and stock openers, sentence-length
// variety, no parataxis, and punctuation discipline (one em dash, one
// exclamation mark max).
describe("anti-AI-slop writing rules", () => {
  it("bans stock AI vocabulary and openers", () => {
    expect(ANTI_AI_SLOP_RULES).toContain("delve")
    expect(ANTI_AI_SLOP_RULES).toContain("seamless")
    expect(ANTI_AI_SLOP_RULES).toContain("I hope this email finds you well")
    expect(ANTI_AI_SLOP_RULES).toContain("Please don't hesitate to reach out")
  })

  it("requires sentence-length variety and bans parataxis", () => {
    expect(ANTI_AI_SLOP_RULES).toContain("Vary sentence length")
    expect(ANTI_AI_SLOP_RULES).toContain("No parataxis")
  })

  it("caps em dashes and exclamation marks", () => {
    expect(ANTI_AI_SLOP_RULES).toContain("At most one em dash and one exclamation mark")
  })

  it("is a wording-only rule, never a licence to drop substance", () => {
    expect(ANTI_AI_SLOP_RULES).toContain("never on WHAT it says")
  })

  it("is appended alongside REPLY_STYLE_NUDGE at every draft call site", () => {
    const chatRoute = require("fs").readFileSync(require("path").join(__dirname, "../app/api/ai/chat/route.ts"), "utf8")
    const draftRoute = require("fs").readFileSync(require("path").join(__dirname, "../app/api/draft/route.ts"), "utf8")
    const pipeline = require("fs").readFileSync(require("path").join(__dirname, "./reply-queue-pipeline.ts"), "utf8")
    for (const source of [chatRoute, draftRoute, pipeline]) {
      expect(source).toContain("ANTI_AI_SLOP_RULES")
    }
  })

  it("makes the verifier reword AI tells without changing the facts", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Payout enabled after KYC review." },
      { role: "user", content: "Is my payout fixed?" },
    ]
    const out = buildDraftVerifierMessages(
      messages,
      "I hope this email finds you well. Rest assured, we will seamlessly delve into this — moreover, please don't hesitate to reach out!"
    )
    expect(out[0].content).toContain("Reword the tells that flag a reply as AI-written")
    expect(out[0].content).toContain("wording only")
  })
})

// Vincenzo, 2026-09-12 (second pass): the prompt used to treat brevity itself
// as a virtue ("two or three sentences is a finished reply"), which cuts
// exactly the kind of thorough explanation that makes a customer stop
// pushing back. Length now tracks how much genuine explanation is needed;
// only padding — content that does no work — is still banned regardless of
// length.
describe("length tracks substance, not a target — a good explanation can run long", () => {
  const builders: Array<[string, string]> = [
    ["buildSystemPrompt", buildSystemPrompt(undefined, [], "Vini", [])],
    ["buildNotionAwareSystemPrompt", buildNotionAwareSystemPrompt(undefined, [], "Vini", [], [pageSnippet])],
    ["buildImproveSystemPrompt", buildImproveSystemPrompt("Vini")],
  ]

  it.each(builders)("%s says being unanswerable, not brief, is the goal", (_name, out) => {
    expect(out).toContain("The target is a reply the customer can't argue with, not a short one")
    expect(out).toContain("cutting it down to \"two or three sentences\" to look disciplined makes it WORSE")
  })

  it.each(builders)("%s still bans padding regardless of length", (_name, out) => {
    expect(out).toContain("What actually has to go is padding, not length")
    expect(out).not.toContain("A correct reply is often two or three sentences")
  })

  it("no longer states an arbitrary sentence-count target anywhere in the stack", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    expect(out).not.toContain("two or three sentences. That is a finished reply")
  })

  it("scopes the closure rule's brevity to an already-answered confirmation, not answers in general", () => {
    const out = buildSystemPrompt(undefined, [], "Vini", [])
    expect(out).toContain("A confirmation of something already explained deserves one or two sentences")
    expect(out).toContain("It does NOT mean answers in general should be kept short")
  })

  it("makes the verifier stop trimming a long draft just for being long", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "Fan asked why a subscription renewed after a free trial." },
      { role: "user", content: "Why was I charged?" },
    ]
    const out = buildDraftVerifierMessages(messages, "A full, thorough explanation of the billing mechanism.")
    expect(out[0].content).toContain("Never trim a draft just because it's long")
    expect(out[0].content).toContain("Shortening a real explanation to look tighter makes the draft worse")
  })
})
