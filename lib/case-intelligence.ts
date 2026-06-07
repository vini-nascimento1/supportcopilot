import "server-only"

import type { PlaybookListItem } from "@/lib/playbooks"

export type CaseTip = {
  playbook: string
  trigger: string
  confidence: "high" | "medium" | "low"
  guidance: string
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

const stopwords = new Set([
  "and", "but", "can", "for", "not", "the", "this", "with",
  "are", "did", "do", "get", "got", "has", "had", "its",
  "was", "were", "will", "would", "could", "should",
  "have", "been", "been", "from", "they", "them",
  "my", "your", "our", "its", "his", "her",
  "all", "any", "each", "every", "some", "that", "than",
  "then", "just", "also", "very", "please", "help",
  "you", "your", "have", "need", "know", "let", "like",
  "make", "may", "more", "much", "now", "one", "see",
  "way", "back", "been", "call", "come", "day", "even",
  "how", "into", "made", "over", "still", "such",
  "too", "try", "use", "used", "want",
])
const domainTokens = new Set(["2fa", "aml", "kyc", "otp", "pep", "rfi"])

function tokenize(value: string) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !stopwords.has(token))
}

function getTerms(playbook: PlaybookListItem) {
  return [playbook.caseType, ...playbook.aliases]
    .map((term) => ({ raw: term, normalized: normalize(term) }))
    .filter((term) => term.normalized.length >= 3)
}

export type PlaybookMatch = {
  playbook: PlaybookListItem
  trigger: string
  confidence: "high" | "medium" | "low"
  score: number
}

function scorePlaybook(
  normalizedText: string,
  textTokens: Set<string>,
  playbook: PlaybookListItem
): { score: number; trigger: string } | null {
  let bestScore = 0
  let bestTrigger = ""

  for (const term of getTerms(playbook)) {
    const termTokens = tokenize(term.raw)
    const matchedTokens = termTokens.filter((token) => textTokens.has(token))
    const phraseMatched = normalizedText.includes(term.normalized)
    const hasStrongToken = matchedTokens.some(
      (token) => token.length >= 5 || domainTokens.has(token)
    )

    if (!phraseMatched && (!hasStrongToken || matchedTokens.length === 0)) {
      continue
    }

    const score =
      (phraseMatched ? term.normalized.length : 0) +
      matchedTokens.length * 8 +
      (term.raw === playbook.caseType ? 6 : 0)

    if (score > bestScore) {
      bestScore = score
      bestTrigger = term.raw
    }
  }

  return bestScore > 0 ? { score: bestScore, trigger: bestTrigger } : null
}

function toConfidence(score: number): "high" | "medium" | "low" {
  return score > 24 ? "high" : score > 12 ? "medium" : "low"
}

export function getLiveTipForText(
  text: string,
  playbooks: PlaybookListItem[]
): CaseTip | null {
  const normalizedText = normalize(text)
  const textTokens = new Set(tokenize(text))
  let best: { playbook: PlaybookListItem; score: number; trigger: string } | null = null

  for (const playbook of playbooks) {
    const result = scorePlaybook(normalizedText, textTokens, playbook)
    if (result && (!best || result.score > best.score)) {
      best = { playbook, ...result }
    }
  }

  if (!best) return null

  return {
    playbook: best.playbook.caseType,
    trigger: best.trigger,
    confidence: toConfidence(best.score),
    guidance:
      best.playbook.checks ??
      best.playbook.recognize ??
      "Open the matched playbook before drafting a reply.",
  }
}

export function getTopMatches(
  text: string,
  playbooks: PlaybookListItem[],
  limit = 3
): PlaybookMatch[] {
  const normalizedText = normalize(text)
  const textTokens = new Set(tokenize(text))
  const results: PlaybookMatch[] = []

  for (const playbook of playbooks) {
    const result = scorePlaybook(normalizedText, textTokens, playbook)
    if (result) {
      results.push({
        playbook,
        trigger: result.trigger,
        score: result.score,
        confidence: toConfidence(result.score),
      })
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function getDraftPlaceholder(caseSummary: string, tip: CaseTip | null) {
  if (!tip) {
    return "No draft generated yet. Match a playbook first, then draft from approved sources."
  }

  return `Draft placeholder based on "${tip.playbook}". Confirm the internal checks first, cite the playbook, and keep this as copy-paste only. Customer context: ${caseSummary}`
}
