import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getPendingQueue } from "@/lib/reply-queue-store"

export const dynamic = "force-dynamic"

// The autonomous non-read reply queue for the signed-in agent: ONLY the
// conversations currently assigned to them in Intercom (owner-scoped — not the
// workspace-wide unassigned pool). The client (the canvas queue-sidebar) splits
// the flat list into the two bands and orders by wait time.
export async function GET() {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  try {
    const items = await getPendingQueue()
    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ items: [], error: "Couldn't load the reply queue." })
  }
}
