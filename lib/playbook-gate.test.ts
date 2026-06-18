import { describe, it, expect } from "vitest"

import { buildGatePrompt } from "./playbook-gate"
import type { PlaybookListItem } from "@/lib/playbooks"

const pb = (over: Partial<PlaybookListItem>): PlaybookListItem => ({
  id: "id-1",
  caseType: "KYC stuck",
  source: "KYC",
  status: "draft",
  aliases: ["verification pending"],
  lastValidated: null,
  recognize: null,
  checks: null,
  resolution: null,
  dosDonts: null,
  ...over,
})

describe("buildGatePrompt", () => {
  it("returns a system + user message pair", () => {
    const msgs = buildGatePrompt("my payout is stuck", [pb({})])
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe("system")
    expect(msgs[1].role).toBe("user")
  })

  it("system message forbids forcing a match and demands JSON", () => {
    const [system] = buildGatePrompt("x", [pb({})])
    expect(system.content).toMatch(/null/i)
    expect(system.content).toMatch(/json/i)
  })

  it("user message lists each playbook id, case type and aliases, plus the case text", () => {
    const msgs = buildGatePrompt("payout stuck", [
      pb({ id: "p-kyc", caseType: "KYC stuck", aliases: ["verification pending"] }),
      pb({ id: "p-pay", caseType: "Payout hold", aliases: [] }),
    ])
    const user = msgs[1].content
    expect(user).toContain("p-kyc")
    expect(user).toContain("KYC stuck")
    expect(user).toContain("verification pending")
    expect(user).toContain("p-pay")
    expect(user).toContain("payout stuck")
  })
})
