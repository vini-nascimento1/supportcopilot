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
  requiresManualAction: false,
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

import { parseGateResponse } from "./playbook-gate"

const ids = ["p-kyc", "p-pay"]

describe("parseGateResponse", () => {
  it("parses a clean JSON verdict and keeps a known id", () => {
    const r = parseGateResponse('{"match":"p-kyc","confidence":0.82,"reason":"verification"}', ids)
    expect(r).toEqual({ playbookId: "p-kyc", confidence: 0.82, reason: "verification" })
  })

  it("strips ```json code fences", () => {
    const r = parseGateResponse('```json\n{"match":"p-pay","confidence":0.7,"reason":"hold"}\n```', ids)
    expect(r.playbookId).toBe("p-pay")
    expect(r.confidence).toBe(0.7)
  })

  it("treats an unknown id as no match", () => {
    const r = parseGateResponse('{"match":"p-ghost","confidence":0.9,"reason":"x"}', ids)
    expect(r.playbookId).toBeNull()
  })

  it("accepts an explicit null match", () => {
    const r = parseGateResponse('{"match":null,"confidence":0.1,"reason":"off-topic"}', ids)
    expect(r.playbookId).toBeNull()
    expect(r.confidence).toBe(0.1)
  })

  it("clamps confidence to [0,1] and defaults missing fields", () => {
    expect(parseGateResponse('{"match":"p-kyc","confidence":5}', ids).confidence).toBe(1)
    expect(parseGateResponse('{"match":"p-kyc","confidence":-2}', ids).confidence).toBe(0)
    expect(parseGateResponse('{"match":"p-kyc"}', ids).confidence).toBe(0)
  })

  it("returns a null/zero verdict on malformed JSON instead of throwing", () => {
    const r = parseGateResponse("not json at all", ids)
    expect(r).toEqual({ playbookId: null, confidence: 0, reason: "unparseable" })
  })
})
