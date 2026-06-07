import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export type PlaybookListItem = {
  id: string
  caseType: string
  source: string
  status: string
  aliases: string[]
  lastValidated: string | null
  recognize: string | null
  checks: string | null
  resolution: string | null
  dosDonts: string | null
}

export type PlaybooksDashboardData = {
  mode: "live" | "demo" | "error"
  error: string | null
  playbookCount: number
  responseCount: number
  reviewedCount: number
  rows: PlaybookListItem[]
  allRows: PlaybookListItem[]
}

const demoRows: PlaybookListItem[] = [
  {
    id: "demo-kyc-stuck",
    caseType: "KYC stuck / pending / null or technical error",
    source: "KYC & identity",
    status: "draft",
    aliases: ["verification pending", "KYC stuck", "null KYC"],
    lastValidated: null,
    recognize: "Creator says verification is stuck or pending.",
    checks: "Check fadmin and Ondato status before replying.",
    resolution: "Confirm status and escalate technical null-state issues.",
    dosDonts: "Do not promise manual approval before checking the actual state.",
  },
  {
    id: "demo-payout-hold",
    caseType: "Payout on hold / under review (compliance RFI)",
    source: "Payouts & banking",
    status: "draft",
    aliases: ["payout under review", "compliance hold"],
    lastValidated: null,
    recognize: "Payout is pending with compliance review language.",
    checks: "Check payout status and whether a provider upload link is needed.",
    resolution: "Share the secure upload link when available.",
    dosDonts: "Do not name the payout provider or promise a release date.",
  },
]

const demoData: PlaybooksDashboardData = {
  mode: "demo",
  error: null,
  playbookCount: 45,
  responseCount: 48,
  reviewedCount: 0,
  rows: demoRows,
  allRows: demoRows,
}

function mapPlaybookRow(row: {
  id: string
  case_type: string
  source: string | null
  status: string
  aliases: string[] | null
  last_validated: string | null
  recognize: string | null
  checks: string | null
  resolution: string | null
  dos_donts: string | null
}): PlaybookListItem {
  return {
    id: row.id,
    caseType: row.case_type,
    source: row.source ?? "No source recorded",
    status: row.status,
    aliases: row.aliases ?? [],
    lastValidated: row.last_validated,
    recognize: row.recognize,
    checks: row.checks,
    resolution: row.resolution,
    dosDonts: row.dos_donts,
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

export async function getPlaybooksDashboardData(): Promise<PlaybooksDashboardData> {
  const supabase = getSupabaseAdminClient()

  if (!supabase) {
    return demoData
  }

  const [playbooksResult, playbookCountResult, responseCountResult, reviewedResult] =
    await Promise.all([
      supabase
        .from("playbooks")
        .select(
          "id, case_type, aliases, status, source, last_validated, recognize, checks, resolution, dos_donts"
        )
        .order("case_type", { ascending: true }),
      supabase.from("playbooks").select("id", { count: "exact", head: true }),
      supabase.from("responses").select("id", { count: "exact", head: true }),
      supabase
        .from("playbooks")
        .select("id", { count: "exact", head: true })
        .eq("status", "reviewed"),
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
    reviewedCount: reviewedResult.count ?? 0,
    rows: allRows.slice(0, 8),
    allRows,
  }
}
