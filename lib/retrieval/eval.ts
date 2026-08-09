// Offline eval scoring for the retrieval rebuild. PURE + unit-tested: no
// `server-only`, no top-level I/O, no DB/LLM calls (mirrors lib/playbook-gate.ts
// and lib/notion-retrieval.ts). The runner (scripts/eval-retrieval.mts) does the
// I/O and feeds results through these functions.
//
// Why this exists at all: the retrieval rebuild is being made against a measured
// baseline, not a hunch. reply_queue_events holds 1,001 pairs of (what the AI
// drafted, what the human actually sent) plus approve/edit/reject — the only
// ground truth we have about whether retrieval surfaced the right thing.
//
// The headline finding this harness has to be able to reproduce and then move:
// playbook-matched drafts were approved 57.6% of the time vs 67.5% when nothing
// matched (n=1,201). Retrieval was net-negative.

import goldenSet from "./golden-set.json"

export type EvalAction = "approve" | "edit" | "reject"

export type GoldenCase = {
  id: string
  stratum: string
  action: EvalAction
  riskBand: string
  hadPlaybook: boolean
  suggestedBody: string
  /** null for the reject cohort — nothing was sent, so there is no target. */
  finalBody: string | null
}

/** One retrieved passage, as the eval sees it. Mirrors the shape search.ts returns. */
export type EvalPassage = {
  chunkId: string
  sourceKind: string
  title: string
  content: string
  score: number
  visibility: "customer_safe" | "internal_only"
}

// ── Golden set manifest ─────────────────────────────────────────────────────

export type GoldenSetManifest = {
  version: number
  cutoff: string
  total: number
  strata: Record<string, number>
  cohorts: { paired: { total: number }; reject: { total: number } }
}

export function goldenSetManifest(): GoldenSetManifest {
  return goldenSet as GoldenSetManifest
}

/**
 * Guards the frozen set against silent drift. The manifest is reproduced by a
 * deterministic SQL rule rather than a hardcoded id list, which is only safe if
 * we verify the rule still yields what it yielded on the day it was frozen.
 * Rows deleted, bodies nulled, or an edited cutoff all surface here instead of
 * quietly changing what "the baseline" means.
 */
export function verifyGoldenSet(
  actualStrata: Record<string, number>
): { ok: true } | { ok: false; drift: string[] } {
  const expected = goldenSetManifest().strata
  const drift: string[] = []

  for (const [stratum, want] of Object.entries(expected)) {
    const got = actualStrata[stratum] ?? 0
    if (got !== want) drift.push(`${stratum}: expected ${want}, got ${got}`)
  }
  for (const stratum of Object.keys(actualStrata)) {
    if (!(stratum in expected)) drift.push(`${stratum}: unexpected stratum (not in manifest)`)
  }

  return drift.length === 0 ? { ok: true } : { ok: false, drift }
}

// ── Text comparison ─────────────────────────────────────────────────────────

/**
 * Same normalisation as hasBodyChanged() in lib/reply-queue.ts — whitespace-only
 * differences are not edits. Kept consistent deliberately: divergence scores
 * here must agree with the body_changed flag the audit log already records.
 */
export function normalizeBody(s: string): string {
  return s.trim().replace(/\s+/g, " ")
}

/** Levenshtein over words, not characters: we care about content edits, not typos. */
export function wordEditDistance(a: string, b: string): number {
  const from = normalizeBody(a).split(" ").filter(Boolean)
  const to = normalizeBody(b).split(" ").filter(Boolean)
  if (from.length === 0) return to.length
  if (to.length === 0) return from.length

  let prev = Array.from({ length: to.length + 1 }, (_, i) => i)
  for (let i = 1; i <= from.length; i++) {
    const curr = [i]
    for (let j = 1; j <= to.length; j++) {
      const cost = from[i - 1] === to[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[to.length]
}

/**
 * 0 = the human sent the draft untouched, 1 = nothing survived. Normalised by
 * the longer side so a short draft rewritten wholesale still scores ~1.
 */
export function divergence(suggested: string, final: string): number {
  const from = normalizeBody(suggested).split(" ").filter(Boolean)
  const to = normalizeBody(final).split(" ").filter(Boolean)
  const longest = Math.max(from.length, to.length)
  if (longest === 0) return 0
  return Math.min(1, wordEditDistance(suggested, final) / longest)
}

// ── Retrieval quality ───────────────────────────────────────────────────────

/**
 * Did top-k contain the passage(s) the human's answer actually relied on?
 * `relevantIds` comes from the judge pass (which retrieved chunks support
 * final_body); this function is just the arithmetic so it stays testable.
 */
export function recallAtK(
  retrieved: EvalPassage[],
  relevantIds: string[],
  k: number
): number {
  if (relevantIds.length === 0) return 1 // nothing needed → trivially satisfied
  const topK = new Set(retrieved.slice(0, k).map((p) => p.chunkId))
  const hits = relevantIds.filter((id) => topK.has(id)).length
  return hits / relevantIds.length
}

/**
 * Fraction of the human's factual claims supported by retrieved passages.
 * `supported`/`total` come from the LLM judge; aggregation lives here.
 */
export function groundedSupport(supported: number, total: number): number {
  if (total <= 0) return 1
  return Math.max(0, Math.min(1, supported / total))
}

/**
 * The reject cohort's metric. A rejected draft means the evidence was unusable,
 * so the correct new behaviour is usually to abstain (return no evidence and
 * ask a question) rather than to confidently retrieve something else. Scores 1
 * when we abstained on a case the human rejected.
 */
export function abstainedCorrectly(retrieved: EvalPassage[], abstainThreshold: number): boolean {
  if (retrieved.length === 0) return true
  return (retrieved[0]?.score ?? 0) < abstainThreshold
}

/**
 * Hard invariant, not a score: an internal_only passage must never reach a
 * customer-facing section. Any violation fails the run outright — this is the
 * firewall that keeps Slack/Drive/Linear content out of customer replies.
 */
export function firewallViolations(customerSafeSection: EvalPassage[]): EvalPassage[] {
  return customerSafeSection.filter((p) => p.visibility !== "customer_safe")
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export type CaseResult = {
  id: string
  stratum: string
  action: EvalAction
  groundedSupport?: number
  divergence?: number
  recallAtK?: number
  abstained?: boolean
  guardrailHits: string[]
}

export type StratumReport = {
  stratum: string
  n: number
  meanGroundedSupport: number | null
  meanDivergence: number | null
  meanRecallAtK: number | null
  abstainRate: number | null
  guardrailHits: number
}

export type EvalReport = {
  total: number
  strata: StratumReport[]
  overall: StratumReport
  guardrailHits: number
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function summarize(stratum: string, rows: CaseResult[]): StratumReport {
  const abstainRows = rows.filter((r) => r.abstained !== undefined)
  return {
    stratum,
    n: rows.length,
    meanGroundedSupport: mean(rows.flatMap((r) => (r.groundedSupport === undefined ? [] : [r.groundedSupport]))),
    meanDivergence: mean(rows.flatMap((r) => (r.divergence === undefined ? [] : [r.divergence]))),
    meanRecallAtK: mean(rows.flatMap((r) => (r.recallAtK === undefined ? [] : [r.recallAtK]))),
    abstainRate:
      abstainRows.length === 0 ? null : abstainRows.filter((r) => r.abstained).length / abstainRows.length,
    guardrailHits: rows.reduce((n, r) => n + r.guardrailHits.length, 0),
  }
}

/**
 * Per-stratum first, overall second. Reporting only the headline number is how
 * a regression in a small-but-important stratum (e.g. needs_check/nopb, n=5)
 * gets averaged away — the plan commits to reporting per-stratum and to saying
 * so plainly when one regresses.
 */
export function aggregate(results: CaseResult[]): EvalReport {
  const byStratum = new Map<string, CaseResult[]>()
  for (const r of results) {
    const rows = byStratum.get(r.stratum)
    if (rows) rows.push(r)
    else byStratum.set(r.stratum, [r])
  }

  const strata = Array.from(byStratum.entries())
    .map(([stratum, rows]) => summarize(stratum, rows))
    .sort((a, b) => b.n - a.n)

  return {
    total: results.length,
    strata,
    overall: summarize("overall", results),
    guardrailHits: results.reduce((n, r) => n + r.guardrailHits.length, 0),
  }
}

/**
 * Ship/no-ship. A run passes only if it beats baseline on grounded support AND
 * introduces zero guardrail regressions AND regresses no stratum by more than
 * `maxStratumRegression`. Deliberately strict: this is a prod support app where
 * a confident wrong answer reaches a real customer.
 */
export function compareRuns(
  baseline: EvalReport,
  candidate: EvalReport,
  opts: { minOverallGain?: number; maxStratumRegression?: number } = {}
): { pass: boolean; reasons: string[] } {
  const minOverallGain = opts.minOverallGain ?? 0.02
  const maxStratumRegression = opts.maxStratumRegression ?? 0.05
  const reasons: string[] = []

  if (candidate.guardrailHits > baseline.guardrailHits) {
    reasons.push(
      `guardrail regressions: ${baseline.guardrailHits} -> ${candidate.guardrailHits}`
    )
  }

  const base = baseline.overall.meanGroundedSupport
  const cand = candidate.overall.meanGroundedSupport
  if (base !== null && cand !== null) {
    const gain = cand - base
    if (gain < minOverallGain) {
      reasons.push(
        `grounded support gain ${gain.toFixed(3)} below required ${minOverallGain.toFixed(3)}`
      )
    }
  }

  const baseByStratum = new Map(baseline.strata.map((s) => [s.stratum, s]))
  for (const c of candidate.strata) {
    const b = baseByStratum.get(c.stratum)
    if (!b || b.meanGroundedSupport === null || c.meanGroundedSupport === null) continue
    const delta = c.meanGroundedSupport - b.meanGroundedSupport
    if (delta < -maxStratumRegression) {
      reasons.push(`stratum ${c.stratum} regressed ${delta.toFixed(3)} (n=${c.n})`)
    }
  }

  return { pass: reasons.length === 0, reasons }
}
