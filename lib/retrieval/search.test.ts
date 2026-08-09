import { describe, it, expect } from "vitest"

import {
  DEFAULT_ABSTAIN_THRESHOLD,
  RRF_K,
  buildQueryText,
  decideOutcome,
  diversify,
  fuseRankings,
  mapRows,
  partitionByVisibility,
  type FusedChunk,
  type RetrievedChunk,
} from "./search"

const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: "c1",
  sourceKind: "playbook",
  sourceId: "pb-1",
  sourceUrl: null,
  title: "Chargebacks",
  headingPath: "Chargebacks > resolution",
  section: "resolution",
  content: "Never tell the fan to dispute.",
  visibility: "customer_safe",
  vectorRank: 1,
  vectorScore: 0.9,
  lexicalRank: null,
  lexicalScore: null,
  ...over,
})

const fused = (over: Partial<FusedChunk> = {}): FusedChunk => ({
  ...chunk(),
  fusedScore: 0.02,
  agreed: false,
  ...over,
})

describe("fuseRankings", () => {
  it("ranks a chunk found by both arms above one found by a single arm", () => {
    const result = fuseRankings([
      chunk({ chunkId: "vector-only", vectorRank: 1, lexicalRank: null }),
      chunk({ chunkId: "both", vectorRank: 2, lexicalRank: 2 }),
    ])
    expect(result[0].chunkId).toBe("both")
    expect(result[0].agreed).toBe(true)
  })

  it("computes the standard RRF score", () => {
    const [only] = fuseRankings([chunk({ vectorRank: 1, lexicalRank: null })])
    expect(only.fusedScore).toBeCloseTo(1 / (RRF_K + 1), 10)

    const [both] = fuseRankings([chunk({ vectorRank: 1, lexicalRank: 1 })])
    expect(both.fusedScore).toBeCloseTo(2 / (RRF_K + 1), 10)
  })

  it("orders by descending score", () => {
    const result = fuseRankings([
      chunk({ chunkId: "low", vectorRank: 20 }),
      chunk({ chunkId: "high", vectorRank: 1 }),
      chunk({ chunkId: "mid", vectorRank: 5 }),
    ])
    expect(result.map((r) => r.chunkId)).toEqual(["high", "mid", "low"])
  })

  it("breaks ties deterministically so identical input yields identical prompts", () => {
    const input = [
      chunk({ chunkId: "zebra", vectorRank: 3 }),
      chunk({ chunkId: "alpha", vectorRank: 3 }),
    ]
    expect(fuseRankings(input).map((r) => r.chunkId)).toEqual(["alpha", "zebra"])
    expect(fuseRankings([...input].reverse()).map((r) => r.chunkId)).toEqual(["alpha", "zebra"])
  })

  it("handles a chunk missing from both arms without producing NaN", () => {
    const [result] = fuseRankings([chunk({ vectorRank: null, lexicalRank: null })])
    expect(result.fusedScore).toBe(0)
    expect(result.agreed).toBe(false)
  })
})

describe("diversify", () => {
  it("caps how many chunks one source can contribute", () => {
    const input = [
      fused({ chunkId: "a", sourceId: "pb-1", fusedScore: 0.05 }),
      fused({ chunkId: "b", sourceId: "pb-1", fusedScore: 0.04 }),
      fused({ chunkId: "c", sourceId: "pb-1", fusedScore: 0.03 }),
      fused({ chunkId: "d", sourceId: "macro-9", sourceKind: "macro", fusedScore: 0.02 }),
    ]
    const out = diversify(input, 2, 6)
    expect(out.map((c) => c.chunkId)).toEqual(["a", "b", "d"])
  })

  it("stops at topN", () => {
    const input = Array.from({ length: 10 }, (_, i) =>
      fused({ chunkId: `c${i}`, sourceId: `s${i}`, fusedScore: 0.05 })
    )
    expect(diversify(input, 2, 3)).toHaveLength(3)
  })

  it("treats the same source_id under different kinds as distinct sources", () => {
    const input = [
      fused({ chunkId: "a", sourceKind: "playbook", sourceId: "x" }),
      fused({ chunkId: "b", sourceKind: "macro", sourceId: "x" }),
    ]
    expect(diversify(input, 1, 6).map((c) => c.chunkId)).toEqual(["a", "b"])
  })
})

describe("decideOutcome — abstain is a first-class result", () => {
  it("abstains when nothing was retrieved at all", () => {
    const outcome = decideOutcome([])
    expect(outcome.abstained).toBe(true)
    expect(outcome.reason).toBe("abstain_no_hits")
    expect(outcome.passages).toEqual([])
  })

  it("abstains when the best hit is below the floor, rather than returning the least-bad passage", () => {
    const outcome = decideOutcome([fused({ fusedScore: DEFAULT_ABSTAIN_THRESHOLD - 0.001 })])
    expect(outcome.abstained).toBe(true)
    expect(outcome.reason).toBe("abstain_low_score")
    expect(outcome.passages).toEqual([])
  })

  it("returns evidence when the top hit clears the floor", () => {
    const outcome = decideOutcome([fused({ fusedScore: DEFAULT_ABSTAIN_THRESHOLD + 0.01 })])
    expect(outcome.abstained).toBe(false)
    expect(outcome.reason).toBe("ok")
    expect(outcome.passages).toHaveLength(1)
  })

  it("drops weak passages riding along behind a strong one", () => {
    const outcome = decideOutcome([
      fused({ chunkId: "strong", sourceId: "a", fusedScore: 0.05 }),
      fused({ chunkId: "weak", sourceId: "b", fusedScore: 0.001 }),
    ])
    expect(outcome.passages.map((p) => p.chunkId)).toEqual(["strong"])
  })

  it("admits a confident single-arm hit at the default threshold", () => {
    // A rank-1 hit from one arm scores 1/(60+1) = 0.0164, just above the floor.
    const [topHit] = fuseRankings([chunk({ vectorRank: 1, lexicalRank: null })])
    expect(decideOutcome([topHit]).abstained).toBe(false)
  })

  it("rejects a long-tail single-arm hit at the default threshold", () => {
    const [tail] = fuseRankings([chunk({ vectorRank: 15, lexicalRank: null })])
    expect(decideOutcome([tail]).abstained).toBe(true)
  })
})

describe("partitionByVisibility — the third firewall layer", () => {
  it("separates customer-safe from internal passages", () => {
    const { customerSafe, internalOnly } = partitionByVisibility([
      fused({ chunkId: "safe", visibility: "customer_safe" }),
      fused({ chunkId: "internal", visibility: "internal_only" }),
    ])
    expect(customerSafe.map((c) => c.chunkId)).toEqual(["safe"])
    expect(internalOnly.map((c) => c.chunkId)).toEqual(["internal"])
  })

  it("never lets an internal passage into the customer-safe list", () => {
    const { customerSafe } = partitionByVisibility([
      fused({ visibility: "internal_only" }),
      fused({ chunkId: "b", visibility: "internal_only" }),
    ])
    expect(customerSafe).toEqual([])
  })
})

describe("mapRows", () => {
  it("fails closed on an unrecognised visibility value", () => {
    const [mapped] = mapRows([
      {
        id: "c1",
        source_kind: "notion",
        source_id: "n1",
        source_url: null,
        title: "T",
        heading_path: null,
        section: "",
        content: "body",
        visibility: "something_new",
        vector_rank: 1,
        vector_score: 0.5,
        lexical_rank: null,
        lexical_score: null,
      },
    ])
    expect(mapped.visibility).toBe("internal_only")
  })
})

describe("buildQueryText", () => {
  it("joins present parts and drops empty ones", () => {
    expect(buildQueryText(["subject", null, "  ", "body"])).toBe("subject\nbody")
  })

  it("caps length so a long thread can't blow the embedding budget", () => {
    expect(buildQueryText(["x".repeat(5000)], 100)).toHaveLength(100)
  })

  it("returns empty string when there is nothing to search for", () => {
    expect(buildQueryText([null, undefined, "   "])).toBe("")
  })
})
