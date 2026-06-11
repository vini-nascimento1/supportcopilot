// Server-side access to the case_tools table (migration 0022).
// Reads use the admin client like the rest of lib/ (server components only).

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { FALLBACK_TOOLS, type CanvasTool } from "@/lib/canvas-tools"

interface CaseToolRow {
  id: string
  name: string
  icon: string | null
  url_template: string
  group_name: string | null
  sort_order: number
  is_active: boolean
  case_tool_tags: Array<{ tag: string }>
}

export function rowToTool(row: CaseToolRow): CanvasTool & { isActive: boolean; sortOrder: number } {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    urlTemplate: row.url_template,
    group: row.group_name,
    tags: (row.case_tool_tags ?? []).map((t) => t.tag),
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }
}

async function fetchRows(): Promise<CaseToolRow[] | null> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return null
  const { data, error } = await supabase
    .from("case_tools")
    .select(
      "id, name, icon, url_template, group_name, sort_order, is_active, case_tool_tags(tag)",
    )
    .order("sort_order")
  if (error) return null
  return data as CaseToolRow[]
}

/** Active tools for the canvas. Falls back to the hardcoded list on failure. */
export async function getCaseTools(): Promise<CanvasTool[]> {
  const rows = await fetchRows()
  if (!rows || rows.length === 0) return FALLBACK_TOOLS
  return rows.filter((r) => r.is_active).map(rowToTool)
}

/** All tools including inactive — for the Settings CRUD. */
export async function getAllCaseTools() {
  const rows = await fetchRows()
  return (rows ?? []).map(rowToTool)
}
