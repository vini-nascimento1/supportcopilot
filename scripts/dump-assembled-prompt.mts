/**
 * Dump the fully assembled system prompt for every drafting path, so the whole
 * rule stack can be read as ONE document instead of inferred from six source
 * files. No model calls, no network, no secrets needed.
 *
 * This exists because the rule stack is edited one incident at a time, in
 * whichever builder the incident surfaced in — which is how the improve and
 * macro-adapt paths silently ended up with no closing rules at all. Reading the
 * assembled text is the only reliable way to spot that drift, and to spot two
 * rules that quietly contradict each other.
 *
 * Usage:
 *   npx tsx scripts/dump-assembled-prompt.mts [outfile]
 *   npx tsx scripts/dump-assembled-prompt.mts --stats   (sizes only)
 */
import { writeFileSync } from "node:fs"

import {
  buildSystemPrompt,
  buildImproveSystemPrompt,
  buildMacroAdaptSystemPrompt,
  buildDraftVerifierMessages,
  REPLY_STYLE_NUDGE,
} from "../lib/draft-ai"
import type { IntercomArticle } from "../lib/intercom"
import type { PlaybookListItem } from "../lib/playbooks"

// Representative (fake) injections so the dump shows a realistic worst case:
// a matched playbook plus a KB article, which is when the prompt is longest.
const playbook = {
  id: "pb-1",
  caseType: "Payout not received",
  recognize: "Creator says a payout has not arrived.",
  checks: "Check the payout status in Fadmin. Check for account warnings.",
  resolution: "If the status is NOT_PAID, send the bank-transfer-failed macro.",
  dosDonts: "Do not promise a specific payout date.",
} as unknown as PlaybookListItem

const articles = [
  {
    id: "a1",
    title: "Payout timelines",
    description: "How long payouts take to arrive",
    bodySnippet: "Payouts are processed within 5 business days of approval.",
  },
] as unknown as IntercomArticle[]

const TONE = "Warm and human, plain language, no corporate filler."

const paths: Array<[string, string]> = [
  [
    "DRAFT  (buildSystemPrompt + REPLY_STYLE_NUDGE)",
    `${buildSystemPrompt(playbook, [], "Vini", articles, false, false, TONE)}\n\n${REPLY_STYLE_NUDGE}`,
  ],
  ["IMPROVE  (buildImproveSystemPrompt)", buildImproveSystemPrompt("Vini", TONE)],
  ["MACRO ADAPT  (buildMacroAdaptSystemPrompt)", buildMacroAdaptSystemPrompt("Approved macro body text.", "Vini", false, TONE)],
  ["VERIFIER  (buildDraftVerifierMessages)", String(buildDraftVerifierMessages([{ role: "user", content: "thread" }], "draft")[0].content)],
]

const statsOnly = process.argv.includes("--stats")
const outfile = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "assembled-prompts.txt"

if (!statsOnly) {
  const out: string[] = []
  for (const [name, text] of paths) {
    out.push("=".repeat(78), `PATH: ${name}`, `chars: ${text.length}   ~tokens: ${Math.round(text.length / 4)}`, "=".repeat(78), text, "")
  }
  writeFileSync(outfile, out.join("\n"), "utf8")
  console.log(`wrote ${outfile}`)
}

for (const [name, text] of paths) {
  console.log(name.padEnd(48), String(text.length).padStart(6), "chars  ~", String(Math.round(text.length / 4)).padStart(5), "tok")
}
