import { describe, it, expect, vi, beforeEach } from "vitest"

// Session-scoped write: the route must key its update off getSignedInEmail(),
// never off any `email` the request body carries. Mock both dependencies so
// we can assert exactly which email the Supabase `.eq()` call received.
vi.mock("@/lib/auth", () => ({ getSignedInEmail: vi.fn() }))
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdminClient: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { POST } from "./route"

type Recorder = { updatePayload?: unknown; eqCalls: [string, unknown][] }

function fakeDb() {
  const recorder: Recorder = { eqCalls: [] }
  const chain = {
    update: (row: unknown) => {
      recorder.updatePayload = row
      return chain
    },
    eq: (col: string, val: unknown) => {
      recorder.eqCalls.push([col, val])
      return chain
    },
    select: () => chain,
    maybeSingle: () => Promise.resolve({ data: { id: "agent-1" }, error: null }),
    delete: () => chain,
    from: () => chain,
  }
  return { db: { from: () => chain } as unknown as NonNullable<ReturnType<typeof getSupabaseAdminClient>>, recorder }
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/settings/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/settings/update — session-scoped writes", () => {
  beforeEach(() => {
    vi.mocked(getSignedInEmail).mockReset()
    vi.mocked(getSupabaseAdminClient).mockReset()
  })

  it("keys the update off the signed-in session email, ignoring a foreign email in the body", async () => {
    vi.mocked(getSignedInEmail).mockResolvedValue("real-agent@fanvue.com")
    const { db, recorder } = fakeDb()
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    const res = await POST(
      jsonRequest({ email: "someone-else@fanvue.com", agentName: "Val" })
    )

    expect(res.status).toBe(200)
    expect(recorder.eqCalls).toContainEqual(["email", "real-agent@fanvue.com"])
    expect(recorder.eqCalls.every(([, val]) => val !== "someone-else@fanvue.com")).toBe(true)
  })

  it("401s when there is no session, regardless of a body-supplied email", async () => {
    vi.mocked(getSignedInEmail).mockResolvedValue(null)
    const { db } = fakeDb()
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    const res = await POST(jsonRequest({ email: "someone-else@fanvue.com", agentName: "Val" }))

    expect(res.status).toBe(401)
  })

  it("only patches fields present in the body, so posting just agentName leaves name/timezone/workingDays untouched", async () => {
    vi.mocked(getSignedInEmail).mockResolvedValue("real-agent@fanvue.com")
    const { db, recorder } = fakeDb()
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    await POST(jsonRequest({ agentName: "Val" }))

    expect(recorder.updatePayload).toEqual({ agent_name: "Val" })
  })
})
