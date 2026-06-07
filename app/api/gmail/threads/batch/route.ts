import { NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { trashThreads, markThreadRead } from "@/lib/gmail-client"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const tokens = await getAgentTokens()
    if (!tokens.googleToken) {
      return NextResponse.json({ error: "Not connected" }, { status: 401 })
    }

    const body = (await request.json()) as { action?: string; ids?: string[] }
    const { action, ids } = body

    if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "Missing action or ids" }, { status: 400 })
    }

    if (action === "mark-read") {
      await Promise.all(ids.map((id) => markThreadRead(tokens.googleToken!, tokens.email, id)))
      return NextResponse.json({ ok: true })
    }

    if (action === "trash") {
      const result = await trashThreads(tokens.googleToken, tokens.email, ids)
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e) {
    console.error("[gmail/batch]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    )
  }
}
