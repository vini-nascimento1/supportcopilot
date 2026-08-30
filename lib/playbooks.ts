import "server-only"

import { revalidateTag, unstable_cache } from "next/cache"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export type PlaybookListItem = {
  id: string
  caseType: string
  source: string
  aliases: string[]
  lastValidated: string | null
  recognize: string | null
  checks: string | null
  resolution: string | null
  dosDonts: string | null
  requiresManualAction: boolean
}

export type PlaybooksDashboardData = {
  mode: "live" | "demo" | "error"
  error: string | null
  playbookCount: number
  responseCount: number
  rows: PlaybookListItem[]
  allRows: PlaybookListItem[]
}

const demoRows: PlaybookListItem[] = [
  {
    id: "demo-kyc-stuck",
    caseType: "KYC stuck / pending / null or technical error",
    source: "KYC & identity",
    aliases: ["verification pending", "KYC stuck", "null KYC"],
    lastValidated: null,
    recognize: "Creator says verification is stuck or pending.",
    checks: "Check fadmin and Ondato status before replying.",
    resolution: "Confirm status and escalate technical null-state issues.",
    dosDonts: "Do not promise manual approval before checking the actual state.",
    requiresManualAction: false,
  },
  {
    id: "demo-payout-hold",
    caseType: "Payout on hold / under review (compliance RFI)",
    source: "Payouts & banking",
    aliases: ["payout under review", "compliance hold"],
    lastValidated: null,
    recognize: "Payout is pending with compliance review language.",
    checks: "Check payout status and whether a provider upload link is needed.",
    resolution: "Share the secure upload link when available.",
    dosDonts: "Do not name the payout provider or promise a release date.",
    requiresManualAction: false,
  },
]

const demoData: PlaybooksDashboardData = {
  mode: "demo",
  error: null,
  playbookCount: 45,
  responseCount: 48,
  rows: demoRows,
  allRows: demoRows,
}

function mapPlaybookRow(row: {
  id: string
  case_type: string
  source: string | null
  aliases: string[] | null
  last_validated: string | null
  recognize: string | null
  checks: string | null
  resolution: string | null
  dos_donts: string | null
  requires_manual_action: boolean | null
}): PlaybookListItem {
  return {
    id: row.id,
    caseType: row.case_type,
    source: row.source ?? "No source recorded",
    aliases: row.aliases ?? [],
    lastValidated: row.last_validated,
    recognize: row.recognize,
    checks: row.checks,
    resolution: row.resolution,
    dosDonts: row.dos_donts,
    requiresManualAction: row.requires_manual_action ?? false,
  }
}

export type ResponseItem = {
  id: string
  title: string
  body: string
}

export async function getResponsesForPlaybookIds(
  playbookIds: string[]
): Promise<Map<string, ResponseItem[]>> {
  if (playbookIds.length === 0) return new Map()
  const supabase = getSupabaseAdminClient()
  if (!supabase) return new Map()

  const { data } = await supabase
    .from("responses")
    .select("id, title, body, playbook_id")
    .in("playbook_id", playbookIds)

  const result = new Map<string, ResponseItem[]>()
  for (const row of data ?? []) {
    if (!row.playbook_id) continue
    const list = result.get(row.playbook_id) ?? []
    list.push({ id: row.id, title: row.title, body: row.body })
    result.set(row.playbook_id, list)
  }
  return result
}

// Cache tag + TTL for the playbook corpus. Playbooks are ~64 curated rows that
// change only when someone edits them in the Playbooks page, but the full read
// carries every long-form column (recognize/checks/resolution/dos_donts) and
// weighs ~170 kB. It is called from every draft, every canvas match, every page
// render and all three 5-minute cron sweeps, which was ~2.3k uncached reads a
// day and the single largest source of Supabase egress on the project. Cache it
// and invalidate on write via revalidatePlaybooks().
export const PLAYBOOKS_CACHE_TAG = "playbooks-corpus"
const PLAYBOOKS_TTL_SECONDS = 300

// Layer 1: per-process memo. Collapses the repeated reads inside a single
// sweep/lambda invocation and works in any context, including background
// `after()` work where the Next cache scope may not be available.
let memo: { data: PlaybooksDashboardData; expires: number } | null = null

async function fetchPlaybooksDashboardData(): Promise<PlaybooksDashboardData> {
  const supabase = getSupabaseAdminClient()

  if (!supabase) {
    return demoData
  }

  const [playbooksResult, playbookCountResult, responseCountResult] =
    await Promise.all([
      supabase
        .from("playbooks")
        .select(
          "id, case_type, aliases, source, last_validated, recognize, checks, resolution, dos_donts, requires_manual_action"
        )
        .order("case_type", { ascending: true }),
      supabase.from("playbooks").select("id", { count: "exact", head: true }),
      supabase.from("responses").select("id", { count: "exact", head: true }),
    ])

  if (playbooksResult.error) {
    return {
      ...demoData,
      mode: "error",
      error: playbooksResult.error.message,
    }
  }

  const allRows = playbooksResult.data.map(mapPlaybookRow)

  return {
    mode: "live",
    error: null,
    playbookCount: playbookCountResult.count ?? allRows.length,
    responseCount: responseCountResult.count ?? 0,
    rows: allRows.slice(0, 8),
    allRows,
  }
}

// Layer 2: Next's data cache, which on Vercel persists across lambda
// invocations and deployments — that is where the bulk of the saving comes
// from, since most callers are separate cron invocations rather than repeat
// calls inside one request.
const fetchPlaybooksCached = unstable_cache(
  async () => {
    const data = await fetchPlaybooksDashboardData()
    // Throw rather than return, so a transient Supabase failure is never
    // written into the data cache and pinned there for the whole TTL. The
    // caller below catches it and re-reads directly.
    if (data.mode === "error") throw new Error(data.error ?? "playbooks read failed")
    return data
  },
  ["playbooks-dashboard-data"],
  { tags: [PLAYBOOKS_CACHE_TAG], revalidate: PLAYBOOKS_TTL_SECONDS }
)

export async function getPlaybooksDashboardData(): Promise<PlaybooksDashboardData> {
  const now = Date.now()
  if (memo && memo.expires > now) return memo.data

  let data: PlaybooksDashboardData
  try {
    data = await fetchPlaybooksCached()
  } catch {
    // Either the read failed, or we are outside a Next cache scope (which
    // unstable_cache requires). Read directly so callers never break on a
    // caching concern, and so the error path still returns its usual shape.
    data = await fetchPlaybooksDashboardData()
  }

  // Never memo a failure — one blip would otherwise pin the error for the
  // whole TTL across every caller in this process.
  if (data.mode !== "error") {
    memo = { data, expires: now + PLAYBOOKS_TTL_SECONDS * 1000 }
  }
  return data
}

// Call after any write to playbooks or responses so editors see their change
// immediately instead of waiting out the TTL.
export async function revalidatePlaybooks(): Promise<void> {
  memo = null
  try {
    // Two-argument form: the single-argument call is deprecated in Next 16.
    // "max" marks the entry stale and serves stale-while-revalidate.
    revalidateTag(PLAYBOOKS_CACHE_TAG, "max")
  } catch {
    // Outside a request scope the tag store is unavailable; the TTL still
    // bounds staleness, and the memo above has already been cleared.
  }
}
