/**
 * Behavioural eval for the draft prompt stack.
 *
 * The unit tests in lib/draft-ai.test.ts assert that rule TEXT is present in the
 * assembled prompt. That proves nothing about whether the model obeys it. This
 * script runs real generations against fixtures shaped like the failures agents
 * actually correct, and scores the output.
 *
 * ── Why these scenarios ─────────────────────────────────────────────────────
 * Derived from reply_queue_events (n=1,731, 2026-07-18 → 2026-08-18), not from
 * intuition. Measured there:
 *   - 61.8% approved unedited, 25.5% edited, 12.7% rejected.
 *   - Of the 414 scoreable edits, 85% SHORTENED the draft and 47% cut more than
 *     a quarter of it. Mean 603 → 433 chars. Agents cut; they almost never add.
 *   - Info requests ("please confirm/provide") were removed by the agent 58
 *     times and added 10. Screenshot asks: removed 56, added 19. "our team":
 *     removed 10, added 2. "get back to you": removed 6, added 0.
 *   - Rejects are NOT separable from approves on these features (22% vs 22% ask
 *     rate, confidence 0.82 vs 0.85), so rejects are correctness failures and
 *     out of scope here. This eval targets the EDIT signal, which is style.
 * Each scenario below encodes one of those measured behaviours.
 *
 * Every fixture is synthetic. This repo is public, so no real customer text,
 * handle, amount, or identifier is checked in.
 *
 * Usage:
 *   npx tsx scripts/eval-draft-behavior.mts --dry-run          # no API key needed
 *   npx tsx scripts/eval-draft-behavior.mts --runs=3
 *   npx tsx scripts/eval-draft-behavior.mts --scenario=confirm-and-close -v
 */
import { readFileSync } from "node:fs"

type Turn = { role: "customer" | "admin" | "ai"; body: string }
type Conversation = { customer: string; firstMessage: string; messages: Turn[] }

type Check = {
  id: string
  /** Describes the DEFECT. Returning true means the reply exhibits it. */
  hit: (reply: string) => boolean
  why: string
}

type Scenario = {
  id: string
  name: string
  /** The measured failure mode this fixture exists to catch. */
  basis: string
  conversation: Conversation
  /** Agent already replied in-thread, so no greeting is expected. */
  hasAgentReplied: boolean
  /** Character budget. Measured baseline: agent-final replies average 433. */
  maxChars: number
  checks: Check[]
}

// ── shared defect detectors ─────────────────────────────────────────────────
// Regexes are deliberately narrow. A false FAIL costs more than a missed one
// here: it trains you to ignore the eval.

const ASKS_TO_CONFIRM =
  /(could|can|would) you (please )?(confirm|clarify|provide|share|send|let me know)|please (confirm|provide|share|send|reply with)/i
const ASKS_SCREENSHOT = /screenshot|screen shot|photo of (the|your) (screen|page)/i
const ASKS_CARD_DETAILS = /last (4|four)|first (6|six)|\bBIN\b|transaction date|date of the (transaction|payment|charge)/i
const BOUNCES_TO_TEAM =
  /our (payments |support |compliance |moderation )?team will|get back to you|contact support|email .*support@|open a ticket|reach out to (our|the) team/i
const REOPENS_SETTLED =
  /needs? to be (checked|reviewed|investigated|looked into)|rather than assuming|shouldn't be treated as|will need to (check|verify|confirm)|let me (double[- ]?check|verify) (this|that|whether)/i
const HEDGES_THE_ANSWER =
  /(may|might|could) (still )?(be|have been)|it'?s possible that|I can'?t be (certain|sure)|in the meantime/i

const check = (id: string, hit: Check["hit"], why: string): Check => ({ id, hit, why })

const NO_CONFIRM_ASK = check("no-confirm-ask", (r) => ASKS_TO_CONFIRM.test(r), "asked the customer to confirm/provide something (removed by agents 58x, added 10x)")
const NO_SCREENSHOT = check("no-screenshot", (r) => ASKS_SCREENSHOT.test(r), "asked for a screenshot (removed 56x, added 19x)")
const NO_CARD_DETAILS = check("no-card-details", (r) => ASKS_CARD_DETAILS.test(r), "asked for card digits or a transaction date already settled in-thread")
const NO_TEAM_BOUNCE = check("no-team-bounce", (r) => BOUNCES_TO_TEAM.test(r), "bounced the customer to another team or the support queue")
const NO_REOPEN = check("no-reopen", (r) => REOPENS_SETTLED.test(r), "re-opened a point an agent had already settled in-thread")
const NO_HEDGE = check("no-hedge", (r) => HEDGES_THE_ANSWER.test(r), "hedged an answer that was already given plainly")

// ── scenarios ───────────────────────────────────────────────────────────────

const scenarios: Scenario[] = [
  {
    id: "confirm-and-close",
    name: "Fan asks yes/no confirmation of an answer already given",
    basis:
      "The live failure of 2026-08-18: the draft contradicted its own agent, said the transactions needed checking, and asked for a date + last 4 digits.",
    hasAgentReplied: true,
    maxChars: 420,
    conversation: {
      customer: "Test Fan",
      firstMessage: "i topped up my wallet but nothing showed up in my balance",
      messages: [
        { role: "customer", body: "i topped up my wallet but nothing showed up in my balance" },
        {
          role: "admin",
          body: "Thanks for flagging it. I've looked at the top-up on our side: it shows as not paid, which means the payment never actually reached us. Your bank will drop the charge off by itself once they update the record - nothing was taken.",
        },
        { role: "customer", body: "so the payment is an error and i will get my funds back right? i saw it is not pending, it says completed" },
        { role: "admin", body: "That's expected, yes. As mentioned, the payment never landed on our system." },
        // The message that, in production, got a draft re-opening the case.
        { role: "customer", body: "so i have to wait until i have my money back right but the payment was completed in my bank account i think its stuck" },
      ],
    },
    checks: [NO_REOPEN, NO_CONFIRM_ASK, NO_CARD_DETAILS, NO_SCREENSHOT, NO_HEDGE],
  },
  {
    id: "final-decision-held",
    name: "Refund already declined, customer repeats the demand louder",
    basis:
      "The 2026-08-12 failure: an incidental restated date let the draft reopen a decision already stated as final. Covered by the earlier verify-pushback-fix fixture; kept here so both live regressions sit in one harness.",
    hasAgentReplied: true,
    maxChars: 600,
    conversation: {
      customer: "Test Fan",
      firstMessage: "I want a refund for this charge",
      messages: [
        { role: "customer", body: "I want a refund for this charge" },
        {
          role: "admin",
          body: "I've checked the subscription: it included a 7-day free trial, and it converted to the normal price on schedule 7 days later - that's the charge you're seeing. It wasn't a billing error, so I'm not able to refund it. You've already cancelled, so there won't be another charge.",
        },
        { role: "customer", body: "I WANT MY MONEY BACK NOW!!!" },
        { role: "customer", body: "the date was the 13th not the 12th. give me my money back" },
      ],
    },
    checks: [NO_REOPEN, NO_CONFIRM_ASK, NO_CARD_DETAILS],
  },
  {
    id: "no-screenshot-fishing",
    name: "Creator states the problem clearly enough to answer",
    basis:
      "Screenshot asks appear in 120 edited drafts and agents strip them 56 times vs adding 19 - the second-largest measured edit reason.",
    hasAgentReplied: false,
    maxChars: 700,
    conversation: {
      customer: "Test Creator",
      firstMessage:
        "I have posted 6 pieces of media and my balance is 240 USD, which is over the minimum, but the Request Payout button still does nothing when I press it. Why can't I request a payout?",
      messages: [
        {
          role: "customer",
          body: "I have posted 6 pieces of media and my balance is 240 USD, which is over the minimum, but the Request Payout button still does nothing when I press it. Why can't I request a payout?",
        },
      ],
    },
    checks: [NO_SCREENSHOT, NO_TEAM_BOUNCE],
  },
  {
    id: "own-the-action",
    name: "Case needs an internal check the agent performs themselves",
    basis:
      "'our team' removed 10x vs added 2x; 'get back to you' removed 6x vs added 0. AGENT_IDENTITY_RULES exists for this and it still leaks.",
    hasAgentReplied: false,
    maxChars: 700,
    conversation: {
      customer: "Test Creator",
      firstMessage: "My payout says not paid but my bank details have not changed since the last one that worked.",
      messages: [
        {
          role: "customer",
          body: "My payout says not paid but my bank details have not changed since the last one that worked.",
        },
      ],
    },
    checks: [NO_TEAM_BOUNCE, NO_SCREENSHOT],
  },
]

// ── self-test ───────────────────────────────────────────────────────────────
// An eval that cannot fail is worse than no eval: it certifies whatever it is
// pointed at. These are drafts shaped like the ones agents actually corrected
// (paraphrased, no real customer text), and every detector must fire on its
// sample. Runs with no API key, so CI can prove the harness still has teeth.

const SELF_TEST: Array<{ check: Check; badReply: string }> = [
  {
    check: NO_REOPEN,
    badReply:
      "Since your bank shows the payment as completed, it shouldn't be treated as a temporary pending authorisation, so the transactions need to be checked rather than assuming the funds will automatically return.",
  },
  {
    check: NO_CONFIRM_ASK,
    badReply: "I'll look this up for you. Please provide the transaction date so we can match the payment accurately.",
  },
  {
    check: NO_CARD_DETAILS,
    badReply: "To match this up, could you send the last four digits of the card used?",
  },
  {
    check: NO_SCREENSHOT,
    badReply: "Thanks for explaining. Could you send a screenshot of your Earnings page so I can take a look?",
  },
  {
    check: NO_TEAM_BOUNCE,
    badReply: "I've passed this on and our payments team will get back to you as soon as they can.",
  },
  {
    check: NO_HEDGE,
    badReply: "It's possible that the charge may still settle differently. In the meantime, keep an eye on your statement.",
  },
]

// A clean reply that must trip NOTHING - guards against detectors so broad
// that they flag correct drafts and train you to ignore the eval.
const SELF_TEST_CLEAN =
  "Yes, that's right. Nothing else is needed from you - the charge never reached us, so your bank will drop it off on its own once they update the record."

function runSelfTest(): boolean {
  console.log("SELF-TEST - verifying every detector fires on a known-bad draft.\n")
  let ok = true
  for (const { check: c, badReply } of SELF_TEST) {
    const fired = c.hit(badReply)
    if (!fired) ok = false
    console.log(`  ${fired ? "OK  " : "DEAD"}  ${c.id}`)
  }
  const falsePositives = [...SELF_TEST.map((s) => s.check)].filter((c) => c.hit(SELF_TEST_CLEAN))
  if (falsePositives.length > 0) {
    ok = false
    console.log(`\n  FALSE POSITIVES on a known-good reply: ${falsePositives.map((c) => c.id).join(", ")}`)
  } else {
    console.log(`\n  OK    no detector fires on a known-good reply`)
  }
  console.log(`\n${ok ? "Detectors have teeth." : "BROKEN - a detector is dead or over-broad."}`)
  return ok
}

// ── env ─────────────────────────────────────────────────────────────────────
// lib/draft-ai.ts reads its key at import time, so ../lib/draft-ai must be
// imported dynamically AFTER process.env is populated below.

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
    }
  } catch {
    // fall through to process.env
  }
  return { ...env, ...process.env } as Record<string, string>
}

const env = loadEnv()
const dryRun = process.argv.includes("--dry-run")
const selfTest = process.argv.includes("--self-test")

if (selfTest) process.exit(runSelfTest() ? 0 : 1)

const verbose = process.argv.includes("-v") || process.argv.includes("--verbose")
const runsArg = process.argv.find((a) => a.startsWith("--runs="))
const runs = runsArg ? Math.max(1, Number(runsArg.split("=")[1])) : 2
const only = process.argv.find((a) => a.startsWith("--scenario="))?.split("=")[1]

if (!dryRun && (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === "[SENSITIVE]")) {
  console.error(
    "\nOPENAI_API_KEY is missing or a placeholder in .env.local.\n" +
      "Restore it to run a live eval, or pass --dry-run to check the assembled prompt only.\n"
  )
  process.exit(1)
}
if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY
if (env.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = env.OPENAI_BASE_URL

// ── run ─────────────────────────────────────────────────────────────────────

// Rules whose presence the dry run verifies. These are the load-bearing ones:
// if a refactor drops any, the live eval would regress silently.
const REQUIRED_RULES = [
  "When two rules in this prompt conflict",
  "A formatting rule is never a reason to add substance",
  "What a good reply looks like",
  "Length is not care, and a short reply is not a lazy one",
  "The default for an already-answered question is to agree and close it",
  "Never contradict, walk back, or cast doubt on an answer a Fanvue agent already gave",
  "when the reply actually needs one",
  "read the thread before asking anything",
]

async function main() {
  const { buildSystemPrompt, buildUserMessage, streamChatCompletion, getTextDraftModel, getDefaultReasoningEffort, REPLY_STYLE_NUDGE } =
    await import("../lib/draft-ai")

  const active = only ? scenarios.filter((s) => s.id === only) : scenarios
  if (active.length === 0) {
    console.error(`No scenario matching "${only}". Known: ${scenarios.map((s) => s.id).join(", ")}`)
    process.exit(1)
  }

  if (dryRun) {
    const prompt = `${buildSystemPrompt(undefined, [], "Agent", [], true, false)}\n\n${REPLY_STYLE_NUDGE}`
    console.log("DRY RUN - no model calls. Verifying the assembled prompt carries every load-bearing rule.\n")
    let ok = true
    for (const rule of REQUIRED_RULES) {
      const present = prompt.includes(rule)
      if (!present) ok = false
      console.log(`  ${present ? "OK  " : "MISS"}  ${rule}`)
    }
    console.log(`\nAssembled draft prompt: ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`)
    console.log(`\n${ok ? "All load-bearing rules present." : "MISSING RULES - the live eval would regress."}`)
    process.exit(ok ? 0 : 1)
  }

  console.log(`Model: ${getTextDraftModel()} | effort: ${getDefaultReasoningEffort()} | runs/scenario: ${runs}\n`)

  const results: Array<{ scenario: Scenario; passed: number; failures: Map<string, number>; lengths: number[] }> = []

  for (const s of active) {
    const systemPrompt = `${buildSystemPrompt(undefined, [], "Agent", [], s.hasAgentReplied, false)}\n\n${REPLY_STYLE_NUDGE}`
    const userMessage = buildUserMessage(s.conversation, undefined, undefined, s.hasAgentReplied, true)
    const failures = new Map<string, number>()
    const lengths: number[] = []
    let passed = 0

    console.log(`\n${"=".repeat(76)}\n${s.id}  -  ${s.name}\n${"=".repeat(76)}`)

    for (let i = 1; i <= runs; i++) {
      let reply = ""
      for await (const chunk of streamChatCompletion([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage as string },
      ])) {
        reply += chunk
      }
      reply = reply.trim()
      lengths.push(reply.length)

      const hits = s.checks.filter((c) => c.hit(reply))
      if (reply.length > s.maxChars) hits.push(check("too-long", () => true, `${reply.length} chars, budget ${s.maxChars} (agent-final mean is 433)`))
      for (const h of hits) failures.set(h.id, (failures.get(h.id) ?? 0) + 1)
      if (hits.length === 0) passed++

      console.log(`\n  Run ${i}/${runs}: ${hits.length === 0 ? "PASS" : "FAIL"}  (${reply.length} chars)`)
      for (const h of hits) console.log(`    - ${h.id}: ${h.why}`)
      if (verbose || hits.length > 0) console.log(`\n${reply.replace(/^/gm, "    | ")}`)
    }

    results.push({ scenario: s, passed, failures, lengths })
  }

  console.log(`\n\n${"=".repeat(76)}\nSUMMARY\n${"=".repeat(76)}`)
  let totalPass = 0
  let totalRuns = 0
  for (const r of results) {
    totalPass += r.passed
    totalRuns += runs
    const avgLen = Math.round(r.lengths.reduce((a, b) => a + b, 0) / r.lengths.length)
    const top = [...r.failures.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} x${n}`).join(", ")
    console.log(`  ${r.passed === runs ? "PASS" : "FAIL"}  ${r.scenario.id.padEnd(24)} ${r.passed}/${runs}  avg ${String(avgLen).padStart(4)} chars${top ? `  [${top}]` : ""}`)
  }
  console.log(`\n  ${totalPass}/${totalRuns} runs clean.\n`)
  process.exit(totalPass === totalRuns ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
