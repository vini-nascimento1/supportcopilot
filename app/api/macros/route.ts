import { type NextRequest } from "next/server"
import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

export interface MacroRow {
  id: string
  intercomId: string
  name: string
  body: string
  bodyText: string | null
  visibility: string
  updatedAt: string | null
}

// List macros from our mirror. Optional ?q= filters by name/body (case-insensitive).
// ?visibility=everyone restricts to public macros (default: all).
export async function GET(req: NextRequest) {
  const email = await getSignedInEmail()
  if (!email) return new Response("Unauthorized", { status: 401 })

  const supabase = getSupabaseAdminClient()
  if (!supabase) return new Response("Server misconfigured", { status: 500 })

  const q = req.nextUrl.searchParams.get("q")?.trim()
  const visibility = req.nextUrl.searchParams.get("visibility")?.trim()

  let query = supabase
    .from("intercom_macros")
    .select("id, intercom_id, name, body, body_text, visibility, intercom_updated_at")
    .order("name", { ascending: true })
    .limit(500)

  if (visibility) query = query.eq("visibility", visibility)
  if (q) query = query.or(`name.ilike.%${q}%,body_text.ilike.%${q}%`)

  const { data, error } = await query
  if (error) {
    console.error("Macro list failed", error)
    return new Response(`Query failed: ${error.message}`, { status: 500 })
  }

  const macros: MacroRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    intercomId: r.intercom_id as string,
    name: r.name as string,
    body: r.body as string,
    bodyText: (r.body_text as string | null) ?? null,
    visibility: r.visibility as string,
    updatedAt: (r.intercom_updated_at as string | null) ?? null,
  }))

  return Response.json({ ok: true, macros })
}
