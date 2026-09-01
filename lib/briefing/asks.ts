// Does a message actually ask the reader for something? Pure, no I/O and no
// `server-only` import: the same rule decides Slack urgency in the sources, the
// research shortlist in research.ts, and email urgency in the Gmail source, so
// it has to be importable everywhere and testable on its own.
//
// The bar matters. "Needs you now" is only useful if everything in it is a real
// ask, so a cc-style mention ("cc @vini for visibility") must NOT clear it,
// while "can you take a look?" must.

/** Interrogatives that open a question even without a question mark. */
const INTERROGATIVES = ["who", "what", "when", "where", "why", "how", "which", "is", "are", "do", "does", "did", "can", "could", "should", "would", "any"]

/** Phrases that make a statement an ask directed at the reader. */
const ASK_PHRASES = ["can you", "could you", "do we", "should we", "did we", "are we", "any idea", "do you know", "let me know", "thoughts?"]

/**
 * Phrases that are a request rather than a question: no question mark, no
 * interrogative opener, but the reader is still on the hook.
 */
export const REQUEST_PHRASES = [
  "please",
  "pls",
  "plz",
  "can you",
  "could you",
  "would you",
  "can u",
  "need you",
  "needs your",
  "need your",
  "urgent",
  "asap",
  "help with",
  "take a look",
  "have a look",
  "when you get a chance",
  "when you have a sec",
  "wdyt",
  "eta",
  "any update",
] as const

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[a-z0-9]/.test(char)
}

/**
 * Does `haystack` (already lowercased) contain `phrase` as the START of a word?
 *
 * A plain `includes` is too loose for short tokens — "eta" hits "beta", "sign"
 * hits "design" and "assigned" — and a both-ends word boundary is too tight,
 * since it would drop "approved" and "confirmed". Requiring only a boundary
 * BEFORE the phrase gets both: "beta" and "assigned" are rejected, "approved"
 * and "confirmed" still match.
 */
export function containsPhrase(haystack: string, phrase: string): boolean {
  for (let from = 0; from <= haystack.length; ) {
    const at = haystack.indexOf(phrase, from)
    if (at < 0) return false
    if (!isWordChar(haystack[at - 1])) return true
    from = at + 1
  }
  return false
}

/** Drop `<@U123>` / `<!subteam^S1>` / `<!here>` markup before matching on words. */
function stripSlackMarkup(lower: string): string {
  return lower.replace(/<[@!][^>]*>/g, " ")
}

/**
 * Does this message read as a question aimed at the agent? Kept deliberately
 * conservative: a false negative costs nothing (the row still shows, just
 * without a prepared answer), a false positive burns a model call and puts a
 * half-relevant answer in front of the agent.
 */
export function readsAsQuestion(rawText: string | null | undefined): boolean {
  const text = (rawText ?? "").trim()
  if (!text) return false

  const lower = text.toLowerCase()
  if (lower.includes("?")) return true
  if (ASK_PHRASES.some((p) => lower.includes(p))) return true

  // Strip a leading @mention ("<@U123> what's the refund policy") before
  // looking at the first word.
  const withoutMentions = stripSlackMarkup(lower).trim()
  const firstWord = withoutMentions.split(/[^a-z']+/).filter(Boolean)[0]
  return Boolean(firstWord && INTERROGATIVES.includes(firstWord))
}

/**
 * The broader test used for urgency: is the reader being asked for something,
 * whether phrased as a question ("what's the refund window?") or as a request
 * ("please take a look")? A mention that clears neither bar is a cc, and a cc
 * belongs in the digest rather than in "Needs you now".
 */
export function asksTheReader(rawText: string | null | undefined): boolean {
  const text = (rawText ?? "").trim()
  if (!text) return false
  if (readsAsQuestion(text)) return true

  const lower = stripSlackMarkup(text.toLowerCase())
  return REQUEST_PHRASES.some((p) => containsPhrase(lower, p))
}
