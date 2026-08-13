/**
 * Live regression check for the two draft-ai.ts fixes shipped 2026-08-12:
 *   1. todaysDateLine() timezone caveat (a customer-stated date up to one
 *      calendar day off server UTC is not a discrepancy).
 *   2. The "closing the conversation" rule now says a restated demand is not
 *      new information, so an incidental detail (like that date) shouldn't
 *      reopen a decision already stated as final.
 *
 * The conversation below is a synthetic reconstruction of the failure
 * pattern a live case actually hit (a Fadmin-verified 7-day-trial renewal,
 * correctly charged, refund declined) up through the two escalation messages
 * that, in production, got a draft that stalled on "which date did you
 * mean?" instead of holding the line. All names, handles, amounts, and
 * timestamps here are made up — this repo is public, so no real customer
 * data is checked in as a fixture.
 *
 * Usage:
 *   npx tsx scripts/verify-pushback-fix.mts [--runs=5]
 *
 * Needs OPENAI_API_KEY (reads .env.local, falls back to process.env — same
 * pattern as scripts/eval-retrieval.mts). Hits the real model each run, so
 * this is a manual verification tool, not part of `npm test`.
 */

import { readFileSync } from "node:fs"
import type { OpenAIMessage } from "../lib/draft-ai"

// ── env ─────────────────────────────────────────────────────────────────────
// lib/draft-ai.ts pulls its OpenAI key from a module-level const in
// lib/ai-throttle.ts, read once at import time — so `../lib/draft-ai` must be
// imported dynamically, AFTER process.env.OPENAI_API_KEY is set below. A
// static top-level import here would be hoisted ahead of that and always see
// whatever was in the shell's environment (usually nothing), not .env.local.

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
const isDryRun = process.argv.includes("--dry-run")
if (!isDryRun && (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === "[SENSITIVE]")) {
  console.error(
    "\nOPENAI_API_KEY is missing or a placeholder in .env.local.\n" +
      "Restore it (e.g. `vercel env pull --environment=production`) to run a live check,\n" +
      "or pass --dry-run to verify the assembled prompt without calling the model.\n"
  )
  process.exit(1)
}
if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY
if (env.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = env.OPENAI_BASE_URL

// ── a synthetic thread shaped like the real failure ─────────────────────────
// Same structure as the case that exposed the bug: a fan disputes a renewal
// that Fadmin confirmed was correctly processed (a 7-day free trial that
// converted to its normal price on schedule), gets told no, then escalates
// with the same demand — and one of those escalation messages happens to
// restate a date that reads a calendar day off from server UTC. All
// identifiers below are invented.

const conversation = {
  customer: "Test Fan",
  firstMessage: "Искам да ми върнете парите!!!!", // "I want you to return my money!!!!"
  messages: [
    { role: "customer", body: "İ want my money back!!!" },
    { role: "customer", body: "İ WANT MY MONEY BACK" },
    {
      role: "admin",
      body: "Hey! 👋 Thanks for reaching out to Fanvue Support, I'm Agent. I'll do my best to assist you today! 😊\n\nHello! I understand you want your money back, and I'll look into the correct option for you. 💚\n\nWhich payment are you referring to, and what happened that makes you believe it should be refunded? Please include the approximate date and amount if you have them.",
    },
    { role: "customer", body: "Здравейте" }, // "Hello"
    {
      role: "customer",
      body: "Искам да си отменя плащането към абонамента и парите да ми бъдат възстановени. Датата е днес 13.08.2026 година,  1:06 минути.",
      // "I want to cancel my subscription payment and get my money back. The date is today, 13.08.2026, 1:06."
    },
    { role: "admin", body: "let me check" },
    { role: "customer", body: "Okay" },
    { role: "customer", body: "25€." },
    {
      role: "admin",
      body: "I checked your account: the subscription to examplecreator included a 7-day free trial starting Aug 5th, and it converted to her normal price ($19.99 + VAT) on schedule 7 days later - that's the charge you saw. This wasn't a billing error, it converted exactly as the trial terms stated.\n\nYou've already cancelled all your subscriptions, so you won't be charged again on any of them.\n\nSince this renewal was correctly processed per the trial terms, I'm not able to refund it, but let me know if anything else looks off.",
    },
    // The two escalation messages that, in production, got a draft asking
    // the customer to "clarify the transaction date" instead of closing.
    { role: "customer", body: "İ want my money back!!!! NOW!!!" },
    { role: "customer", body: "Give me my money back!" },
  ],
}

// ── failure-mode checks ─────────────────────────────────────────────────────
// These encode the EXACT symptom reported: a new clarifying question about
// which date the payment was made, instead of holding the already-stated
// final decision. A pass here doesn't certify the reply is good prose — a
// human should still read the transcript — but it does catch the regression.

const REOPENS_ON_DATE = /which date|what date|clarify the (transaction )?date|confirm the date|correct date|was (the|this|it) (payment|charge) made|tomorrow relative to today/i
const ASKS_FOR_MORE_DETAILS = /could you (please )?(confirm|clarify|let me know)|can you (confirm|clarify)/i

function evaluate(reply: string): { pass: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (REOPENS_ON_DATE.test(reply)) reasons.push("reopened the transaction date instead of holding the decision")
  if (ASKS_FOR_MORE_DETAILS.test(reply) && !/new (information|evidence|details)/i.test(reply)) {
    reasons.push("asked the customer to confirm/clarify something already established")
  }
  return { pass: reasons.length === 0, reasons }
}

// ── run ──────────────────────────────────────────────────────────────────────

async function run() {
  const runsArg = process.argv.find((a) => a.startsWith("--runs="))
  const runs = runsArg ? Number(runsArg.split("=")[1]) : 3
  const dryRun = process.argv.includes("--dry-run")

  // Dynamic + after env setup — see the note above the imports.
  const {
    buildSystemPrompt,
    buildUserMessage,
    streamChatCompletion,
    getTextDraftModel,
    getDefaultReasoningEffort,
    REPLY_STYLE_NUDGE,
  } = await import("../lib/draft-ai")

  let systemPrompt = buildSystemPrompt(undefined, [], "Agent", [], true, false)
  systemPrompt += `\n\n${REPLY_STYLE_NUDGE}`
  const userMessage = buildUserMessage(conversation, undefined, undefined, true, true)

  const messages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ]

  if (dryRun) {
    // No API key available (or --dry-run explicitly requested) — this proves
    // the fixed instructions are actually present in the exact prompt this
    // conversation would produce, without spending a live call to prove it.
    const hasTimezoneCaveat = userMessage.toString().includes("one calendar day ahead or behind")
    const hasRestatedDemandRule = systemPrompt.includes("A restated demand is not new information")
    console.log("DRY RUN — no live model call. Checking the assembled prompt only.\n")
    console.log(`Timezone caveat present in user message: ${hasTimezoneCaveat ? "YES" : "NO"}`)
    console.log(`'Restated demand' rule present in system prompt: ${hasRestatedDemandRule ? "YES" : "NO"}\n`)
    console.log("─".repeat(70))
    console.log("SYSTEM PROMPT:\n")
    console.log(systemPrompt)
    console.log("─".repeat(70))
    console.log("USER MESSAGE:\n")
    console.log(userMessage)
    process.exit(hasTimezoneCaveat && hasRestatedDemandRule ? 0 : 1)
  }

  console.log(`Model: ${getTextDraftModel()} | reasoning effort: ${getDefaultReasoningEffort()} | runs: ${runs}\n`)

  let passed = 0
  for (let i = 1; i <= runs; i++) {
    let body = ""
    for await (const chunk of streamChatCompletion(messages)) body += chunk
    const { pass, reasons } = evaluate(body)
    if (pass) passed++
    console.log(`── Run ${i}/${runs}: ${pass ? "PASS" : "FAIL"} ${reasons.length ? `(${reasons.join("; ")})` : ""}`)
    console.log(body.trim())
    console.log()
  }

  console.log(`${passed}/${runs} passed.`)
  process.exit(passed === runs ? 0 : 1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
