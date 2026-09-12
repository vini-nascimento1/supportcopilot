// Presentation helpers for Intercom conversation tags (CREATOR_TAG, FAN_TAG,
// AGENCY_TAG, PAYOUTS_TAG, KYC_TAG, "🔴 Churn risk", …). Pure and client-safe —
// no `server-only`, no I/O — so both canvas panels (Inbox, Triage) and the
// triage filter UI can share one vocabulary-agnostic renderer instead of each
// inventing its own label/colour rules.
//
// Deliberately NOT a fixed tag list: the Intercom workspace adds and renames
// tags without telling us, so everything here is derived from the tag string
// itself and the filter chips are built from whatever is actually in the pool
// (see collectTagFacets in lib/triage/match.ts).

/** Lowercase + strip the "_TAG" suffix — the shape used for comparisons. */
function tagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/_tag$/, "")
}

/**
 * Short badge label for a tag. "CREATOR_TAG" -> "CREATOR",
 * "PAYOUTS_TAG" -> "PAYOUTS", "EXCL CSAT" -> "EXCL CSAT",
 * "🔴 Churn risk" -> "🔴 Churn risk". The raw tag is still shown on hover
 * (title attribute) so nothing is actually hidden by the shortening.
 */
export function formatTagLabel(tag: string): string {
  const trimmed = tag.trim()
  const withoutSuffix = trimmed.replace(/_TAG$/i, "")
  return (withoutSuffix || trimmed).replace(/_/g, " ").replace(/\s+/g, " ").trim()
}

export type TagTone = "audience" | "risk" | "money" | "neutral"

// Substring probes, checked in this order — a tag matching more than one
// family takes the first hit, which is why risk (KYC/fraud/chargeback) is
// tested before money (payout/refund): a chargeback tag should read as risk.
const TONE_PROBES: Array<[TagTone, string[]]> = [
  ["audience", ["creator", "fan", "agency"]],
  ["risk", ["kyc", "fraud", "chargeback", "ban", "churn", "dispute", "escalat", "risk"]],
  ["money", ["payout", "refund", "earning", "payment", "invoice", "subscription", "tip"]],
]

/** Which colour family a tag belongs to. Unknown tags render neutral. */
export function tagTone(tag: string): TagTone {
  const key = tagKey(tag)
  for (const [tone, needles] of TONE_PROBES) {
    if (needles.some((n) => key.includes(n))) return tone
  }
  return "neutral"
}

export const TAG_TONE_CLASS: Record<TagTone, string> = {
  audience:
    "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300",
  risk: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  money:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  neutral: "border-muted-foreground/25 bg-muted text-muted-foreground",
}

const TONE_ORDER: Record<TagTone, number> = { audience: 0, risk: 1, money: 2, neutral: 3 }

/**
 * Stable display order: audience first (who am I talking to — the thing an
 * agent filters their day around), then risk, then money, then everything
 * else; alphabetical within a family. Rows only show the first few tags, so
 * the order decides what survives the truncation.
 */
export function sortTagsForDisplay(tags: readonly string[]): string[] {
  return [...tags]
    .filter((t) => t.trim().length > 0)
    .sort((a, b) => {
      const toneDiff = TONE_ORDER[tagTone(a)] - TONE_ORDER[tagTone(b)]
      if (toneDiff !== 0) return toneDiff
      return formatTagLabel(a).localeCompare(formatTagLabel(b))
    })
}
