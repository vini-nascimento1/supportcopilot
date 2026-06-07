import { NextResponse } from "next/server"

import { getOpenCasesQueue } from "@/lib/intercom"
import { getPlaybooksDashboardData } from "@/lib/playbooks"

export const dynamic = "force-dynamic"

export async function GET() {
  const playbooks = await getPlaybooksDashboardData()
  const cases = await getOpenCasesQueue(playbooks.allRows)

  return NextResponse.json(cases, {
    status: cases.mode === "error" ? 502 : 200,
  })
}
