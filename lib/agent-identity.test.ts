import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdminClient: vi.fn() }))

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getCustomerFacingIdentity } from "./agent-identity"
import { buildAgentGreeting } from "./draft-ai"

function fakeDb(row: Record<string, unknown> | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return { from: () => chain } as unknown as NonNullable<ReturnType<typeof getSupabaseAdminClient>>
}

describe("getCustomerFacingIdentity", () => {
  beforeEach(() => {
    vi.mocked(getSupabaseAdminClient).mockReset()
  })

  it("returns agent_name, never the internal name — even when the row also has a `name` column", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      fakeDb({ agent_name: "Val", name: "Valentina Rossi (Google profile)", intercom_admin_id: "adm_1" })
    )

    const identity = await getCustomerFacingIdentity("agent@fanvue.com")

    expect(identity.agentName).toBe("Val")
    expect(identity.agentName).not.toContain("Google profile")
    expect(identity.intercomAdminId).toBe("adm_1")
    expect(identity.signature).toBe("Val, Fanvue Support")
  })

  it("returns agentName: null (not the internal name, not a placeholder) when agent_name is unset", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      fakeDb({ agent_name: null, name: "Valentina Rossi", intercom_admin_id: "adm_1" })
    )

    const identity = await getCustomerFacingIdentity("agent@fanvue.com")

    expect(identity.agentName).toBeNull()
    expect(identity.signature).toBeNull()
  })

  it("treats a blank/whitespace-only agent_name as unset", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      fakeDb({ agent_name: "   ", name: "Valentina Rossi", intercom_admin_id: null })
    )

    const identity = await getCustomerFacingIdentity("agent@fanvue.com")

    expect(identity.agentName).toBeNull()
  })

  it("returns the empty identity for a null email without touching the db", async () => {
    const db = vi.mocked(getSupabaseAdminClient)
    const identity = await getCustomerFacingIdentity(null)

    expect(identity).toEqual({ agentName: null, intercomAdminId: null, signature: null })
    expect(db).not.toHaveBeenCalled()
  })

  it("returns the empty identity when no row is found for the email", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(fakeDb(null))

    const identity = await getCustomerFacingIdentity("nobody@fanvue.com")

    expect(identity).toEqual({ agentName: null, intercomAdminId: null, signature: null })
  })

  it("returns the empty identity when the admin client is unavailable", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(null)

    const identity = await getCustomerFacingIdentity("agent@fanvue.com")

    expect(identity).toEqual({ agentName: null, intercomAdminId: null, signature: null })
  })
})

describe("buildAgentGreeting with a null-resolved agent name", () => {
  it("drops the 'I'm X' clause when the resolver's null is passed through the generic sentinel", () => {
    const greeting = buildAgentGreeting("the support team")

    expect(greeting).not.toMatch(/I'm/)
    expect(greeting).toBe(
      "Hey! 👋 Thanks for reaching out to Fanvue Support. I'll do my best to assist you today! 😊"
    )
  })

  it("includes the 'I'm X' clause when a real agent_name is resolved", () => {
    const greeting = buildAgentGreeting("Val")

    expect(greeting).toContain("I'm Val.")
  })
})
