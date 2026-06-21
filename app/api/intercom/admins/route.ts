import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { listIntercomAdmins } from "@/lib/intercom"

export const dynamic = "force-dynamic"

// Teammate (Intercom admin) list for the canvas inbox picker — lets the client
// build the "Mine / Unassigned / <teammate>" inbox selector. Auth-gated like the
// rest of the app; listIntercomAdmins() caches upstream (revalidate 60), so this
// is cheap to poll/refetch.
export async function GET() {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  try {
    const admins = await listIntercomAdmins()
    return NextResponse.json({ admins })
  } catch {
    return NextResponse.json({ admins: [], error: "Couldn't load teammates." })
  }
}
