import { NextResponse } from "next/server"

const intercomToken = process.env.INTERCOM_ACCESS_TOKEN

export const dynamic = "force-dynamic"

/**
 * Returns all tags from the Intercom workspace.
 * Used by the UI to populate the tag condition picker.
 */
export async function GET() {
  if (!intercomToken) return NextResponse.json({ error: "INTERCOM_ACCESS_TOKEN not configured" }, { status: 500 })

  try {
    const res = await fetch("https://api.intercom.io/tags", {
      headers: { Authorization: `Bearer ${intercomToken}` },
      next: { revalidate: 60 },
    })
    if (!res.ok) return NextResponse.json({ error: `Intercom API ${res.status}` }, { status: 502 })

    const data = (await res.json()) as { data?: Array<{ id: string; name: string }> }
    return NextResponse.json({ tags: data.data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
