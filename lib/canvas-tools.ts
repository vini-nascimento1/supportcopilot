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

/** Subset of ToolNodeData (components/canvas/tool-node.tsx) this needs — kept
    structural instead of importing the component's type into this pure lib. */
export interface RestorableToolUrlData {
  url: string
  urlTemplate?: string
  ghost?: boolean
}

/**
 * A layout restored from storage carries last session's tool-card URLs
 * as-is (loadLayout only refreshes case-info/conversation/macros data). If the
 * customer's email/name changed since then, re-resolve against the fresh
 * context so a stale Fadmin/ONDATO link doesn't sit there silently.
 *
 * Returns a data patch to merge in, or null when nothing needs to change
 * (no template, context still can't fill it, or the URL is already current).
 * Ghost cards (nothing loaded yet) get `url` swapped directly; loaded cards
 * get `pendingUrl` set instead — ToolNode shows a one-click Refresh banner
 * rather than yanking an open card to a new page.
 */
export function reconcileRestoredToolUrl(
  data: RestorableToolUrlData,
  ctx: CustomerContext,
): { url: string } | { pendingUrl: string } | null {
  if (!data.urlTemplate) return null
  const freshUrl = resolveToolUrl(data.urlTemplate, ctx)
  if (!freshUrl || freshUrl === data.url) return null
  return data.ghost ? { url: freshUrl } : { pendingUrl: freshUrl }
}

// Keywords that imply a tool tag even when the Intercom tag is missing —
// matched against the ticket text (subject + customer messages).
const TAG_KEYWORDS: Record<string, string[]> = {
  kyc: ["kyc", "verification", "verify", "verified", "identity", "id check", "ondato", "passport", "selfie"],
  payout: ["payout", "withdraw", "payment", "bank", "crypto", "masspay", "triplea", "earnings"],
  media: ["media", "photo", "video", "upload", "content", "removed"],
}

// Groups that are always suggested regardless of tags/keywords (Fadmin is
// needed on virtually every case). Two spellings are accepted here: the live
// case_tools table's group_name is free text (see
// components/case-tools-settings.tsx — a plain input, no fixed options) and
// there's no local migration/seed fixture in this repo to confirm which
// spelling production rows use, while FALLBACK_TOOLS below groups its Fadmin
// entry "Fadmin", not "Fanvue". Accepting both avoids guessing a single
// canonical name and silently breaking the "always suggested" guarantee.
const ALWAYS_SUGGESTED_GROUPS = new Set(["Fanvue", "Fadmin"])

/**
 * Tools suggested for a case: matched by Intercom tag OR by keywords found in
 * the ticket text. Fanvue/Fadmin tools are always suggested — the agent needs
 * them on virtually every case.
 */
export function suggestedTools(
  tools: CanvasTool[],
  tags: string[],
  ticketText = "",
): CanvasTool[] {
  const wanted = new Set(tags.map((t) => t.toLowerCase()))
  const text = ticketText.toLowerCase()
  return tools.filter((tool) => {
    if (tool.group && ALWAYS_SUGGESTED_GROUPS.has(tool.group)) return true
    return tool.tags.some(
      (t) =>
        wanted.has(t) ||
        (TAG_KEYWORDS[t] ?? [t]).some((k) => text.includes(k)),
    )
  })
}

// Toolbox group display order — groups not listed come after, alphabetically.
// "Fadmin" and "Payouts" are included alongside "Fanvue"/"Payments" for the
// same free-text-group reason as ALWAYS_SUGGESTED_GROUPS above: FALLBACK_TOOLS
// uses "Fadmin"/"Payouts" and the live table's spelling isn't confirmable from
// this repo, so both are accepted rather than guessing one.
export const GROUP_ORDER = [
  "Fanvue",
  "Fadmin",
  "KYC",
  "Payments",
  "Payouts",
  "Workspace",
  "Personal",
]

export function groupTools(tools: CanvasTool[]): Array<[string, CanvasTool[]]> {
  const byGroup = new Map<string, CanvasTool[]>()
  for (const tool of tools) {
    const key = tool.group || "Other"
    byGroup.set(key, [...(byGroup.get(key) ?? []), tool])
  }
  return [...byGroup.entries()].sort(([a], [b]) => {
    const ia = GROUP_ORDER.indexOf(a)
    const ib = GROUP_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}
