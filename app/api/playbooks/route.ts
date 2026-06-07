import { NextResponse } from "next/server"

import { getPlaybooksDashboardData } from "@/lib/playbooks"

export const dynamic = "force-dynamic"

export async function GET() {
  const data = await getPlaybooksDashboardData()

  return NextResponse.json(data, {
    status: data.mode === "error" ? 502 : 200,
  })
}
