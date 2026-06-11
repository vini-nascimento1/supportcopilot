// Canvas tool types + pure helpers (client-safe). The list itself lives in the
// case_tools table (migration 0022) and is fetched server-side by
// lib/case-tools-db.ts; FALLBACK_TOOLS keeps the canvas working if the DB is
// unreachable or empty. URL templates accept {{email}} / {{handle}} / {{name}}
// placeholders resolved with the case's live Intercom customer context.

export interface CustomerContext {
  email?: string | null
  handle?: string | null
  name?: string | null
}

export interface CanvasTool {
  id: string
  name: string
  icon: string | null
  urlTemplate: string
  group: string | null
  /** Intercom conversation tags that suggest this tool */
  tags: string[]
}

export const FALLBACK_TOOLS: CanvasTool[] = [
  {
    id: "fadmin",
    name: "Fadmin",
    icon: "wrench",
    urlTemplate: "https://fadmin.fanvue.com",
    group: "Fadmin",
    tags: ["kyc", "media", "payout"],
  },
  {
    id: "ondato",
    name: "ONDATO (KYC)",
    icon: "shield-check",
    urlTemplate: "https://os.ondato.com",
    group: "KYC",
    tags: ["kyc"],
  },
  {
    id: "masspay",
    name: "MassPay",
    icon: "banknote",
    urlTemplate: "https://clients.masspay.io/",
    group: "Payouts",
    tags: ["payout"],
  },
]

/** Returns null when the template needs a placeholder the context can't fill. */
export function resolveToolUrl(
  template: string,
  ctx: CustomerContext,
): string | null {
  let missing = false
  const url = template.replace(/\{\{(email|handle|name)\}\}/g, (_m, key) => {
    const value = ctx[key as keyof CustomerContext]
    if (!value) {
      missing = true
      return ""
    }
    return encodeURIComponent(value)
  })
  return missing ? null : url
}

// Keywords that imply a tool tag even when the Intercom tag is missing —
// matched against the ticket text (subject + customer messages).
const TAG_KEYWORDS: Record<string, string[]> = {
  kyc: ["kyc", "verification", "verify", "verified", "identity", "id check", "ondato", "passport", "selfie"],
  payout: ["payout", "withdraw", "payment", "bank", "crypto", "masspay", "triplea", "earnings"],
  media: ["media", "photo", "video", "upload", "content", "removed"],
}

/**
 * Tools suggested for a case: matched by Intercom tag OR by keywords found in
 * the ticket text. Fanvue tools (Fadmin) are always suggested — the agent
 * needs them on virtually every case.
 */
export function suggestedTools(
  tools: CanvasTool[],
  tags: string[],
  ticketText = "",
): CanvasTool[] {
  const wanted = new Set(tags.map((t) => t.toLowerCase()))
  const text = ticketText.toLowerCase()
  return tools.filter((tool) => {
    if (tool.group === "Fanvue") return true
    return tool.tags.some(
      (t) =>
        wanted.has(t) ||
        (TAG_KEYWORDS[t] ?? [t]).some((k) => text.includes(k)),
    )
  })
}
