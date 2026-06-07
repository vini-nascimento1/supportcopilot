import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getPlaybooksDashboardData } from "@/lib/playbooks"

export const dynamic = "force-dynamic"

export async function GET() {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const data = await getPlaybooksDashboardData()

  return NextResponse.json(data, {
    status: data.mode === "error" ? 502 : 200,
  })
}
