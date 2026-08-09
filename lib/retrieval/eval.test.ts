import { describe, it, expect } from "vitest"

import {
  aggregate,
  abstainedCorrectly,
  compareRuns,
  divergence,
  firewallViolations,
  goldenSetManifest,
  groundedSupport,
  normalizeBody,
  recallAtK,
  verifyGoldenSet,
  wordEditDistance,
  type CaseResult,
  type EvalPassage,
} from "./eval"

const passage = (over: Partial<EvalPassage> = {}): EvalPassage => ({
  chunkId: "c1",
  sourceKind: "playbook",
  title: "Refunds",
  content: "No-refund policy applies to consumed digital services.",
  score: 0.9,
  visibility: "customer_safe",
  ...over,
})

describe("golden set manifest", () => {
  it("is internally consistent — strata sum to the declared total", () => {
    const m = goldenSetManifest()
    const sum = Object.values(m.strata).reduce((a, b) => a + b, 0)
    expect(sum).toBe(m.total)
    expect(m.cohorts.paired.total + m.cohorts.reject.total).toBe(m.total)
  })

  it("passes verification when the DB reproduces the frozen strata", () => {
    const m = goldenSetManifest()
    expect(verifyGoldenSet(m.strata)).toEqual({ ok: true })
  })

  it("fails loudly when a stratum drifts", () => {
    const m = goldenSetManifest()
    const drifted = { ...m.strata, "approve/ready/pb": m.strata["approve/ready/pb"] - 3 }
    const result = verifyGoldenSet(drifted)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.drift[0]).toContain("approve/ready/pb")
  })

  it("fails on an unexpected stratum rather than silently widening the set", () => {
    const m = goldenSetManifest()
    const result = verifyGoldenSet({ ...m.strata, "approve/brand_new_band/pb": 4 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.drift.join(" ")).toContain("unexpected stratum")
  })
})

describe("text comparison", () => {
  it("treats whitespace-only differences as identical, matching hasBodyChanged", () => {
    expect(normalizeBody("a  b\n\nc")).toBe("a b c")
    expect(divergence("hello   there", "hello there")).toBe(0)
  })

  it("scores an untouched draft as zero divergence", () => {
    const body = "Your payout is on hold pending compliance review."
    expect(divergence(body, body)).toBe(0)
  })

  it("scores a full rewrite near 1", () => {
    expect(divergence("alpha beta gamma", "completely different words entirely")).toBeGreaterThan(0.9)
  })

  it("counts word-level edits, not character typos", () => {
    // One word replaced out of four.
    expect(wordEditDistance("the payout is pending", "the payout is complete")).toBe(1)
  })

  it("handles empty input on either side", () => {
    expect(divergence("", "")).toBe(0)
    expect(divergence("", "some text")).toBe(1)
    expect(divergence("some text", "")).toBe(1)
  })
})

describe("retrieval quality", () => {
  it("recallAtK counts only passages inside the cutoff", () => {
    const retrieved = [passage({ chunkId: "a" }), passage({ chunkId: "b" }), passage({ chunkId: "c" })]
    expect(recallAtK(retrieved, ["a", "b"], 2)).toBe(1)
    expect(recallAtK(retrieved, ["a", "c"], 2)).toBe(0.5)
    expect(recallAtK(retrieved, ["c"], 2)).toBe(0)
  })

  it("treats a case needing no evidence as trivially satisfied", () => {
    expect(recallAtK([], [], 5)).toBe(1)
  })

  it("groundedSupport clamps to 0..1 and treats no claims as satisfied", () => {
    expect(groundedSupport(3, 4)).toBeCloseTo(0.75)
    expect(groundedSupport(0, 0)).toBe(1)
    expect(groundedSupport(5, 2)).toBe(1)
    expect(groundedSupport(-1, 4)).toBe(0)
  })
})

describe("abstain behaviour on the reject cohort", () => {
  it("counts returning nothing as a correct abstain", () => {
    expect(abstainedCorrectly([], 0.5)).toBe(true)
  })

  it("counts a weak top hit as a correct abstain", () => {
    expect(abstainedCorrectly([passage({ score: 0.3 })], 0.5)).toBe(true)
  })

  it("counts a confident hit on a rejected draft as a failure to abstain", () => {
    expect(abstainedCorrectly([passage({ score: 0.92 })], 0.5)).toBe(false)
  })
})

describe("visibility firewall", () => {
  it("passes a clean customer-safe section", () => {
    expect(firewallViolations([passage(), passage({ chunkId: "c2" })])).toEqual([])
  })

  it("flags any internal_only passage that reached the customer-safe section", () => {
    const leaked = passage({ chunkId: "leak", visibility: "internal_only", sourceKind: "slack" })
    const violations = firewallViolations([passage(), leaked])
    expect(violations).toHaveLength(1)
    expect(violations[0].chunkId).toBe("leak")
  })
})

describe("aggregation", () => {
  const rows: CaseResult[] = [
    { id: "1", stratum: "approve/ready/pb", action: "approve", groundedSupport: 1, divergence: 0, guardrailHits: [] },
    { id: "2", stratum: "approve/ready/pb", action: "approve", groundedSupport: 0.5, divergence: 0.4, guardrailHits: [] },
    { id: "3", stratum: "edit/ready/pb", action: "edit", groundedSupport: 0.25, divergence: 0.8, guardrailHits: ["chargeback"] },
    { id: "4", stratum: "reject/ready/pb", action: "reject", abstained: true, guardrailHits: [] },
    { id: "5", stratum: "reject/ready/pb", action: "reject", abstained: false, guardrailHits: [] },
  ]

  it("reports per-stratum as well as overall", () => {
    const report = aggregate(rows)
    expect(report.total).toBe(5)
    const approve = report.strata.find((s) => s.stratum === "approve/ready/pb")
    expect(approve?.n).toBe(2)
    expect(approve?.meanGroundedSupport).toBeCloseTo(0.75)
    expect(report.overall.meanGroundedSupport).toBeCloseTo(0.583, 2)
  })

  it("computes abstain rate only over the reject cohort", () => {
    const report = aggregate(rows)
    const reject = report.strata.find((s) => s.stratum === "reject/ready/pb")
    expect(reject?.abstainRate).toBe(0.5)
    const approve = report.strata.find((s) => s.stratum === "approve/ready/pb")
    expect(approve?.abstainRate).toBeNull()
  })

  it("totals guardrail hits across every stratum", () => {
    expect(aggregate(rows).guardrailHits).toBe(1)
  })
})

describe("ship/no-ship comparison", () => {
  const base = aggregate([
    { id: "1", stratum: "a", action: "approve", groundedSupport: 0.5, guardrailHits: [] },
    { id: "2", stratum: "b", action: "approve", groundedSupport: 0.5, guardrailHits: [] },
  ])

  it("passes a clear improvement with no regressions", () => {
    const candidate = aggregate([
      { id: "1", stratum: "a", action: "approve", groundedSupport: 0.8, guardrailHits: [] },
      { id: "2", stratum: "b", action: "approve", groundedSupport: 0.8, guardrailHits: [] },
    ])
    expect(compareRuns(base, candidate).pass).toBe(true)
  })

  it("blocks on any new guardrail hit even when the average improves", () => {
    const candidate = aggregate([
      { id: "1", stratum: "a", action: "approve", groundedSupport: 0.95, guardrailHits: ["chargeback advice"] },
      { id: "2", stratum: "b", action: "approve", groundedSupport: 0.95, guardrailHits: [] },
    ])
    const result = compareRuns(base, candidate)
    expect(result.pass).toBe(false)
    expect(result.reasons.join(" ")).toContain("guardrail")
  })

  it("blocks when the overall gain is too small to be worth the risk", () => {
    const candidate = aggregate([
      { id: "1", stratum: "a", action: "approve", groundedSupport: 0.505, guardrailHits: [] },
      { id: "2", stratum: "b", action: "approve", groundedSupport: 0.505, guardrailHits: [] },
    ])
    const result = compareRuns(base, candidate)
    expect(result.pass).toBe(false)
    expect(result.reasons.join(" ")).toContain("below required")
  })

  it("blocks when a single stratum regresses even if the average climbs", () => {
    const candidate = aggregate([
      { id: "1", stratum: "a", action: "approve", groundedSupport: 0.99, guardrailHits: [] },
      { id: "2", stratum: "b", action: "approve", groundedSupport: 0.3, guardrailHits: [] },
    ])
    const result = compareRuns(base, candidate)
    expect(result.pass).toBe(false)
    expect(result.reasons.join(" ")).toContain("stratum b regressed")
  })
})
