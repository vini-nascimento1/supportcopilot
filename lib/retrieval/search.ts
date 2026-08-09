// Hybrid retrieval over knowledge_chunks. The ranking maths here is PURE and
// unit-tested; the DB/embedding I/O lives in searchKnowledge() at the bottom
// behind a dynamic import, the same pure/IO split lib/playbook-gate.ts uses.
//
// Why hybrid rather than vectors alone: support tickets are full of exact
// identifiers that embeddings blur — SYS_CB911, W-8BEN, auto_ban_high_risk_country,
// BIN 429544. Full-text nails those; vectors handle "my payment didn't go
// through" matching a page titled "Failed / declined payment". Reciprocal Rank
// Fusion merges both without tunable weights that drift out of date.
//
// Why abstain matters more than ranking: playbook-matched drafts were approved
// 57.6% of the time vs 67.5% when nothing matched (n=1,201). Retrieving the
// least-bad passage was actively worse than retrieving nothing, because the
// model then wrote confident prose grounded in the wrong thing. Returning no
// evidence is a first-class, correct outcome here.

export type RetrievedChunk = {
  chunkId: string
  sourceKind: string
  sourceId: string
  sourceUrl: string | null
  title: string
  headingPath: string | null
  section: string
  content: string
  visibility: "customer_safe" | "internal_only"
  /** 1-based rank from the vector arm, null if that arm didn't surface it. */
  vectorRank: number | null
  vectorScore: number | null
  lexicalRank: number | null
  lexicalScore: number | null
}

export type FusedChunk = RetrievedChunk & {
  /** Reciprocal Rank Fusion score. Higher is better. */
  fusedScore: number
  /** True when both arms surfaced it — the strongest signal we have. */
  agreed: boolean
}

export type SearchOutcome = {
  passages: FusedChunk[]
  /** True when nothing cleared the bar and we deliberately returned no evidence. */
  abstained: boolean
  reason: "ok" | "abstain_low_score" | "abstain_no_hits" | "error"
  error: string | null
}

// ── Tuning ──────────────────────────────────────────────────────────────────

/**
 * Standard RRF constant. Damps the difference between adjacent top ranks so a
 * narrow win in one arm can't dominate agreement across both.
 */
export const RRF_K = 60

/**
 * Minimum fused score to return anything. Derived from RRF arithmetic rather
 * than guessed: a chunk ranked #1 by a single arm scores 1/(60+1) = 0.0164, so
 * this floor admits a confident single-arm hit while rejecting the long tail
 * (rank 10+ in one arm scores 0.0143). Re-tune against the golden set — it is
 * exported so the eval can sweep it.
 */
export const DEFAULT_ABSTAIN_THRESHOLD = 0.016

/** How many passages reach the prompt. Beyond ~6 the model starts averaging. */
export const DEFAULT_TOP_N = 6

// ── Pure ranking ────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion: score = sum over arms of 1/(k + rank). A chunk found
 * by both arms accumulates two terms and outranks a chunk that only one arm
 * loved, which is exactly the behaviour we want — agreement between an
 * embedding and a keyword match is strong evidence of genuine relevance.
 */
export function fuseRankings(chunks: RetrievedChunk[], k: number = RRF_K): FusedChunk[] {
  return chunks
    .map((chunk) => {
      let score = 0
      if (chunk.vectorRank !== null) score += 1 / (k + chunk.vectorRank)
      if (chunk.lexicalRank !== null) score += 1 / (k + chunk.lexicalRank)
      return {
        ...chunk,
        fusedScore: score,
        agreed: chunk.vectorRank !== null && chunk.lexicalRank !== null,
      }
    })
    .sort((a, b) => {
      if (b.fusedScore !== a.fusedScore) return b.fusedScore - a.fusedScore
      // Deterministic tie-break so identical inputs always produce identical
      // prompts — otherwise eval runs are not reproducible.
      if (a.agreed !== b.agreed) return a.agreed ? -1 : 1
      return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0
    })
}

/**
 * Caps how many chunks any one source can contribute. Without this a single
 * long playbook wins every slot with four field-chunks and crowds out the
 * approved customer-facing macro that actually answers the question.
 */
export function diversify(chunks: FusedChunk[], maxPerSource: number, topN: number): FusedChunk[] {
  const seen = new Map<string, number>()
  const out: FusedChunk[] = []

  for (const chunk of chunks) {
    if (out.length >= topN) break
    const key = `${chunk.sourceKind}:${chunk.sourceId}`
    const used = seen.get(key) ?? 0
    if (used >= maxPerSource) continue
    seen.set(key, used + 1)
    out.push(chunk)
  }

  return out
}

/**
 * The abstain decision. Returns evidence only when the top hit clears the
 * floor; otherwise returns nothing so the draft layer asks a question instead
 * of inventing an answer from a weak match.
 */
export function decideOutcome(
  fused: FusedChunk[],
  opts: { threshold?: number; topN?: number; maxPerSource?: number } = {}
): SearchOutcome {
  const threshold = opts.threshold ?? DEFAULT_ABSTAIN_THRESHOLD
  const topN = opts.topN ?? DEFAULT_TOP_N
  const maxPerSource = opts.maxPerSource ?? 2

  if (fused.length === 0) {
    return { passages: [], abstained: true, reason: "abstain_no_hits", error: null }
  }
  if (fused[0].fusedScore < threshold) {
    return { passages: [], abstained: true, reason: "abstain_low_score", error: null }
  }

  // Only passages that individually clear the floor — a strong #1 must not drag
  // three weak ones into the prompt alongside it.
  const qualified = fused.filter((c) => c.fusedScore >= threshold)
  return {
    passages: diversify(qualified, maxPerSource, topN),
    abstained: false,
    reason: "ok",
    error: null,
  }
}

/**
 * Splits retrieved passages for the prompt. The customer-safe/internal-only
 * firewall already lives in the DB column and in match_knowledge_chunks'
 * include_internal default, so this is the third layer: even given an
 * internal chunk, the prompt builder can never file it under "you may ground
 * your reply on this".
 */
export function partitionByVisibility(passages: FusedChunk[]): {
  customerSafe: FusedChunk[]
  internalOnly: FusedChunk[]
} {
  return {
    customerSafe: passages.filter((p) => p.visibility === "customer_safe"),
    internalOnly: passages.filter((p) => p.visibility !== "customer_safe"),
  }
}

/** Builds the retrieval query text from a ticket. Pure so the eval can reuse it. */
export function buildQueryText(parts: Array<string | null | undefined>, maxChars = 2000): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .join("\n")
    .slice(0, maxChars)
    .trim()
}

// ── Row mapping ─────────────────────────────────────────────────────────────

type RawRow = {
  id: string
  source_kind: string
  source_id: string
  source_url: string | null
  title: string
  heading_path: string | null
  section: string
  content: string
  visibility: string
  vector_rank: number | null
  vector_score: number | null
  lexical_rank: number | null
  lexical_score: number | null
}

export function mapRows(rows: RawRow[]): RetrievedChunk[] {
  return rows.map((r) => ({
    chunkId: r.id,
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    sourceUrl: r.source_url,
    title: r.title,
    headingPath: r.heading_path,
    section: r.section ?? "",
    content: r.content,
    // Fail closed: anything not explicitly customer_safe is treated as internal.
    visibility: r.visibility === "customer_safe" ? "customer_safe" : "internal_only",
    vectorRank: r.vector_rank,
    vectorScore: r.vector_score,
    lexicalRank: r.lexical_rank,
    lexicalScore: r.lexical_score,
  }))
}

// ── Live search (server-only I/O) ───────────────────────────────────────────

export type SearchOptions = {
  /** Include internal_only chunks as internal context. Never customer-quotable. */
  includeInternal?: boolean
  matchCount?: number
  topN?: number
  threshold?: number
  maxPerSource?: number
}

/**
 * Embeds the query, runs hybrid recall in one round trip, fuses and decides.
 * Never throws: on any failure it returns an abstain outcome with the error
 * attached, so the draft pipeline degrades to "no evidence" rather than
 * breaking a customer reply.
 */
export async function searchKnowledge(
  queryText: string,
  opts: SearchOptions = {}
): Promise<SearchOutcome> {
  const query = queryText.trim()
  if (!query) {
    return { passages: [], abstained: true, reason: "abstain_no_hits", error: null }
  }

  try {
    const [{ embedQuery }, { getSupabaseAdminClient }] = await Promise.all([
      import("@/lib/retrieval/embed"),
      import("@/lib/supabase-admin"),
    ])

    const db = getSupabaseAdminClient()
    if (!db) {
      return { passages: [], abstained: true, reason: "error", error: "no supabase admin client" }
    }

    const embedded = await embedQuery(query)
    if (!embedded.ok) {
      return { passages: [], abstained: true, reason: "error", error: embedded.error }
    }

    const { data, error } = await db.rpc("match_knowledge_chunks", {
      query_embedding: `[${embedded.embedding.join(",")}]`,
      query_text: query,
      match_count: opts.matchCount ?? 30,
      include_internal: opts.includeInternal ?? false,
    })
    if (error) {
      console.error("[retrieval/search] rpc failed:", error.message)
      return { passages: [], abstained: true, reason: "error", error: error.message }
    }

    const fused = fuseRankings(mapRows((data ?? []) as RawRow[]))
    return decideOutcome(fused, {
      threshold: opts.threshold,
      topN: opts.topN,
      maxPerSource: opts.maxPerSource,
    })
  } catch (e) {
    const message = (e as Error).message
    console.error("[retrieval/search] failed:", message)
    return { passages: [], abstained: true, reason: "error", error: message }
  }
}
