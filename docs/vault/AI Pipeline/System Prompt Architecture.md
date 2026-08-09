---
title: System Prompt Architecture
tags: [ai, prompting, drafting]
updated: 2026-07-29
---

# System Prompt Architecture

The draft-generation system prompt (built by `buildSystemPrompt()` in `lib/draft-ai.ts`, see [[Draft Verify Pipeline]]) is not one block of text — it's a stack of layers, each added for a specific failure mode observed in earlier drafts. Reading it top to bottom is reading a list of things the model used to get wrong. This doc explains *why* each layer exists, not just what it says.

The layers are assembled in a fixed order, and the order matters: later layers (like tone) are explicitly forbidden from overriding earlier ones (like policy integrity).

## 1. Agent Identity Rules

`AGENT_IDENTITY_RULES` — "you ARE the agent, not a bot." The model is told plainly that it is the human support agent working this conversation, never an intermediary handing off to "a real agent" or "our team."

**Why it exists:** early drafts read like a bot triaging a ticket — "our team will review this," "I'll escalate to a real agent," "please email support@fanvue.com." Both phrasings are actively harmful here: the agent sending the reply *is* the team, so "I'll escalate to a real agent" is simply false; and an email to support@fanvue.com just creates a new ticket that lands back in the same queue — a dead-end loop for the customer. The rule forces the model to frame internal follow-up as something *this* agent does and reports back on ("I'll raise this with our payments team and update you here"), never as sending the customer elsewhere. One narrow exception is carved out: a playbook can name a specific non-support-queue intake (e.g. a dedicated DMCA address for co-author/model-release documents) — that's a legitimate destination, not the general queue loop the rule bans.

## 2. Capability Boundary Rules

The model is told it only knows what's actually in front of it: the conversation thread, playbook, KB articles, Notion retrieval, and any attached images. It has no live access to Fadmin, KYC systems, payout processors, media review tools, or any other admin system — those are human-only, agent-verified actions.

**Why it exists:** without this boundary, a model asked "did you check my payout status" will happily produce a confident-sounding "I've checked your account and..." even though it never touched any system — because that's the statistically likely completion of a support-reply pattern, not because it's true. The rule bans a specific list of unsupported phrases ("I've checked your account," "I've reviewed your profile," "we've confirmed this on our side") and requires the draft to either ask for the missing detail or say the team will look into it, without pretending the check already happened. This is also exactly the class of error the [[Draft Verify Pipeline]]'s verifier pass exists to catch as a second line of defense — the boundary rule is the first line, upstream in the same prompt.

## 3. Policy Integrity Rules

The model must never invent a policy exception or carve-out that isn't explicitly stated in a playbook or KB article, and must hold a playbook's stated eligibility requirements even when a customer pushes back, claims urgency, or says "this was handled differently for me before."

**Why it exists:** a customer's claim about how their case was "handled before" or what a prior agent supposedly said is not verified fact from the model's point of view — it's just text in the thread. Left unchecked, a model under conversational pressure will rationalize an exception ("since this was already approved for you, I'll go ahead and...") rather than push back. The rule requires escalating to a human check instead of the model silently granting anything itself.

## 3b. Payment Dispute Rules (added 2026-08-09)

`PAYMENT_DISPUTE_RULES` — the model may never tell a customer to dispute, reverse, cancel, or "report as unauthorised" a Fanvue charge with their bank, card issuer, or wallet (Apple Pay / Apple Cash, Google Pay, PayPal), and may never point them at a "Report an Issue" / "Report a Problem" flow. It also fixes the two adjacent facts the model kept getting wrong: an unrecognised charge is looked up **internally** by the agent (BIN + last 4 only, never a full card number, expiry, or CVV), and a **pending** charge is an authorisation hold where no money has actually moved.

**Why it exists:** a live draft told a fan to open an Apple Cash dispute over a charge that was merely pending. That is harmful advice twice over. Fanvue runs a **zero-tolerance chargeback policy** — a disputed charge bans the fan's own account (ban reasons `SYS_CB911` / `CBK` / `SYS_CBK`, answered with the "Banned for chargebacks" macro) — so the reply would have got the customer banned for following it. And a pending transaction is an authorisation hold the bank releases by itself within a few days, so there was nothing to dispute in the first place.

It lives in the prompt rather than only in a playbook because a playbook only helps when the gate matches it. This must hold on every draft, including the tail cases with no playbook match.

Sources: Notion **Refunds** → Fraudulent Transactions (`ae2883310ab64d219e84cc193ebc1c3b`) and **Payments & Payout Training** → General Payment Queries (`33e0f38712768096a361e41e7d898a31`). The agent-facing side of the same policy lives in the *Chargebacks from the fan's perspective* playbook (`c48fed99-…`), updated the same day.

The [[Draft Verify Pipeline]] verifier carries the rule too, as a second gate: it is instructed to **delete** dispute advice outright and to correct a draft that treats a pending charge as money taken. Locked in by `lib/draft-ai.test.ts` ("chargeback / bank-dispute guardrail"), which asserts the rule reaches all four builders plus the verifier.

## 4. Privacy Rules

The model is told never to use the customer's real name in the reply. The customer's email address is withheld from the model's input entirely — but the model is separately told *whether* an email is on file, so it doesn't ask the customer to provide one redundantly.

**Why it exists:** this is a minimization move — the model doesn't need the actual email value to write a correct reply, so it never sees it, reducing what could leak in a hallucinated or copy-pasted-back completion. Telling the model only the boolean ("we do/don't have an email on file") preserves the one piece of that information that's actually useful for phrasing, without exposing the value itself.

## 5. English-Only Lock

Stated twice — once in the system prompt, and again as a footer appended to the user message itself.

**Why it exists:** multilingual customer pressure is strong (a customer writing in Portuguese, Spanish, etc. pulls the model toward replying in kind), and a single mention of "always respond in English" tends to get diluted or dropped over a long context window. Repeating it right next to the actual thread content, as the last thing before generation, closes that gap.

## 6. Today's date

The current date is injected explicitly into the prompt rather than left for the model to infer.

**Why it exists:** the model's training data has its own implicit sense of "now," which is wrong by construction for a live support case. Payout and eligibility windows depend on real elapsed time — e.g. "paid July 12, it's now July 29, that's 17 days, still within the 28-day window" — and a model guessing at today's date from training-era assumptions will get that arithmetic wrong. Explicitly stating today's date turns this into simple subtraction instead of a guess.

## 7. Tone Preference (optional, last)

An agent's personal voice setting — Professional, Warm, Human, or a free-text Custom tone, configured in [[Settings and Profile]] — is injected as its own section, deliberately placed **after** every rule above it.

**Why it's last, and why that's explicit in the prompt text:** tone changes *how* something is said, never *what* is allowed to be said. The section is worded to say exactly that — it "shapes voice, phrasing, formality" but "never overrides any rule above: still no invented promises or fake account checks, still verify identity before sensitive actions, still follow the playbook/policy exactly." Putting it last is what makes that framing readable as a constraint on tone rather than the other way around: nothing after it could dilute the rules, because nothing comes after it.

## Tone presets: `lib/tone-presets.ts`

Presets are defined in `TONE_PRESETS`, each with an `id` (`"professional" | "warm" | "human"`), a label, description, and instruction text. All three presets rewrite the *same* sample customer line (`TONE_SAMPLE_MESSAGE`, a "why is my payout still pending" complaint) so an agent picking between them in Settings is comparing a real side-by-side, not abstract labels. A fourth option, `"custom"`, lets an agent write their own free-text tone description (capped at `MAX_CUSTOM_TONE_CHARS = 500`), resolved at generation time by `toneInstructionFor(presetId, customText)`.

The chosen preset (or custom text) is stored per-agent in `agents.tone_preset` and `agents.tone_custom` (see [[Database Schema Reference]]), and resolved into instruction text at draft time before being appended as layer 7 above.

One preset-specific wrinkle: `presetStripsEmDashes()` returns `true` for the `"human"` preset, and `stripEmDashes()` is applied as a deterministic post-processing pass on its output. This exists because some downstream models render em-dashes oddly or overuse them in a way that reads as stilted rather than human — so for that one preset, the fix is applied mechanically after generation rather than relying on the model to self-censor its own punctuation.

## Two other prompt variants, briefly

Not every drafting path uses the full stack above:

- **`buildNotionAwareSystemPrompt()`** (tail cases with no playbook match) keeps the identity/capability/policy/privacy/language/date layers but grounds the reply only in customer-safe Notion hits instead of a playbook.
- **`buildImproveSystemPrompt()`** (the "Improve Draft" path) is intentionally much lighter — no playbook injection, no greeting rules — because it's editing text a human already produced or approved, not deriving a reply from scratch. See [[Draft Verify Pipeline]] for where each variant is used.

## Key files

- `lib/draft-ai.ts` — `buildSystemPrompt()`, `AGENT_IDENTITY_RULES`, capability/policy/payment-dispute/privacy rule constants, `REPLY_STYLE_NUDGE`, `toneInstructionSection()`, `buildNotionAwareSystemPrompt()`, `buildImproveSystemPrompt()`, `buildUserMessage()`
- `lib/draft-ai.test.ts` — "chargeback / bank-dispute guardrail" and "no keyword-gated confirmations" assert the rules survive prompt refactors
- `lib/tone-presets.ts` — `TONE_PRESETS`, `TonePresetId`, `toneInstructionFor()`, `presetStripsEmDashes()`, `stripEmDashes()`, `MAX_CUSTOM_TONE_CHARS`

## Data flow

```
buildSystemPrompt(playbook, examples, agentName, articles, hasAgentReplied, greetingInjected, toneInstruction)
        │
        ├─ 1. AGENT_IDENTITY_RULES        (you ARE the agent)
        ├─ 2. CAPABILITY_BOUNDARY_RULES   (no fake account checks)
        ├─ 3. POLICY_INTEGRITY_RULES      (no invented exceptions)
        ├─ 3b. PAYMENT_DISPUTE_RULES      (never send them to a chargeback)
        ├─ 4. Privacy rule                (no real name; email presence only, not value)
        ├─ 5. English-only instruction    (repeated again on the user message footer)
        ├─ 6. Today's date                (explicit, for elapsed-time math)
        └─ 7. toneInstructionSection(toneInstruction)   ← optional, always LAST
                 "shapes voice only — never overrides any rule above"
        │
        ▼
Final system prompt  ──▶  streamChatCompletion()  ──▶  draft
```

See also: [[Draft Verify Pipeline]], [[Settings and Profile]], [[Canvas Workflow]], [[Database Schema Reference]].
