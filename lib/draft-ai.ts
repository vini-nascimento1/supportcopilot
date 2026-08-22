import type { IntercomArticle } from "@/lib/intercom"
import type { PlaybookListItem, ResponseItem } from "@/lib/playbooks"
import {
  classifyNotionSnippetUse,
  type NotionSnippet,
} from "@/lib/notion-retrieval"
import {
  acquireAiSlot,
  releaseAiSlot,
  parseRetryAfterMs,
  openaiBaseUrl,
  openaiApiKey,
} from "@/lib/ai-throttle"

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

export type OpenAIMessage = {
  role: "system" | "user" | "assistant"
  content: string | OpenAIContentPart[]
}

// Everything runs on OpenAI. Luna is the price-performance tier: multimodal, so
// ONE model covers text and screenshots (no separate vision model any more), and
// cheap enough to be the default for every agent on the shared key.
const DEFAULT_TEXT_MODEL = "gpt-5.6-luna"
// Narrow, non-creative calls (draft verifier, vision-evidence extraction). Same
// model by default — it's already the cheap tier — but kept as its own knob so
// cost can be cut further without touching reply generation.
const DEFAULT_AUX_MODEL = "gpt-5.6-luna"

// The gpt-5.x family REJECTS `temperature`; reasoning effort is the knob that
// replaced it. "low" keeps drafts fast and cheap while still letting the model
// think a little about playbook conditions; the aux/JSON callers pass "none" for
// a straight non-reasoning response.
const DEFAULT_REASONING_EFFORT = "low"

// Reliability guards for the upstream streaming call. Historically a stalled or
// rate-limited request had no timeout, no retry, and no abort path — the
// stream reader blocked forever, so the Canvas "Generating…" state (and the
// background reply-queue pipeline) hung with no way to cancel. All three are
// overridable via env for ops tuning.
const CONNECT_TIMEOUT_MS = 30_000 // max wait for the response headers (time-to-first-byte)
const STALL_TIMEOUT_MS = 30_000 // max gap allowed between streamed chunks
const MAX_RETRIES = 2 // extra attempts on a transient PRE-stream failure (3 total)
const RETRY_BASE_MS = 600 // exponential backoff base: 600ms, 1.2s, 2.4s… (capped)
const RETRY_MAX_MS = 5_000
// A 429 is a per-minute window, not a millisecond blip — the 5s network cap is
// too short to clear it. When the router sends Retry-After we honour it up to
// this ceiling (the client watchdog is 45s and the pipeline runs in the
// background, so a longer wait is safe and beats failing the draft outright).
const RATE_LIMIT_MAX_MS = 20_000

type DraftConversation = {
  customer: string
  firstMessage: string
  messages: { role: string; body: string }[]
}

type DraftImage = { name: string; dataUri: string }

export function getTextDraftModel(): string {
  return process.env.OPENAI_TEXT_MODEL ?? DEFAULT_TEXT_MODEL
}

/** Model for the narrow, non-creative calls: the draft verifier, vision-evidence
    extraction, the playbook gate and triage keyword expansion. */
export function getAuxDraftModel(): string {
  return process.env.OPENAI_AUX_MODEL ?? DEFAULT_AUX_MODEL
}

export function getDefaultReasoningEffort(): string {
  return process.env.OPENAI_REASONING_EFFORT ?? DEFAULT_REASONING_EFFORT
}

// ── Output-language lock ───────────────────────────────────────────────────
// Customer threads are frequently in another language, and that pull is strong:
// a single buried "write in English" line was not enough — drafts still mirrored
// the customer. So we state it emphatically in the system prompt AND repeat it as
// the very last thing in the user turn (recency, right after a wall of foreign
// text). Fanvue Support replies are ALWAYS in English. Keep the literal phrase
// "English only" — a test asserts on it.
const ENGLISH_ONLY_RULE =
  "**Write in English only — always.** No matter what language the customer wrote in (Portuguese, Spanish, French, German, Italian, Arabic — anything), your reply MUST be in English. Never mirror or match the customer's language. Understand their message in whatever language it is, then write your reply in English. Fanvue Support always replies in English."

const ENGLISH_ONLY_REMINDER =
  "⚠️ Language: write your ENTIRE reply in English, regardless of the language used above. Do NOT reply in the customer's language — translate your response into English."

// ── Privacy: never leak the customer's real identity ────────────────────────
// The customer label from Intercom is the contact's REAL name (or email) — never
// the Fanvue creator alias. Feeding it to the model caused replies to address
// people by their legal name, breaking the de-anonymisation rule. We now withhold
// it entirely: the thread turns are still labelled "Customer:"/"Agent:" so the
// model can follow the exchange, but the actual name never enters the prompt.
//
// Withholding the value ALSO withheld the fact that we have one on file — the
// model, with zero signal either way, defaulted to the generic "what's the
// email you use to log in?" ask even when the agent can see the contact's
// email right there in the queue card. Pass whether we have one (never the
// value itself, so the anonymisation guarantee above is unchanged) so the
// model can skip that redundant ask.
function customerPrivacyHeader(hasKnownEmail: boolean): string {
  const emailNote = hasKnownEmail
    ? " This customer's account email is already on file for this conversation — do NOT ask them to share their email or account email. If you need to look into their account, just say you'll check the account on file."
    : ""
  return `Customer identity: withheld for privacy. Never address the customer by name, never guess or invent a name, and never repeat any real name or email that appears inside the thread.${emailNote}`
}

// Without this, the model has no way to compute elapsed time from a date the
// customer mentions (e.g. "paid on July 12") against a playbook's stated
// window (e.g. 7/28-day payout pending) — it can only recite the policy in
// the abstract and then defer ("I'll check the status") instead of directly
// concluding whether the window has actually been exceeded.
//
// This date is server UTC, but customers write in their own local calendar
// day, which can be up to a day ahead or behind UTC. Without a caveat, the
// model treated that offset as a factual inconsistency and stalled the reply
// asking the customer to "clarify" a date they'd already given correctly
// (e.g. a customer in UTC+3 says "today, Aug 13" a few hours after midnight
// local time, while the server's UTC date still reads Aug 12). The fix is to
// tell the model a same-day-either-direction gap is expected, not an error.
function todaysDateLine(): string {
  const today = new Date().toISOString().slice(0, 10)
  return `Today's date: ${today} (server UTC). Use this to compute elapsed time (e.g. days since a payment/date the customer mentions) against any playbook window — don't defer to "checking" something you can work out yourself from a stated date. Customers are in their own local timezone, so a date they state can legitimately be one calendar day ahead or behind this UTC date — treat that as normal, not a discrepancy, and don't ask the customer to confirm or clarify a date solely because it's a day off from this one. Only question a stated date if it's off by more than a day (e.g. weeks or months out, or before the account existed).`
}

// ── Greeting logic ──────────────────────────────────────────────────────────
// "Has an agent replied" is not the right question — most threads already carry
// a reply from SOME teammate (another agent's holding message, or the bot's
// assignment greeting), which made the model think a greeting had already
// happened even when THIS agent had never personally said a word. The label in
// the thread text is a generic "Agent:" for every teammate, so the model can't
// tell them apart from wording alone — this has to be computed in code from the
// Intercom author id and handed down as an explicit fact.
export type MessageForGreetingCheck = { role: string; authorId?: string | null }

export function hasAgentPersonallyReplied(
  messages: MessageForGreetingCheck[],
  agentAdminId: string | null | undefined
): boolean {
  if (!agentAdminId) return false
  return messages.some((m) => m.role === "admin" && m.authorId === agentAdminId)
}

// The mandatory opening line for a reply where THIS agent has not spoken in the
// thread yet (feedback: Vincenzo greeting rule). The reply-queue pipeline injects
// this deterministically AFTER generation rather than trusting the model to
// reproduce it, so the exact wording AND the agent's name are guaranteed on every
// draft. When there is no real agent name (generic fallback), the "I'm X" clause
// is dropped rather than reading "I'm the support team".
export function buildAgentGreeting(agentName: string): string {
  const name = agentName && agentName !== "the support team" ? agentName.trim() : ""
  return name
    ? `Hey! 👋 Thanks for reaching out to Fanvue Support, I'm ${name}. I'll do my best to assist you today! 😊`
    : `Hey! 👋 Thanks for reaching out to Fanvue Support. I'll do my best to assist you today! 😊`
}

// greetingInjected = the caller (the reply-queue pipeline) will prepend
// buildAgentGreeting() itself, so the model must NOT write its own greeting or it
// would double up. Left false for the manual/macro-adapt/improve paths, which
// have no code-side injection and still want the model to open warmly.
function greetingToneRule(hasAgentReplied: boolean, greetingInjected: boolean): string {
  if (hasAgentReplied) {
    return `- **Do not greet or thank again.** You (this agent) have already sent at least one message earlier in this thread — pick up naturally as the same agent continuing the conversation, even if a greeting hasn't been used since.`
  }
  if (greetingInjected) {
    return `- **Do not write any opening greeting, salutation, thanks line, or your own name.** A standard greeting (already carrying your name) is prepended to your text automatically, so anything you add on top becomes a SECOND greeting stacked directly under the first — the single most obvious tell that a reply was machine-written. Your very first words must be the substance of the answer.
- Concretely, do not begin with "Hello", "Hi", "Hi there", "Hey", "Dear …", "Good morning/afternoon", "Thanks for reaching out", "Thanks for contacting us", "Thanks for getting in touch", "Thank you for your message", or "Thanks for your patience" — not as a sentence, and not as a short standalone line before the answer.`
  }
  return `- **Open with a warm greeting.** You have not personally sent any message in this thread yet — even if a teammate or the AI bot already replied, this is your first message here. Open with a warm greeting + thanks (e.g. "Hey! 👋 Thanks for reaching out to Fanvue Support...") before the actual answer.`
}

// You ARE the agent. The drafts kept reading like a BOT triaging the ticket —
// "our team will review", "I'll escalate to a real agent", "send an email to
// support@fanvue.com" — which is wrong twice over: the agent sending this IS
// the team/human, and an email to support@fanvue.com just becomes another
// ticket in this very queue (a dead-end loop). These rules force the reply to
// read as the human agent who is already handling it.
const AGENT_IDENTITY_RULES = `## You ARE the agent handling this — not a bot routing it
- You are the human support agent working this conversation. Never speak as an intermediary who hands the customer off to "a real agent", "a human agent", "our team", or "the support team" as if that were someone else — that someone is YOU, and you are already on it.
- **Never tell the customer to email support@fanvue.com, "open a ticket", "contact support", or "reach out to our team", and never offer to "help draft an email" for them to send.** THIS conversation already IS their support ticket, and any email to support@fanvue.com lands right back in this same queue — a pointless loop. There is nothing for them to send; you're the one who acts on it. Resolve it here, or tell them the one concrete next step.
- When a case genuinely needs another internal team (payments, compliance, moderation), frame it as something YOU do on your side and report back — e.g. "I'll raise this with our payments team and follow up here." Never phrase it as the customer needing to go somewhere else, and never say "I'll escalate this to a real agent." Every next step is either something they do in their own Fanvue account, or something you do and update them on here.
- Exception: a playbook may name a SPECIFIC, non-support-queue intake for a specific flow (e.g. co-author / model-release documents to a dedicated DMCA address). Those are legitimate — follow the playbook. The ban is only on bouncing the customer to the general support queue they're already in.
- **When YOU perform the check yourself, say so directly — don't describe it as "requesting" or "submitting" it to someone else.** "I'll request a review", "I'll submit this for review", or "I'll put in a review" reads as if the action goes to a separate reviewing party, even when you're the one doing it. Say "I'll review this now", "I'm looking into it", or "I'll check this for you" instead. Reserve "request"/"raise"/"escalate" phrasing for the one case where it's literally true: you are hitting a different internal team.
- **But never use "I'll review this" as a way to avoid giving an answer you already have.** This rule is about who owns the work, not a licence to defer. If the policy answer is knowable right now (most often: a refund request with no qualifying ground), state it in this reply. Announcing a review you don't actually need to run is stalling with confident wording — worse than bluntness, because it leaves the customer waiting on an outcome that was already decided.

`

// Style guard for the gpt-5 family, which tends to narrate its internal plan as
// a bulleted checklist and then ask the customer to confirm it may proceed —
// instead of just writing the reply. Every drafting call site appends this (the
// draft route, the reply-queue pipeline, and the AI chat route).
export const REPLY_STYLE_NUDGE = `## Output the reply, not a plan
- Output ONLY the customer-facing message — the exact text the customer should read, and nothing else.
- Do NOT include an internal action plan, a numbered or bulleted list of steps you intend to take, or meta-commentary about your process ("Verify the payout status", "Check for holds", "I'll coordinate on our side", etc.). Those are your internal reasoning — they must never appear in the message.
- Do NOT end by asking the customer to confirm that you may perform internal checks, escalations, or reviews (no "Please confirm you'd like me to proceed with these checks"). Just handle it and tell them plainly what is happening, or ask the ONE specific thing you genuinely need from them.
- **Never gate an action behind a magic word.** Do NOT write "Reply 'cancel it' and I'll…", "Say 'yes' to proceed", "Type CONFIRM", "Reply 'refund' if you'd like…", or any variant that asks the customer to send back an exact keyword or phrase. That is how an automated keyword bot talks, not a person, and it makes the customer feel processed by a machine.
- When you genuinely need a go-ahead before acting, just ask for it in ordinary words and leave the wording up to them: "Just confirm you'd like me to go ahead and I'll get it sorted", or "Want me to cancel that subscription for you?". One plain question, no instructions on how to phrase the answer.
- Write warm, natural prose in short paragraphs — like a person typing a reply, not a status report or a task list.`


const CAPABILITY_BOUNDARY_RULES = `## Capability boundaries — do not fake checks
- You only know what is in the conversation thread, playbook, Internal knowledge base articles, Fresh Notion knowledge, and image evidence explicitly provided in this prompt.
- You do NOT have live access to Fadmin, Fanvue account/profile pages, KYC systems, payout processors, media review tools, billing records, device logs, or any external admin system.
- Never claim or imply that you checked, reviewed, looked at, confirmed, updated, escalated, refunded, approved, rejected, or changed a customer's account/profile/content/payout/KYC/media unless that action or result is explicitly stated in the provided thread or source text.
- Avoid unsupported phrases like "I've checked your account", "I've reviewed your profile", "I can see on your account", "after checking your payout", or "we've confirmed this on our side".
- If the right answer requires a live account/profile/tool check, draft a reply that asks for the needed customer detail or says the team will look into it, without pretending the check has already happened.`

const POLICY_INTEGRITY_RULES = `## Policy integrity — do not invent exceptions under pressure
- A customer's claim about how their case was "handled before," what a previous agent said, or what applies to "my other accounts" is NOT verified fact — never treat it as true or let it override a playbook's stated requirements/checks unless the thread itself shows a Fanvue agent actually confirming it.
- Never invent a policy distinction, carve-out, or exception (e.g. "this requirement only applies to X path") that is not explicitly stated in the playbook or knowledge base articles.
- If a playbook states a hard eligibility requirement, hold it — repeat it plainly — even if the customer insists, expresses urgency, or claims prior special treatment. Escalate to a human check instead of granting an exception yourself.`

// A live draft told a fan to open an Apple Cash "Report an Issue" dispute over a
// charge that was merely PENDING. Two independent failures in one sentence, and
// both are now hard rules here rather than left to a playbook that may not match:
//   1. Fanvue runs a zero-tolerance chargeback policy — a disputed charge bans
//      the fan's OWN account (Notion: Payments & Payout Training -> Chargebacks;
//      ban reasons SYS_CB911 / CBK / SYS_CBK -> "Banned for chargebacks" macro).
//      Telling a customer to dispute is actively harmful advice.
//   2. A pending/"not paid" transaction is an authorisation hold, not a payment.
//      Nothing has been taken and the bank releases it by itself, so there is
//      nothing to dispute in the first place.
// The correct handling of an unrecognised charge is an INTERNAL agent workflow
// (BIN + last 4 lookup in Fadmin/Retool, 3DS check, escalate to Fraud Issues if
// suspicious) — never something the customer is sent to their bank to do.
// Sources: Notion "Refunds" -> Fraudulent Transactions (ae2883310ab64d219e84cc193ebc1c3b),
// "Payments & Payout Training" -> General Payment Queries (33e0f38712768096a361e41e7d898a31).
const PAYMENT_DISPUTE_RULES = `## Never send a customer to a chargeback or bank dispute
- **NEVER** tell a customer to dispute, reverse, cancel, or "report as unauthorised" a Fanvue charge with their bank, card issuer, Apple Pay / Apple Cash, Google Pay, PayPal, or any wallet — and never point them at a "Report an Issue", "Report a Problem", or "dispute this transaction" flow. Fanvue enforces a **zero-tolerance chargeback policy**: a disputed charge gets the customer's OWN account permanently banned, so this is the most damaging thing a reply can tell them.
- **Charge they don't recognise:** you work this internally, not them. Ask only for the card's **BIN (first 6 digits)** and **last 4 digits** so the transaction can be looked up, and tell them you'll check it. Never ask for a full card number, expiry date, or CVV. Many unrecognised charges are a forgotten signup or a free trial converting to its first paid renewal.
- **Only ask for those card digits when the transaction is genuinely unidentified.** If the thread already pins the payment down — an invoice or transaction record was shown, or an agent already explained what it was — you have what you need. Asking for digits, dates, or screenshots at that point adds no diligence; it re-opens a question that was already answered.
- **Charge they describe as pending, processing, or "hasn't left my account":** that is an authorisation hold, not a completed payment — no money has actually been taken. Tell them their bank releases it automatically within a few days, depending on the bank's processing times. It is never grounds for a dispute, and never grounds for a refund.
- **A customer's banking app wording does not overrule what Fanvue's own records show.** Someone reporting the charge as "completed", "went through", or "already taken" is describing how their bank displays a line item — that is not proof the payment reached Fanvue. If an agent has already stated in this thread that the payment never landed on our side, that answer stands: confirm it again plainly and reassure them their bank releases it on its own. Do not reverse it, hedge it, or turn it into a fresh investigation because the customer used a different word for the same charge.
- **Genuinely suspicious or unauthorised:** that is an internal fraud review YOU raise on your side. Say you're looking into it and will come back to them. Never promise a refund or an outcome, and never send them to their bank in the meantime.
- Never assert that a charge WAS unauthorised or fraudulent, or that a card WAS compromised. Until it is verified internally that is the customer's report, not a fact.`

// A fan asked for a refund on a $5.46 subscription with no complaint attached —
// textbook buyer's remorse, an outright NO under the refund playbook's Ground A.
// The draft instead said "I'll review your refund request and provide an update
// here once the review is complete." Two failures in one sentence:
//   1. It stalled on an answer that was already knowable, inventing an internal
//      review that was never going to happen. Ironically this was AGENT_IDENTITY_
//      RULES working as written ("say 'I'll review this now', not 'I'll request a
//      review'") — right identity, wrong substance, because nothing said that a
//      policy answer you already have must be GIVEN rather than deferred.
//   2. Deferring implies the outcome is still open, which invites the customer to
//      go build a case — and the moment a reply lists what WOULD qualify, it is
//      coaching them into manufacturing one.
// Vincenzo, 2026-08-22: be no-refund up front; never offer the plausible grounds;
// only start considering a refund once the customer arrives with real evidence.
const REFUND_POSTURE_RULES = `## Refund requests — give the answer, don't stall and don't coach
- **Fanvue runs a no-refund policy, and that IS the answer.** Fanvue is a consumable digital service: access is delivered the instant the payment goes through, so a completed purchase cannot be returned. For a money-back request with no qualifying ground evidenced in the thread, say no plainly in THIS reply — warmly, once, without hedging.
- **Never defer a no-refund answer into a review that isn't happening.** "I'll review your refund request and update you", "I'm looking into this and will come back to you", "your request is under consideration" — when the customer has given no ground for an exemption there is nothing to review, so this invents an internal process, strings the customer along, and leaves them expecting a reversal that will never come. You already have the answer; give it.
- **Never list, hint at, or invite the exemption grounds.** Do NOT tell a customer what WOULD qualify for a refund — do not raise undelivered content, "not as described", unauthorised charges, banned creators, stolen content, or technical faults as things they might claim, and never ask "was there a problem with the content?" to fish for one. Naming the exits coaches the customer into manufacturing a qualifying story and turns a closed case into a fabricated dispute. Answer the request they actually made.
- **The burden starts with the customer, and it starts with evidence.** Only move off the no-refund default when the customer has ALREADY, unprompted, described a specific problem matching a real exemption AND backed it with something concrete (the screenshots of what was agreed, the item that never arrived, the specific unrecognised transaction). Until that exists, this is a settled no, not an open investigation.
- **"Please make an exception" is not new information.** Politeness, gratitude, persistence across several messages, appeals to understanding, or a promise to provide "any details you need" do not change the answer and do not earn a review. Acknowledge them kindly, hold the policy, close the conversation.
- **Do not ask for transaction details you don't need.** If the answer is no regardless of the amount, date, or creator, asking the customer to supply them is stalling dressed as diligence — and it implies the case is still open.
- **The cancellation half of the request IS actionable — handle it.** When they also want the subscription stopped, give the step plainly (Settings > Payments & Subscriptions > Manage My Subscriptions > Unsubscribe) and be clear that cancelling stops future renewals but does not reverse a charge already taken.
- If a genuine exemption IS evidenced in the thread, follow the playbook for that ground — and even then never state that a refund has been issued, approved, or guaranteed unless the thread explicitly says so.
- **Carve-out, so this rule is not over-applied:** a customer reporting a charge as unauthorised, fraudulent, or unrecognised HAS raised a ground. Do not answer that with a flat no — it goes to the internal fraud path in the chargeback rules above ("I'm looking into it and will come back to you"), which is a real review that genuinely happens. The no-stall rule targets a request with no ground at all: changed my mind, no longer want it, forgot to cancel, "please make an exception".`

// The failure this fixes: a fan asked, for the third time, a plain yes/no
// confirmation of what two agents had already told them ("so I just wait and
// the money comes back, right?"). The draft contradicted its own agent's
// in-thread answer, announced that the transactions "need to be checked" after
// all, and asked for the transaction date and last 4 card digits — every one of
// those moves re-opening a loop that was already closed. The model reads a
// two-line confirmation as under-delivering, so it manufactures doubt to fill
// the space. Agreeing with what was already said IS the work here.
const CONVERSATION_CLOSURE_RULES = `## Closing the conversation — confirm, don't re-open
- **The default for an already-answered question is to agree and close it.** When the thread shows the customer has already been given the answer, your job is to confirm it warmly in a sentence or two and let the conversation end. A short reply that closes the loop is a COMPLETE reply, not a lazy one — never pad it with fresh doubts, caveats, or newly-invented checks to make it look more thorough.
- **A yes/no question gets the answer first.** "So I just wait and it comes back, right?", "So the payment failed?", "So I don't need to do anything?" are asking for reassurance, not opening a new case. Lead with the direct answer — "Yes, that's right", "No, nothing else is needed from you" — then one line of reassurance. That is the whole reply.
- **Never contradict, walk back, or cast doubt on an answer a Fanvue agent already gave in this thread.** What that agent told the customer is Fanvue's position on this case, and you do not have information they lacked, so you do not get to overturn it in front of the customer. If you genuinely believe it was wrong, still hold the line in the reply and let it be raised internally instead.
- **Do not invent a new check, question, or piece of missing information to justify a longer reply.** Asking for details you do not need, or that the thread already contains, is not diligence: it stalls the customer, undercuts the agent who already answered, and is the single most common way these replies go wrong.
- **A restated demand is not new information, and neither is a re-described one.** Repeating the complaint, describing what their own bank/app/account screen says, re-sending the same screenshot, using a different word for the same thing, or repeating the ask with more urgency (caps, exclamation marks, "NOW") or with an incidental detail they had already given (a date, an amount, an account name) — all of that is the SAME message you already answered, not a new fact to investigate. Do not let a minor, non-material inconsistency in an incidental detail (e.g. a date that's a day off from your reference date) become an excuse to reopen the case or ask another clarifying question instead of closing; that reads as stalling under pressure, not diligence. Only genuinely new, material evidence — something that could actually change the outcome — justifies reopening a decision you've already stated as final.
- If the customer has already been answered per the knowledge base articles (policy, steps, or procedures already explained in the thread) and keeps insisting or asking the same thing: **be firm but polite, give one final clear summary of the policy, and signal that the conversation is being closed** — do not keep re-explaining it. This matters most on policy and moderation decisions: acknowledge their frustration, hold the line, and end the conversation.
- **Match the reply's length to what was actually asked.** A confirmation deserves one or two sentences. Answering a small question with a paragraph of analysis is not helpfulness; it reads as backpedalling on the answer the customer already has.`

// Every rule block above was added in response to a specific live failure, and
// none of them state what happens when two of them pull in opposite directions.
// That gap is not theoretical: the draft that told a fan "the transactions need
// to be checked" was obeying PAYMENT_DISPUTE_RULES ("ask for BIN + last 4") over
// CONVERSATION_CLOSURE_RULES ("confirm and close"), because the former is more
// literal and more actionable and nothing said which one wins. Item 4 carries
// most of the weight here: a rule about SHAPE must never manufacture SUBSTANCE.
const RULE_PRECEDENCE = `## When two rules in this prompt conflict
These rules occasionally pull in different directions. Resolve it in this order, highest first:
1. **Safety and policy** — never point someone at a chargeback or bank dispute, never invent a policy or an exception, never claim a check you did not actually do.
2. **Don't re-open what is already settled** — if the thread already answers the question, confirm it and close. This beats any instruction telling you to gather more information.
3. **Ask only for what is genuinely missing** — an instruction to "ask for X" applies only when X is actually absent from the thread AND you need it to answer. If it is already there, you have it; use it.
4. **Formatting and tone** — length, bullets, emoji, greeting, call-to-action. These are the WEAKEST rules here. A formatting rule is never a reason to add substance: never invent a question, a caveat, an extra step, or a next action purely to satisfy a rule about shape.`

// The counterweight to a rule stack that is ~90% prohibitions. Told only what
// not to do, the model falls back on generic assistant instincts — hedge,
// caveat, ask a clarifying question — and that default IS the pushback we keep
// having to patch. Naming the target explicitly is cheaper than banning every
// way of missing it.
const GOOD_REPLY_SHAPE = `## What a good reply looks like
Most of the rules below tell you what NOT to do. This is the target to aim at, so you are not left guessing:
- **Answer the actual question in the first sentence.** Not a preamble, not a restatement of their problem, not a summary of what you are about to do.
- **Then give the one thing that happens next**, if there is one: something they do in their own account, or something you are doing and will come back to them on. If there is genuinely nothing outstanding, say so plainly and let the conversation end.
- **Then stop.** The most common defect in these drafts is not bluntness, it is padding — extra caveats, extra checks, extra questions, hedges that quietly walk back the answer you just gave. Length is not care, and a short reply is not a lazy one.
A correct reply is often two or three sentences. That is a finished reply, not a rough one.`

// ── System prompt builder ──────────────────────────────────────────────────

// An agent's personal reply-tone preference (Settings → Reply tone), injected
// as its own section. Shapes voice/phrasing only — never overrides a rule
// above it (identity checks, no invented promises, playbook/policy).
function toneInstructionSection(toneInstruction?: string): string {
  if (!toneInstruction) return ""
  return `\n\n## This agent's personal tone preference
${toneInstruction}
This shapes HOW you write — voice, phrasing, formality — it never overrides any rule above: still no invented promises or fake account checks, still verify identity before sensitive actions, still follow the playbook/policy exactly.`
}

export function buildSystemPrompt(
  playbook: PlaybookListItem | undefined,
  examples: ResponseItem[],
  agentName: string,
  articles: IntercomArticle[],
  hasAgentReplied = false,
  greetingInjected = false,
  toneInstruction?: string
): string {
  const parts: string[] = []

  parts.push(`You are a support copilot for ${agentName}, a senior support agent at Fanvue — a creator subscription platform (AI creators and human creators both use it).

Your task: write a warm, helpful customer-facing reply to the conversation below.

## Context hierarchy (most to least important)
1. **The conversation thread** — this is your primary context. Read the full exchange to understand what has already been said, asked, and answered.
2. **Internal knowledge base articles** — these are your factual source of truth. Reference them for policy, steps, and procedures.
3. **The playbook** — guides the type of case and provides resolution guidance, dos/donts, and example responses.

Playbooks cover only some cases — when the thread and the playbook disagree, the thread wins. Never let a playbook template override what this specific conversation actually needs.

${RULE_PRECEDENCE}

${GOOD_REPLY_SHAPE}

## Respond to the latest message
- You are writing the **next message in an ongoing conversation**, not a standalone reply. It must read like a natural continuation of THIS thread.
- Anchor your reply on the customer's **most recent message**. Everything earlier is background; the last message is what you are actually answering.
- Do NOT repeat greetings, explanations, policies, or steps already stated earlier in the thread — assume the customer has read them. Move the conversation forward; don't restate the last thing.
- If the customer's latest message is a reaction or emotion (resignation, frustration, thanks, "ok I'll do it") rather than a new question, respond to *that* — acknowledge how they feel and reassure — instead of re-explaining policy they've already been given.

## Tone rules
- Warm, personal, first-person. Light emoji (👋 😊 💛) — 1-2 max, never forced.
${greetingToneRule(hasAgentReplied, greetingInjected)}
- Never use the customer's real name.
- Use **bold** for key requirements or action steps.
- Use short bullet lists when listing multiple steps (4 max).
- End with exactly one clear call-to-action **when the reply actually needs one**. A reply that confirms something already answered and closes the conversation does not need an ask bolted onto it — never invent a question or a next step just to have something to end on.
- No sign-off and NO signature of any kind. Never write your own name, initials, a title, or a closing like "- Vincenzo", "Best, <name>", "Warm regards", or "Fanvue Support Team". You do not have a personal name to give — end on the last line of the answer itself. (You are drafting AS the agent; never state or invent the agent's name.)
- Never promise timelines, refunds, or exceptions not stated in the playbook or articles.

## Critical constraints
- Output ONLY the customer-facing message text — ready to copy-paste.
- The draft IS markdown: use **bold**, bullet lists, and line breaks for readability.
- No intro like "Here's a draft:", no markdown headers (no ##, no ###), no internal commentary.
- Personalize to the customer's specific situation without using their real name.
- If the playbook and articles don't cover the issue, **read the thread before asking anything**: if the answer is already in it, or an agent already gave it, confirm that instead. Only when the answer genuinely is not available anywhere should you acknowledge warmly and ask one focused clarifying question.
- ${ENGLISH_ONLY_RULE}

${CAPABILITY_BOUNDARY_RULES}

${POLICY_INTEGRITY_RULES}

${PAYMENT_DISPUTE_RULES}

${REFUND_POSTURE_RULES}

${CONVERSATION_CLOSURE_RULES}

${AGENT_IDENTITY_RULES}${toneInstructionSection(toneInstruction)}`)

  if (playbook) {
    const sections: string[] = [`\n## Playbook: ${playbook.caseType}`]
    if (playbook.recognize) sections.push(`**When to use:** ${playbook.recognize}`)
    if (playbook.checks) sections.push(`**Checks to do before replying (mandatory, do not skip):**\n${playbook.checks}`)
    if (playbook.resolution) sections.push(`**Resolution guidance:**\n${playbook.resolution}`)
    if (playbook.dosDonts) sections.push(`**Important — do not:** ${playbook.dosDonts}`)
    parts.push(sections.join("\n\n"))
  }

  if (articles.length > 0) {
    const articleSection = [`\n## Internal knowledge base articles (use as reference)`]
    for (const art of articles) {
      const snippet = [`### ${art.title}`]
      if (art.description) snippet.push(`*${art.description}*`)
      snippet.push(art.bodySnippet)
      articleSection.push(snippet.join("\n\n"))
    }
    parts.push(articleSection.join("\n\n"))
  }

  if (examples.length > 0) {
    const exSection = [`\n## Example responses (style reference only — do not copy verbatim)`]
    for (const ex of examples.slice(0, 2)) {
      const body = ex.body.replace(/^FR:\s*/i, "").trim()
      exSection.push(`### ${ex.title}\n${body}`)
    }
    parts.push(exSection.join("\n\n"))
  }

  return parts.join("\n\n")
}

// ── Slack-aware system prompt builder ──────────────────────────────────────

export type SlackThreadReply = {
  userName: string
  text: string
  ts: string
}

export function buildSlackAwareSystemPrompt(
  playbook: PlaybookListItem | undefined,
  examples: ResponseItem[],
  agentName: string,
  articles: IntercomArticle[],
  slackThread: { channelName: string; replies: SlackThreadReply[] }
): string {
  const base = buildSystemPrompt(playbook, examples, agentName, articles)

  const threadLines = slackThread.replies.map(
    (r) => `${r.userName}: ${r.text}`
  )

  const slackSection = `\n\n## Slack thread context (internal)
Below is an internal Slack thread from the #${slackThread.channelName} channel discussing this customer's case.

Use this as context ONLY — do NOT copy the internal language verbatim.

Thread:
${threadLines.join("\n")}

## Important: translate internal language
The Slack thread above contains internal team discussion. When writing the customer-facing reply, follow these rules:

- Convert internal language into clear, professional customer-facing wording.
- Do NOT expose: internal system names, Slack messages as quoted text, staff names, IDs, moderation labels, or backend details.
- Do NOT use phrases like: "admin notes," "internal review notes," "workflow," "we flagged you internally," "ticket," "case," or "escalated to the team."
- Use only neutral customer-facing wording supported by the Slack thread. Do not say "I've reviewed your account", "after checking", or similar unless the thread explicitly says a real account/tool review was completed and what it found.
- When the Slack thread does explicitly support a real review, check, or decision, use first-person customer-facing wording such as "I've reviewed your account" or "I can confirm" as appropriate.
- Do NOT mention that a Slack thread or workflow exists. The customer should never know about internal tools.
- If the thread contains conflicting opinions, use the most recent decision or the playbook's guidance.
- If the thread contains instructions from senior staff, follow them but rephrase them in customer-facing language.
- Maintain the same warm, first-person tone from the main prompt.`

  return base + slackSection
}

// ── Notion-aware system prompt builder ─────────────────────────────────────
// Used for the "tail" (no confident playbook): grounds the draft in fresh
// Notion retrieval (lib/notion-retrieval) while firewalling connector/internal
// content out of the customer-facing text. See spec D10. Mirrors the
// Slack-aware builder above.

export function buildNotionAwareSystemPrompt(
  playbook: PlaybookListItem | undefined,
  examples: ResponseItem[],
  agentName: string,
  articles: IntercomArticle[],
  notionSnippets: NotionSnippet[],
  hasAgentReplied = false,
  greetingInjected = false,
  toneInstruction?: string
): string {
  const base = buildSystemPrompt(
    playbook,
    examples,
    agentName,
    articles,
    hasAgentReplied,
    greetingInjected,
    toneInstruction
  )
  if (notionSnippets.length === 0) return base

  const citable = notionSnippets.filter((s) => classifyNotionSnippetUse(s) === "customerSafe")
  const internal = notionSnippets.filter((s) => classifyNotionSnippetUse(s) === "internalOnly")
  const transientExpired = notionSnippets.filter((s) => classifyNotionSnippetUse(s) === "transientExpired")

  const sections: string[] = [`\n\n## Fresh knowledge from Notion (retrieved for this case)`]

  if (citable.length > 0) {
    const lines = citable.map((s, i) => `[${i + 1}] ${s.title}: ${s.text}`)
    sections.push(
      `### Support knowledge — you MAY ground your reply on this (paraphrase, never paste)\n${lines.join("\n")}`
    )
  }

  if (internal.length > 0) {
    const lines = internal.map((s) => `- (${s.source}) ${s.title}: ${s.text}`)
    sections.push(
      `### Internal context — DO NOT quote or reveal to the customer\nThese come from internal/connected sources (Slack, Drive, Linear, etc.). Use them ONLY to reason about what is true and what to do internally — never repeat them to the customer.\n${lines.join("\n")}`
    )
  }

  if (transientExpired.length > 0) {
    const lines = transientExpired.map((s) => `- (${s.source}; timestamp: ${s.timestamp ?? "unknown"}) ${s.title}: ${s.text}`)
    sections.push(
      `### Expired or unverified transient context — DO NOT assert to the customer\nThese results mention temporary states such as outages, incidents, degraded service, known bugs, or workarounds, but they are too old or lack a usable timestamp for customer-facing claims. Use them only as an internal hint to verify current status before sending.\n${lines.join("\n")}`
    )
  }

  sections.push(`## Firewall rules for the Notion knowledge above
- The customer-facing reply must be **your own paraphrase** in Fanvue tone — never paste a snippet verbatim.
- Ground the reply only on the **Support knowledge** items, the knowledge base articles, and the playbook. Treat the **Internal context** items as background reasoning only.
- Never reveal: internal plans/roadmap, other users' data or flags, Slack channel names, staff names, document names, system/tool names, or that any internal source exists.
- Notion snippets are knowledge/search context, not live account data. Never treat a Notion result as proof that this customer's profile, payout, KYC, or media was checked.
- Never tell a customer that Fanvue is currently in an outage, incident, degraded state, or active bug based on **Internal context** or **Expired or unverified transient context**. Ask the agent to verify current status instead.
- If the only relevant information is in the Internal context, do not invent a customer answer — acknowledge warmly and ask one focused clarifying question, or hold the policy line.`)

  return base + sections.join("\n\n")
}

// ── Evidence-based grounding (retrieval v2) ────────────────────────────────
//
// Replaces the winner-take-all playbook injection above. The measured problem:
// a matched playbook produced WORSE drafts than no match at all (57.6% vs
// 67.5% approve, n=1,201), because the gate picks exactly one playbook out of
// 61 and the model then writes confident prose grounded in whatever it picked.
//
// Three changes here:
//   1. Ranked passages, not one document — a playbook is now one kind of
//      evidence alongside approved macros and response templates.
//   2. Every passage is numbered so the model can be told to ground claims in
//      a specific citation instead of the general vibe of the context.
//   3. Abstaining is stated as a correct outcome. "No playbook matched" was
//      already the better-performing path; this makes it deliberate rather
//      than accidental.

/** Minimal shape the prompt needs. Deliberately decoupled from search.ts. */
export type EvidencePassage = {
  title: string
  headingPath: string | null
  sourceKind: string
  content: string
  visibility: "customer_safe" | "internal_only"
}

/**
 * Builds the evidence block. Customer-safe and internal passages are rendered
 * as separate sections with different permissions — the fourth and final layer
 * of the firewall (column default, SQL include_internal, partitionByVisibility,
 * then this).
 */
export function buildEvidenceSection(passages: EvidencePassage[]): string {
  if (passages.length === 0) {
    return `## Retrieved knowledge
Nothing in the knowledge base matched this case with enough confidence to ground a factual answer.

- Do NOT guess, and do NOT reach for a loosely-related policy — a confident wrong answer is worse here than no answer.
- Acknowledge the customer warmly, answer only what the thread itself supports, and ask ONE focused question that would let you resolve it.
- If the case needs a system check you can't do from the thread, say you're looking into it on your side.`
  }

  const customerSafe = passages.filter((p) => p.visibility === "customer_safe")
  const internalOnly = passages.filter((p) => p.visibility !== "customer_safe")

  const sections: string[] = [`## Retrieved knowledge (ranked by relevance to THIS case)`]

  if (customerSafe.length > 0) {
    const lines = customerSafe.map((p, i) => {
      const where = p.headingPath ? ` — ${p.headingPath}` : ""
      return `[${i + 1}] ${p.title}${where} (${p.sourceKind})\n${p.content}`
    })
    sections.push(
      `### Support knowledge — you MAY ground the customer-facing reply on these\n${lines.join("\n\n")}`
    )
  }

  if (internalOnly.length > 0) {
    const offset = customerSafe.length
    const lines = internalOnly.map((p, i) => {
      const where = p.headingPath ? ` — ${p.headingPath}` : ""
      return `[${offset + i + 1}] ${p.title}${where} (${p.sourceKind})\n${p.content}`
    })
    sections.push(
      `### Internal context — DO NOT quote or reveal to the customer\nThese are internal agent procedure (playbooks, Slack, Drive, Linear). Use them ONLY to reason about what is true and what to do internally — never repeat them, never name the source, never mention that an internal source exists.\n${lines.join("\n\n")}`
    )
  }

  sections.push(`### How to use the evidence
- Every factual claim about Fanvue policy, process, or timelines must come from a passage above. If a claim isn't supported there or by the thread itself, don't make it.
- Prefer **Support knowledge** wording as your basis; paraphrase in Fanvue tone rather than pasting verbatim.
- Internal context shapes what you do, never what you say. If the only relevant material is internal, acknowledge warmly and ask one focused question or hold the policy line.
- Retrieved knowledge is documentation, not live account data. It is never proof that THIS customer's payout, KYC, profile, or media was checked.
- The passages are ranked, not guaranteed. If none of them actually fits what the customer asked, say so plainly and ask a question instead of stretching the closest one to fit.`)

  return sections.join("\n\n")
}

/**
 * The v2 system prompt: the same rule stack as buildSystemPrompt (identity,
 * capability, policy, payment-dispute, tone), with the single-playbook block
 * and Notion highlights swapped for ranked evidence.
 */
export function buildEvidenceSystemPrompt(
  passages: EvidencePassage[],
  agentName: string,
  articles: IntercomArticle[],
  hasAgentReplied = false,
  greetingInjected = false,
  toneInstruction?: string
): string {
  const base = buildSystemPrompt(
    undefined,
    [],
    agentName,
    articles,
    hasAgentReplied,
    greetingInjected,
    toneInstruction
  )
  return `${base}\n\n${buildEvidenceSection(passages)}`
}

// ── User message builder ───────────────────────────────────────────────────

export function buildUserMessage(
  conversation: DraftConversation,
  images?: DraftImage[],
  imageEvidence?: string | null,
  hasAgentReplied = false,
  hasKnownEmail = false
): string | OpenAIContentPart[] {
  const parts = [customerPrivacyHeader(hasKnownEmail), todaysDateLine()]

  // Include the full conversation thread so the AI has complete context
  parts.push(`\nConversation thread:`)
  parts.push(`Customer: ${conversation.firstMessage}`)

  for (const msg of conversation.messages) {
    if (!msg.body.trim()) continue
    const label =
      msg.role === "admin"
        ? "Agent"
        : msg.role === "ai"
          ? "AI helper"
          : "Customer"
    parts.push(`${label}: ${msg.body}`)
  }

  if (images && images.length > 0) {
    parts.push(
      `\nThe customer attached ${images.length} image(s) below. Use them as factual evidence — read any error codes, amounts, IDs, or document details shown — but never infer policy from an image; cite playbooks as usual.`
    )
  }

  if (imageEvidence?.trim()) {
    parts.push(`\nCustomer image evidence (internal vision analysis):`)
    parts.push(imageEvidence.trim())
    parts.push(
      `Use the image evidence only as factual context from the customer's attachment(s). Do not mention internal vision analysis, and do not infer policy from the image.`
    )
  }

  parts.push(
    `\nThe latest Customer message above is what you are replying to. Agent and AI helper messages are context about what has already been said or suggested; do not treat them as customer requests. Write the next message in this conversation, anchored on the latest customer message and the context already exchanged. Follow the tone and context rules above (${hasAgentReplied ? "you have already personally replied earlier in this thread — do not greet again" : "you have not personally replied in this thread yet — open with a greeting"}), and do not repeat anything already said earlier in the thread.`
  )
  parts.push(`\n${ENGLISH_ONLY_REMINDER}`)
  const text = parts.join("\n")

  if (!images || images.length === 0) return text

  return [
    { type: "text", text },
    ...images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: img.dataUri },
    })),
  ]
}

export function buildVisionEvidenceMessages(
  conversation: DraftConversation,
  images: DraftImage[]
): OpenAIMessage[] {
  const thread = buildUserMessage(conversation)
  const text = [
    "Extract only factual evidence from the customer's attached image(s) for a support agent.",
    "Return concise bullets. Include visible error messages, amounts, dates, account/status labels, document fields, IDs, and what screen/page is shown.",
    "Do not guess policy, do not decide the reply, and do not invent anything not visible.",
    "Use the conversation only to disambiguate what matters.",
    "",
    typeof thread === "string" ? thread : "",
  ].join("\n")

  return [
    {
      role: "system",
      content:
        "You are a vision evidence extractor for Fanvue Support. You only describe what is visible in attached customer images.",
    },
    {
      role: "user",
      content: [
        { type: "text", text },
        ...images.map((img) => ({
          type: "image_url" as const,
          image_url: { url: img.dataUri },
        })),
      ],
    },
  ]
}

export async function buildGroundedDraftUserMessage(
  conversation: DraftConversation,
  images: DraftImage[],
  hasAgentReplied = false,
  hasKnownEmail = false
): Promise<string | OpenAIContentPart[]> {
  if (images.length === 0) return buildUserMessage(conversation, undefined, undefined, hasAgentReplied, hasKnownEmail)

  let imageEvidence = ""
  try {
    for await (const chunk of streamChatCompletion(buildVisionEvidenceMessages(conversation, images), {
      model: getAuxDraftModel(),
      maxTokens: 1536,
      // Reading facts off a screenshot needs no deliberation, and reasoning
      // tokens would eat into the 1536 budget before any text is emitted.
      reasoningEffort: "none",
    })) {
      imageEvidence += chunk
    }
  } catch {
    return buildUserMessage(conversation, images, undefined, hasAgentReplied, hasKnownEmail)
  }

  if (!imageEvidence.trim()) return buildUserMessage(conversation, images, undefined, hasAgentReplied, hasKnownEmail)

  return buildUserMessage(conversation, [], imageEvidence, hasAgentReplied, hasKnownEmail)
}

// ── Improve-an-existing-draft builders ─────────────────────────────────────

export function buildImproveSystemPrompt(agentName: string, toneInstruction?: string): string {
  return `You are a support copilot for ${agentName}, a senior support agent at Fanvue.

Your task: IMPROVE the existing customer-facing reply draft provided below — do not write a new reply from scratch.

${RULE_PRECEDENCE}

${GOOD_REPLY_SHAPE}

## How to improve
- Keep the draft's meaning, facts, policy, and intent EXACTLY. Never add policy, promises, timelines, or steps that aren't already there.
- Improve tone (warm, personal, first-person, Fanvue voice), clarity, flow, and completeness.
- Light emoji (👋 😊 💛) — 1-2 max, never forced. Use **bold** for key steps; short bullet lists (4 max).
- Do not greet again if the thread shows an agent already replied.

## Critical constraints
- Output ONLY the improved customer-facing message text — ready to copy-paste. No "Here's the improved version:", no headers, no commentary.
- The output IS markdown.
- Never use the customer's real name.
- No signature: never add or keep your own name, initials, or a "- <name>" / "Best, <name>" sign-off. If the draft already has one, remove it.
- ${ENGLISH_ONLY_RULE}

${CAPABILITY_BOUNDARY_RULES}

${POLICY_INTEGRITY_RULES}

${PAYMENT_DISPUTE_RULES}

${REFUND_POSTURE_RULES}

${CONVERSATION_CLOSURE_RULES}

${AGENT_IDENTITY_RULES}${toneInstructionSection(toneInstruction)}`
}

export function buildImproveUserMessage(
  conversation: {
    customer: string
    firstMessage: string
    messages: { role: string; body: string }[]
  },
  currentDraft: string,
  hasKnownEmail = false
): string {
  const parts = [customerPrivacyHeader(hasKnownEmail), `\nConversation thread:`]
  parts.push(`Customer: ${conversation.firstMessage}`)
  for (const msg of conversation.messages) {
    if (!msg.body.trim()) continue
    parts.push(`${msg.role === "admin" ? "Agent" : "Customer"}: ${msg.body}`)
  }
  parts.push(`\n## Current draft to improve\n${currentDraft}`)
  parts.push(`\nRewrite the draft above per the rules. Output only the improved message.`)
  parts.push(`\n${ENGLISH_ONLY_REMINDER}`)
  return parts.join("\n")
}

// ── Macro adaptation user message ─────────────────────────────────────────
// The macro-adapt path must NOT reuse buildUserMessage: that ends with "Write
// the next message in this conversation…", which a flash model follows over the
// system instruction → it writes a generic draft and ignores the macro. This
// builder presents the thread but anchors the task on the macro instead.

export function buildMacroAdaptUserMessage(
  conversation: {
    customer: string
    firstMessage: string
    messages: { role: string; body: string }[]
  },
  hasKnownEmail = false
): string {
  const parts = [customerPrivacyHeader(hasKnownEmail)]

  parts.push(`\nConversation thread:`)
  parts.push(`Customer: ${conversation.firstMessage}`)

  for (const msg of conversation.messages) {
    if (!msg.body.trim()) continue
    const label =
      msg.role === "admin"
        ? "Agent"
        : msg.role === "ai"
          ? "AI helper"
          : "Customer"
    parts.push(`${label}: ${msg.body}`)
  }

  parts.push(
    `\nNow take the **approved macro from the system message** and rewrite it so it fits this conversation, anchored on the latest Customer message. Agent and AI helper messages are context only; do not treat them as customer requests. Always output a complete customer-facing message. Your reply MUST be built from the macro's content — keep its facts, policy, steps and links, and tailor the wording to this case. Do NOT write a fresh, unrelated reply, and do NOT add anything the macro and thread don't support. Output only the customer-facing message.`
  )
  parts.push(`\n${ENGLISH_ONLY_REMINDER}`)
  return parts.join("\n")
}

// ── Focused Slack thread translation prompt ───────────────────────────────
// Used by /api/draft/from-slack — purely translates internal Slack discussion
// into customer-facing wording. No playbooks, no KB articles, no extra context.

export function buildSlackTranslationPrompt(
  channelName: string,
  replies: SlackThreadReply[],
  toneInstruction?: string
): string {
  const threadLines = replies.map((r) => `${r.userName}: ${r.text}`)

  return `You are a support agent at Fanvue — a creator subscription platform.

Your task: rewrite the internal Slack thread below into a clear, professional customer-facing reply.

## Rules
- Convert internal language into clear, professional customer-facing wording.
- Do NOT expose: internal system names, Slack messages as quoted text, staff names, IDs, moderation labels, or backend details.
- Do NOT use phrases like: "admin notes," "internal review notes," "workflow," "we flagged you internally," "ticket," "case," or "escalated to the team."
- Use only neutral customer-facing wording supported by the Slack thread. Do not say "I've reviewed your account", "after checking", or similar unless the thread explicitly says a real account/tool review was completed and what it found.
- When the Slack thread does explicitly support a real review, check, or decision, use first-person customer-facing wording such as "I've reviewed your account" or "I can confirm" as appropriate.
- Do NOT mention that a Slack thread or workflow exists. The customer should never know about internal tools.
- If the thread contains conflicting opinions, use the most recent decision.
- If the thread contains instructions from senior staff, follow them but rephrase them.
- Maintain a warm, professional first-person tone.
- Output ONLY the customer-facing message — ready to copy-paste. No intro, no markdown headers, no internal commentary.
- Never promise timelines, refunds, or exceptions not stated in the thread.
- ${ENGLISH_ONLY_RULE}

${CAPABILITY_BOUNDARY_RULES}

${POLICY_INTEGRITY_RULES}

${PAYMENT_DISPUTE_RULES}

${REFUND_POSTURE_RULES}

${AGENT_IDENTITY_RULES}${toneInstructionSection(toneInstruction)}
## Internal Slack thread (from #${channelName})
${threadLines.join("\n")}

${ENGLISH_ONLY_REMINDER}

Write the customer-facing reply now:`
}

// ── Macro adaptation prompt ────────────────────────────────────────────────
// Used by /api/draft/adapt-macro — takes an approved (Intercom-synced) macro's
// plain text and the conversation, and rewrites the macro to fit THIS specific
// case in Fanvue tone. Draft-only: the result is shown for review, never sent.
// See spec D9.

export function buildMacroAdaptSystemPrompt(
  macroBodyText: string,
  agentName: string,
  hasAgentReplied = false,
  toneInstruction?: string
): string {
  return `You are a support copilot for ${agentName}, a senior support agent at Fanvue — a creator subscription platform (AI creators and human creators both use it).

Your task: **rewrite the approved macro below** so it fits this specific conversation. The macro is canned, approved text and it is your STARTING MATERIAL — you are tailoring it, **not** writing a fresh reply from scratch. Reshape it so it reads as a natural reply to what THIS customer actually asked, but every claim must come from the macro (or the thread).

${RULE_PRECEDENCE}

${GOOD_REPLY_SHAPE}

## How to adapt
- Keep the macro's **facts, policy, requirements, steps, and links exactly** — do not change, soften, or embellish what it states.
- **Do not invent** any policy, requirement, timeline, refund, or exception that is not already in the approved macro or the conversation thread. If the macro doesn't say it, you don't say it.
- Rephrase the macro to address the customer's specific question and situation — drop parts that clearly don't apply, reorder so the most relevant point comes first, and connect it to what they actually wrote.
- Read the full thread: do not repeat greetings, policies, or steps the customer has already been given earlier. Pick up naturally where the conversation is.

## Tone rules
- Warm, personal, first-person. Light emoji (👋 😊 💛) — 1-2 max, never forced.
${greetingToneRule(hasAgentReplied, false)}
- Never use the customer's real name.
- Use **bold** for the key requirements or action steps.
- Use short bullet lists when listing multiple steps (4 max).
- End with exactly one clear call-to-action **when the reply actually needs one** — never invent an ask just to have something to close on.
- No sign-off and NO signature of any kind: never write your own name, initials, a title, or a closing like "- Vincenzo", "Best, <name>", or "Fanvue Support Team". End on the last line of the answer itself.

## Critical constraints
- Output ONLY the customer-facing message text (markdown) — ready to copy-paste.
- Never return an empty message. If the macro is thin, still produce a complete customer-facing reply grounded in the macro.
- No preamble like "Here's the adapted macro:", no markdown headers (no ##, no ###), no internal commentary.
- ${ENGLISH_ONLY_RULE}

${CAPABILITY_BOUNDARY_RULES}

${POLICY_INTEGRITY_RULES}

${PAYMENT_DISPUTE_RULES}

${REFUND_POSTURE_RULES}

${CONVERSATION_CLOSURE_RULES}

${AGENT_IDENTITY_RULES}${toneInstructionSection(toneInstruction)}
## Approved macro to adapt
${macroBodyText}`
}

// Minimal factual grounding for the verifier: playbook resolution + KB
// articles + citable Notion snippets — WITHOUT the instructional/behavioral
// rules (identity, tone, capability-boundary, policy-integrity, personal tone
// preference) that the generation prompt needs but a grounding check doesn't.
// Those rules are ~half the original system prompt's tokens and irrelevant to
// "is this claim supported by the source material" — passing them to the
// verifier every call was pure waste, since the verifier re-sends its whole
// input as "source context" on top of the draft itself.
export function buildVerifierGroundingContext(
  playbook: PlaybookListItem | undefined,
  articles: IntercomArticle[],
  notionSnippets: NotionSnippet[] = []
): string {
  const sections: string[] = []

  if (playbook) {
    const parts: string[] = [`## Playbook: ${playbook.caseType}`]
    if (playbook.checks) parts.push(`Required checks:\n${playbook.checks}`)
    if (playbook.resolution) parts.push(`Resolution guidance:\n${playbook.resolution}`)
    if (playbook.dosDonts) parts.push(`Do not:\n${playbook.dosDonts}`)
    sections.push(parts.join("\n\n"))
  }

  if (articles.length > 0) {
    const parts = [`## Knowledge base articles`]
    for (const art of articles) parts.push(`### ${art.title}\n${art.bodySnippet}`)
    sections.push(parts.join("\n\n"))
  }

  const citable = notionSnippets.filter((s) => classifyNotionSnippetUse(s) === "customerSafe")
  if (citable.length > 0) {
    const lines = citable.map((s, i) => `[${i + 1}] ${s.title}: ${s.text}`)
    sections.push(`## Notion knowledge\n${lines.join("\n")}`)
  }

  return sections.join("\n\n")
}

export function buildDraftVerifierMessages(
  sourceMessages: OpenAIMessage[],
  draft: string
): OpenAIMessage[] {
  const sourceText = sourceMessages
    .map((m) => {
      const content = Array.isArray(m.content)
        ? m.content
            .map((part) => (part.type === "text" ? part.text : "[image omitted from verifier]"))
            .join("\n")
        : m.content
      return `${m.role.toUpperCase()}:\n${content}`
    })
    .join("\n\n")

  return [
    {
      role: "system",
      content: `You are a strict grounding verifier for Fanvue Support drafts.

Rewrite the draft only as much as needed so every factual claim is supported by the provided source context.

Rules:
- Preserve the customer's language requirement: final output in English only.
- Output only the corrected customer-facing draft. No commentary.
- Remove or soften any claim that says the agent checked, reviewed, saw, confirmed, updated, escalated, refunded, approved, rejected, or changed an account/profile/content/payout/KYC/media unless the source context explicitly proves that action/result.
- **DELETE any advice to dispute a charge.** If the draft tells the customer to dispute, reverse, cancel, or report a charge as unauthorised with their bank, card issuer, or wallet (Apple Pay / Apple Cash, Google Pay, PayPal) — including "Report an Issue" / "Report a Problem" flows — cut it entirely. Fanvue's zero-tolerance chargeback policy means that advice would get the customer's own account banned. Replace it with the internal next step: we look the transaction up (BIN + last 4) or raise it with the payments/fraud team. Never ask for a full card number, expiry, or CVV.
- If the draft treats a **pending** charge as money taken, correct it: a pending or "not paid" transaction is an authorisation hold that the customer's bank releases automatically within a few days.
- Never invent Fanvue policy, account status, profile state, payout status, KYC result, media-review outcome, or timelines.
- If a live tool/profile/account check would be needed, phrase it as a future/needed check without claiming it already happened.
- **Do not let the draft re-open a settled point.** If the source thread shows a Fanvue agent already gave this customer an answer or outcome, cut anything in the draft that contradicts it, hedges it, or announces that it now needs checking after all. Re-affirming the answer already given is the correct output.
- **Cut asks for information the reply does not need.** Delete requests for dates, card digits, screenshots, or "please confirm" details when the thread already contains them, or when the customer's question can be answered without them.
- **On a refund request with no qualifying ground evidenced in the source, cut the stall and cut the coaching.** Delete any promise to "review your refund request", "look into this and come back to you", or otherwise treat the outcome as still open — Fanvue's no-refund policy is the answer and it belongs in this reply. Also delete any passage that tells the customer which circumstances WOULD qualify for a refund, or that fishes for one ("was there a problem with the content?"); naming the exemptions coaches them into manufacturing a claim. A plain, warm no plus the cancellation step is the correct output.
- **Delete a second greeting.** If the draft opens with a salutation or thanks line ("Hello", "Hi", "Hey", "Dear …", "Thanks for reaching out", "Thank you for contacting us") on top of a greeting already present in the source context or prepended to the message, cut it so the reply starts on the substance. Only one greeting per message.
- Keep the warm support tone and markdown readability. End on exactly one clear call-to-action **when the reply needs one** — a draft that simply confirms an answer and closes the conversation should not have an ask bolted onto it. Never lengthen a short, correct confirming draft.`,
    },
    {
      role: "user",
      content: `## Source context
${sourceText}

## Draft to verify
${draft}

Return the corrected draft now.`,
    },
  ]
}

// Transient statuses worth a retry (rate limit + upstream/gateway hiccups).
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError"
}

// Backoff sleep that resolves early (rejecting) if the caller aborts. When the
// server hands us an explicit Retry-After (a 429 window), honour it — clamped to
// [RETRY_BASE_MS, RATE_LIMIT_MAX_MS] — instead of the short network backoff.
function backoffDelay(
  attempt: number,
  signal?: AbortSignal,
  explicitMs?: number | null
): Promise<void> {
  const ms =
    explicitMs != null
      ? Math.min(Math.max(explicitMs, RETRY_BASE_MS), RATE_LIMIT_MAX_MS)
      : Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true }
    )
  })
}

// POST to OpenAI with a connect (time-to-first-byte) timeout and bounded retry
// on transient PRE-stream failures. Never retries once bytes are flowing — a
// partial stream can't be safely replayed. Honours an external abort signal.
async function openCompletionStream(body: string, signal?: AbortSignal): Promise<Response> {
  const baseUrl = openaiBaseUrl()
  const apiKey = openaiApiKey()
  let attempt = 0
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const connectController = new AbortController()
    const onAbort = () => connectController.abort()
    signal?.addEventListener("abort", onAbort, { once: true })
    const connectTimer = setTimeout(() => connectController.abort(), CONNECT_TIMEOUT_MS)

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: connectController.signal,
      })

      if (res.ok) return res

      const text = await res.text().catch(() => "unknown error")
      if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
        const retryAfterMs =
          res.status === 429 ? parseRetryAfterMs(res.headers.get("retry-after")) : null
        await backoffDelay(attempt++, signal, retryAfterMs)
        continue
      }
      throw new Error(`AI API error (${res.status}): ${text}`)
    } catch (err) {
      // A caller-driven abort is final — surface it, never retry.
      if (signal?.aborted) throw err
      // A connect-timeout or network error is retryable up to the cap.
      const timedOut = isAbortError(err) // our connect timer fired
      const isApiError = err instanceof Error && err.message.startsWith("AI API error")
      if (isApiError) throw err
      if (attempt < MAX_RETRIES) {
        await backoffDelay(attempt++, signal)
        continue
      }
      throw new Error(
        timedOut
          ? `AI API did not respond within ${CONNECT_TIMEOUT_MS}ms after ${attempt + 1} attempts`
          : `AI API unreachable after ${attempt + 1} attempts: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      clearTimeout(connectTimer)
      signal?.removeEventListener("abort", onAbort)
    }
  }
}

export async function* streamChatCompletion(
  messages: OpenAIMessage[],
  options?: {
    maxTokens?: number
    model?: string
    // gpt-5.x reasoning knob: "none" | "low" | "medium" | "high" | "xhigh" | "max".
    // Replaces the `temperature` option this used to take — gpt-5.x rejects
    // temperature outright (400).
    reasoningEffort?: string
    signal?: AbortSignal
  }
): AsyncGenerator<string> {
  // Model precedence: explicit override → the app-wide default. No image branch
  // any more: Luna is multimodal, so the same model handles text turns and
  // pasted screenshots.
  const model = options?.model ?? getTextDraftModel()

  // `max_completion_tokens` (gpt-5.x rejects `max_tokens`) and no temperature
  // (also rejected — `reasoning_effort` is the knob instead).
  //
  // The budget covers REASONING TOKENS TOO, not just visible output: with a
  // reasoning effort above "none", too small a cap gets spent thinking and the
  // response comes back empty. Hence the roomier default.
  const maxTokens = options?.maxTokens ?? 8192
  const body = JSON.stringify({
    model,
    max_completion_tokens: maxTokens,
    reasoning_effort: options?.reasoningEffort ?? getDefaultReasoningEffort(),
    stream: true,
    messages,
  })

  // Every generation in the app shares one org key, so every generation goes
  // through the throttle. Hold one slot for the whole generation — from the
  // request through the last streamed byte — so concurrency is bounded by real
  // in-flight streams, not just request starts. Released in the finally below on
  // every exit path (done, stall, abort, throw).
  await acquireAiSlot(options?.signal)
  let slotReleased = false
  const releaseSlot = () => {
    if (!slotReleased) {
      slotReleased = true
      releaseAiSlot()
    }
  }

  let res: Response
  try {
    res = await openCompletionStream(body, options?.signal)
  } catch (err) {
    releaseSlot()
    throw err
  }

  const reader = res.body?.getReader()
  if (!reader) {
    releaseSlot()
    throw new Error("No response body from AI API")
  }

  const decoder = new TextDecoder()
  let buffer = ""

  try {
    for (;;) {
      // Stall guard: if no chunk arrives within STALL_TIMEOUT_MS (or the caller
      // aborts), stop waiting instead of blocking forever.
      let stallTimer: ReturnType<typeof setTimeout> | undefined
      const guard = new Promise<never>((_, reject) => {
        stallTimer = setTimeout(
          () => reject(new Error(`AI stream stalled — no data for ${STALL_TIMEOUT_MS}ms`)),
          STALL_TIMEOUT_MS
        )
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        )
      })

      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await Promise.race([reader.read(), guard])
      } finally {
        clearTimeout(stallTimer)
      }

      const { done, value } = result
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith("data: ")) continue
        const payload = trimmed.slice(6)
        if (payload === "[DONE]") return

        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[]
          }
          const content = parsed.choices?.[0]?.delta?.content
          if (content) yield content
        } catch {
          // skip malformed JSON chunks
        }
      }
    }
  } finally {
    // Release the upstream connection on stall/abort/early-return.
    reader.cancel().catch(() => {})
    releaseSlot()
  }
}
