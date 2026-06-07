import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getOpenCasesQueue } from "@/lib/intercom"
import { getPlaybooksDashboardData } from "@/lib/playbooks"

export const dynamic = "force-dynamic"

export async function GET() {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const playbooks = await getPlaybooksDashboardData()
  const cases = await getOpenCasesQueue(playbooks.allRows)

  return NextResponse.json(cases, {
    status: cases.mode === "error" ? 502 : 200,
  })
}
