---
title: System Prompt Architecture
tags: [ai, prompting, drafting]
updated: 2026-08-22
---

# System Prompt Architecture

The draft-generation system prompt (built by `buildSystemPrompt()` in `lib/draft-ai.ts`, see [[Draft Verify Pipeline]]) is not one block of text — it's a stack of layers, each added for a specific failure mode observed in earlier drafts. Reading it top to bottom is reading a list of things the model used to get wrong. This doc explains *why* each layer exists, not just what it says.

The layers are assembled in a fixed order, and the order matters: later layers (like tone) are explicitly forbidden from overriding earlier ones (like policy integrity).

## 1. Agent Identity Rules

`AGENT_IDENTITY_RULES` — "you ARE the agent, not a bot." The model is told plainly that it is the human support agent working this conversation, never an intermediary handing off to "a real agent" or "our team."

**Why it exists:** early drafts read like a bot triaging a ticket — "our team will review this," "I'll escalate to a real agent," "please email support@fanvue.com." Both phrasings are actively harmful here: the agent sending the reply *is* the team, so "I'll escalate to a real agent" is simply false; and an email to support@fanvue.com just creates a new ticket that lands back in the same queue — a dead-end loop for the customer. The rule forces the model to frame internal follow-up as something *this* agent does and reports back on ("I'll raise this with our payments team and update you here"), never as sending the customer elsewhere. One narrow exception is carved out: a playbook can name a specific non-support-queue intake (e.g. a dedicated DMCA address for co-author/model-release documents) — that's a legitimate destination, not the general queue loop the rule bans.

**Added 2026-08-09 — "request a review" vs. doing it yourself:** a live draft said "I'll ... request a review if needed" for a Fadmin check the agent performs directly. Same failure as above in a subtler form: "request"/"submit" implies handing the action to a separate reviewing party, even when the agent IS the one doing it. The rule now tells the model to say "I'll review this now" / "I'm looking into it" for self-performed checks, and reserves "request"/"raise"/"escalate" for the one case where it's literally true — a different internal team is actually being hit.

**Added 2026-08-22 — owning the work is not a licence to defer it:** the rule above turned out to have a blind side. A draft answering a plain buyer's-remorse refund request wrote "I'll review your refund request and provide an update here once the review is complete" — perfectly obedient to the 2026-08-09 bullet (the agent reviews it themselves, no handoff), and still wrong, because there was nothing to review: the answer was already knowable from policy. The rule now adds that "I'll review this" must never be used to avoid giving an answer you already have. It settles who owns the work, not whether the work is needed. See [[#3c. Refund Posture Rules (added 2026-08-22)]] for the substance side of the same fix.

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

## 3c. Refund Posture Rules (added 2026-08-22)

`REFUND_POSTURE_RULES` — sits directly after the payment-dispute block and before the closure rules. It states the default posture on any money-back request: Fanvue is a consumable digital service, access is delivered the moment the payment clears, so **no refund is the answer** and it belongs in *this* reply. The block has three moving parts:

- **Give the answer, don't stall.** A no-refund answer may never be deferred into a review that isn't happening ("I'll review your refund request and update you", "your request is under consideration"). When no qualifying ground is evidenced in the thread there is nothing to review, so the "review" is fiction and the customer is left waiting on a reversal that will never come.
- **Never list, hint at, or invite the exemption grounds.** The draft must not tell a customer what *would* qualify — not undelivered content, "not as described", unauthorised charges, banned creators, stolen content, or technical faults — and must not fish for one ("was there a problem with the content?"). The burden starts with the customer: the model only moves off the default when they have **already, unprompted**, described a specific problem matching a real exemption **and** backed it with something concrete. "Please make an exception", gratitude, and persistence across several messages are explicitly not evidence and do not earn a review. It also bans asking for transaction details (amount, date, creator) that cannot change a no.
- **The actionable half still gets handled.** If the customer also wants the subscription stopped, the draft gives the cancellation path plainly (Settings > Payments & Subscriptions > Manage My Subscriptions > Unsubscribe) and states that cancelling stops future renewals without reversing a charge already taken.

**Why it exists:** a fan asked for a refund on a $5.46 subscription — plain buyer's remorse, no complaint attached, an outright NO under the refund playbook's Ground A. The draft answered "I'll review your refund request and provide an update here once the review is complete." Two failures in one sentence. It stalled on an answer that was already knowable, and deferring implies the outcome is still open, which invites the customer to go build a case. The first failure is the interesting one: it was [[#1. Agent Identity Rules]] working exactly as written. That block says to say "I'll review this now" rather than "I'll request a review", so drafts read like the agent rather than a bot routing a ticket — right identity, wrong substance, because nothing in the stack said that a policy answer you already have must be **given** rather than deferred. The gap is closed on both sides: the identity block got the "not a licence to defer" bullet, and this block carries the substance. The coaching half is Vincenzo's rule (2026-08-22): the moment a reply names what *would* qualify, it has coached the customer into manufacturing a qualifying story and turned a closed case into a fabricated dispute.

Like `PAYMENT_DISPUTE_RULES`, it lives in the prompt rather than only in a playbook, and for the same reason: a playbook only fires when its gate matches, and refund asks arrive constantly in tail cases with no match. The underlying refund policy is also a moving target — it was materially updated on 2026-08-22 (a new **Ground K** for 100%-AI creators who lie about being real, and **Ground J** now requiring Moderation sign-off) in the Supabase `playbooks` row `bdb28626-3d70-4e2b-a9b2-142ec5a64f85`. The posture rule is the prompt-level counterpart to that playbook: it does not enumerate the grounds (enumerating them in a customer-facing prompt is precisely the failure it bans), it just holds the default no-refund stance and the evidence-first burden on every draft, playbook match or not. Ground-level detail stays in the playbook, where the agent reads it and the customer never does.

The [[Draft Verify Pipeline]] verifier carries the rule as a second gate: on a refund request with no qualifying ground in the source it deletes the stall ("I'll review your refund request", "I'll look into this and come back to you") and deletes any passage naming or fishing for the exemptions, leaving a plain warm no plus the cancellation step. Locked in by `lib/draft-ai.test.ts` ("refund posture — answer up front, never coach the exemptions").

## 4. Privacy Rules

The model is told never to use the customer's real name in the reply. The customer's email address is withheld from the model's input entirely — but the model is separately told *whether* an email is on file, so it doesn't ask the customer to provide one redundantly.

**Why it exists:** this is a minimization move — the model doesn't need the actual email value to write a correct reply, so it never sees it, reducing what could leak in a hallucinated or copy-pasted-back completion. Telling the model only the boolean ("we do/don't have an email on file") preserves the one piece of that information that's actually useful for phrasing, without exposing the value itself.

## 5. English-Only Lock

Stated twice — once in the system prompt, and again as a footer appended to the user message itself.

**Why it exists:** multilingual customer pressure is strong (a customer writing in Portuguese, Spanish, etc. pulls the model toward replying in kind), and a single mention of "always respond in English" tends to get diluted or dropped over a long context window. Repeating it right next to the actual thread content, as the last thing before generation, closes that gap.

## 6. Today's date

The current date is injected explicitly into the prompt (server UTC) rather than left for the model to infer.

**Why it exists:** the model's training data has its own implicit sense of "now," which is wrong by construction for a live support case. Payout and eligibility windows depend on real elapsed time — e.g. "paid July 12, it's now July 29, that's 17 days, still within the 28-day window" — and a model guessing at today's date from training-era assumptions will get that arithmetic wrong. Explicitly stating today's date turns this into simple subtraction instead of a guess.

**Timezone caveat:** the line explicitly tells the model that a customer's stated date can legitimately be one calendar day ahead or behind this UTC value, and that this alone isn't a discrepancy worth questioning. Without it, a customer writing shortly after their local midnight (e.g. UTC+3, so still "yesterday" in UTC) got a draft that stalled the reply asking them to "clarify" a date they'd already stated correctly, instead of just using it. Only a date that's off by more than a day should prompt a clarifying question.

## Closing the conversation — a restated demand is not new information

The system prompt already told the model to hold the line and close a conversation once a customer had been given a final policy/decision answer and kept repeating the same ask. That instruction alone wasn't enough: in a live case, a customer whose refund had already been declined replied "I WANT MY MONEY BACK NOW!!!" — same demand, no new facts — but the message also happened to restate a date that read as a day off under the "Today's date" UTC line above. The model treated that incidental mismatch as a new fact worth investigating and reopened the case with a clarifying question, instead of recognizing the message as the same already-answered demand and closing per the existing rule.

**Fix:** the closing-conversation rule now says explicitly that a restated demand — repeated with more urgency, or with an incidental detail (a date, an amount, an account name) the customer already gave — is still the same demand, not new information, and that a minor/non-material inconsistency in that detail is not grounds to reopen a decision already stated as final. Only genuinely new, material evidence justifies reopening. This matters most in exactly the cases where it failed: the model has several independent instructions (compute elapsed time from a date, don't invent exceptions under pressure, close once already answered) that can pull against each other under customer pressure, and the more literal one (verify this date) can quietly override the firmer one (hold the line) unless it's told which one wins.

### `CONVERSATION_CLOSURE_RULES` — confirm, don't re-open

The rule above covered a *hostile* repeat demand. It did not cover the far more common failure: a customer simply asking to **confirm** something they'd already been told. In a live payment case an agent had already stated in-thread that the payment never landed on Fanvue's side and the bank would rescind it. The fan's follow-up was a plain yes/no check — "so I have to wait until I have my money back right, but the payment was completed in my bank account, i think its stuck". The draft answered by contradicting Fanvue's own agent ("it shouldn't be treated as a temporary pending authorisation… the transactions need to be checked rather than assuming the funds will automatically return"), then asked for the transaction date and last 4 card digits. Three separate defects in one reply: it overturned an answer the agent had already given, it re-opened a closed loop, and it asked for details the thread already contained.

The root cause is a length bias, not a knowledge gap — the model reads a two-line confirmation as under-delivering, so it manufactures doubt and a new check to fill the space. So the fix names the correct behavior positively rather than only banning the bad one:

- **Agree and close is the default** for an already-answered question, and a short reply that closes the loop is explicitly labelled a COMPLETE reply, not a lazy one.
- **A yes/no question gets the answer first** — lead with "Yes, that's right" / "No, nothing else is needed from you", then one line of reassurance.
- **Never contradict or walk back an answer a Fanvue agent already gave in this thread.** That answer is Fanvue's position on the case; the model has no information the agent lacked, so it does not get to overturn it in front of the customer. If it believes the answer was wrong, it holds the line in the reply and the disagreement gets raised internally.
- **The customer restating their own situation is not new evidence** — re-describing what their own bank/app/account screen says, or using a different word for the same thing, is the same message already answered.
- **No inventing a check or a missing detail to justify a longer reply**, and **match the reply's length to what was asked**.

Two supporting changes land the same fix in the layers around it. `PAYMENT_DISPUTE_RULES` now gates its BIN + last 4 lookup on the transaction being *genuinely unidentified* — if the thread already shows an invoice or an agent already explained the charge, asking for digits re-opens an answered question — and adds that a customer's banking-app wording ("completed", "went through") does not overrule what Fanvue's own records show. The **verifier** ([[Draft Verify Pipeline]]) gets the same rule as a last line of defence: it cuts anything that contradicts, hedges, or re-opens an answer the source thread shows an agent already gave, deletes asks for information the thread already contains, and is told never to lengthen a short, correct confirming draft. Its one-call-to-action rule is now conditional — a reply that just confirms and closes should not have an ask bolted onto it.

Unlike the older closing block, this one is a shared constant injected into `buildSystemPrompt()`, `buildImproveSystemPrompt()`, and `buildMacroAdaptSystemPrompt()` — the improve and macro-adapt paths previously had no closing rules at all, so either could re-introduce the pushback the draft path had just been told to avoid.

## 6c. Greeting rules — exactly one greeting per message (fixed 2026-08-22)

The greeting instruction isn't a constant — `greetingToneRule(hasAgentReplied, greetingInjected)` picks one of three bullets and injects it into the **Tone rules** section: pick up mid-conversation if this agent has already written in the thread; open warmly if they haven't; or write no greeting at all when `greetingInjected` is true, meaning the reply-queue pipeline prepends `buildAgentGreeting()` in code (the manual, macro-adapt and improve paths pass `false`, since nothing is prepended there).

**Why the third branch was rewritten:** it used to say "Do not write any opening greeting, thanks line, or your own name" — and the model still opened its text with a bare "Hello," on its own line. The prepended greeting plus that line produced two stacked greetings, which is the most obvious tell that a reply was machine-written. The model apparently did not read a bare salutation as "a greeting" in the sense the rule meant. The fix is to stop relying on the category and name the strings: the rule now bans a **salutation** explicitly and enumerates the exact openers — "Hello", "Hi", "Hi there", "Hey", "Dear …", "Good morning/afternoon", "Thanks for reaching out", "Thanks for contacting us", "Thank you for your message", "Thanks for your patience" — as a sentence *or* as a short standalone line, and says the first words must be the substance of the answer. Same lesson as elsewhere on this page: a prohibition the model has to interpret is weaker than one it can pattern-match.

The [[Draft Verify Pipeline]] verifier backs it up as a second gate — it deletes a salutation or thanks line stacked on top of a greeting already present in the source context or prepended to the message. Locked in by `lib/draft-ai.test.ts` ("greeting is injected exactly once").

## Rule precedence, and why the stack needed one

Every rule block on this page was added in response to a specific live failure, and until 2026-08-18 none of them said what happens when two of them pull in opposite directions. That gap was not theoretical. The draft that told a fan "the transactions need to be checked" was **obeying** `PAYMENT_DISPUTE_RULES` ("ask for BIN + last 4") over `CONVERSATION_CLOSURE_RULES` ("confirm and close"), because the former is more literal and more actionable and nothing said which one wins.

Reading the *assembled* prompt as one document (see `scripts/dump-assembled-prompt.mts`) surfaced four defects that are invisible when reading the source file block by block:

1. **A blanket instruction to ask.** "If the playbook and articles don't cover the issue, acknowledge warmly and ask one focused clarifying question" sat in **Critical constraints**, which reads as more authoritative than a section called "Closing the conversation." Since most tail cases have no playbook match, *asking* was effectively the documented default. It now requires reading the thread first.
2. **An unconditional call-to-action.** "End with exactly one clear call-to-action" gave the model no exception for a reply that simply confirms and closes, so it invented an ask to satisfy the rule — while the verifier had just been told to strip exactly that. The two layers were fighting. Both are conditional now.
3. **The tone block was no longer last** in the draft path. Its disclaimer says it "never overrides any rule above", which is only true if nothing outranking it is printed below it; the closure rules had been appended after it. Order restored, and a test now pins it.
4. **Duplicated closure bullets** — the new closure rules were appended alongside the older ones they subsumed, so the same instruction appeared twice in slightly different words. Merged.

`RULE_PRECEDENCE` now states the order explicitly: safety and policy first, then "don't re-open what is already settled", then "ask only for what is genuinely missing", and formatting/tone last. Item 4 carries most of the weight: **a rule about shape must never manufacture substance** — never invent a question, caveat, or next step purely to satisfy a rule about form.

## `GOOD_REPLY_SHAPE` — the counterweight to a prohibition-only stack

The rule stack was roughly 90% prohibitions: 55 bullet directives containing 41 instances of "never". Told only what *not* to do, the model falls back on generic assistant instincts — hedge, caveat, ask a clarifying question — and that default **is** the pushback the team kept patching one incident at a time. Naming the target explicitly is cheaper than banning every way of missing it, so the prompt now states the shape it wants: answer in the first sentence, give the one thing that happens next if there is one, then stop. It says outright that a two-or-three-sentence reply is finished work, not a rough draft.

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

## Measuring the prompt instead of arguing about it

Two tools exist so prompt changes are evidence-driven rather than intuition-driven, because the string-presence assertions in `lib/draft-ai.test.ts` prove the rule text is *present*, never that the model *obeys* it.

- **`scripts/dump-assembled-prompt.mts`** — writes the fully assembled prompt for all four paths to one file, no API key required. This is how the four defects above were found; block-by-block reading of the source hides them.
- **`scripts/eval-draft-behavior.mts`** — runs real generations against fixtures shaped like the failures agents actually correct, and scores them. `--dry-run` checks that every load-bearing rule survived a refactor (no key needed). `--self-test` asserts every defect detector still fires on a known-bad draft and that none fire on a known-good one, so the eval cannot quietly degrade into always-passing.

The fixtures are derived from `reply_queue_events` (n=1,731, 2026-07-18 → 2026-08-18), not from intuition:

| Signal | Measured |
|---|---|
| Approved unedited / edited / rejected | 61.8% / 25.5% / 12.7% |
| Edits that **shortened** the draft | **85%** (47% cut more than a quarter) |
| Mean length, suggested → agent's final | 603 → 433 chars |
| "please confirm/provide" removed vs added | 58 vs 10 |
| Screenshot ask removed vs added | 56 vs 19 |
| "our team" / "get back to you" removed vs added | 10 vs 2 / 6 vs 0 |

The dominant correction agents make is **cutting**, which is why padding is treated here as a first-class defect rather than a style nit.

One finding worth keeping in mind: **rejects are not separable from approves** on these features (22% vs 22% ask rate; confidence 0.82 vs 0.85). Rejections are correctness failures — wrong policy, wrong read of the case — and no amount of prompt-shape work will move them. They need retrieval and playbook work instead. `confidence` is also not a usable quality signal at present.

Before/after on the `confirm-and-close` fixture, which reproduces the live 2026-08-18 failure: the pre-fix prompt scored **0/2** (one reply asked for "BIN and last 4 digits… amount and date", the other ran 570 chars and told the customer to contact their bank); the current prompt scores **2/2** at ~250 chars.

## Key files

- `lib/draft-ai.ts` — `buildSystemPrompt()`, `RULE_PRECEDENCE`, `GOOD_REPLY_SHAPE`, `AGENT_IDENTITY_RULES`, `REFUND_POSTURE_RULES`, `CONVERSATION_CLOSURE_RULES`, capability/policy/payment-dispute/privacy rule constants, `REPLY_STYLE_NUDGE`, `greetingToneRule()`, `buildAgentGreeting()`, `toneInstructionSection()`, `buildNotionAwareSystemPrompt()`, `buildImproveSystemPrompt()`, `buildMacroAdaptSystemPrompt()`, `buildDraftVerifierMessages()`, `buildUserMessage()`
- `scripts/dump-assembled-prompt.mts` — assembled-prompt dump for all four paths
- `scripts/eval-draft-behavior.mts` — behavioural eval, `--dry-run` / `--self-test` / `--runs=N` / `--scenario=<id>`
- `lib/draft-ai.test.ts` — "chargeback / bank-dispute guardrail", "refund posture — answer up front, never coach the exemptions", "greeting is injected exactly once", "no keyword-gated confirmations", and "confirm, don't re-open" assert the rules survive prompt refactors
- `lib/tone-presets.ts` — `TONE_PRESETS`, `TonePresetId`, `toneInstructionFor()`, `presetStripsEmDashes()`, `stripEmDashes()`, `MAX_CUSTOM_TONE_CHARS`

## Data flow

```
buildSystemPrompt(playbook, examples, agentName, articles, hasAgentReplied, greetingInjected, toneInstruction)
        │
        ├─ 1. AGENT_IDENTITY_RULES        (you ARE the agent)
        ├─ 2. CAPABILITY_BOUNDARY_RULES   (no fake account checks)
        ├─ 3. POLICY_INTEGRITY_RULES      (no invented exceptions)
        ├─ 3b. PAYMENT_DISPUTE_RULES      (never send them to a chargeback)
        ├─ 3c. REFUND_POSTURE_RULES       (say no now; never name the exemptions)
        ├─ 4. Privacy rule                (no real name; email presence only, not value)
        ├─ 5. English-only instruction    (repeated again on the user message footer)
        ├─ 0a. RULE_PRECEDENCE            (which rule wins when two conflict)
        ├─ 0b. GOOD_REPLY_SHAPE           (the positive target: answer, next step, stop)
        ├─ 6. Today's date                (explicit, for elapsed-time math)
        ├─ 6b. CONVERSATION_CLOSURE_RULES (confirm an answered question, don't re-open it)
        └─ 7. toneInstructionSection(toneInstruction)   ← optional, always LAST
                 "shapes voice only — never overrides any rule above"
        │
        ▼
Final system prompt  ──▶  streamChatCompletion()  ──▶  draft
```

See also: [[Draft Verify Pipeline]], [[Settings and Profile]], [[Canvas Workflow]], [[Database Schema Reference]].
