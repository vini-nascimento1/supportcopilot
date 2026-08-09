/**
 * Offline retrieval eval runner.
 *
 *   npx tsx scripts/eval-retrieval.mts --arm=v2 [--out=baseline.json]
 *   npx tsx scripts/eval-retrieval.mts --compare baseline.json candidate.json
 *
 * Scores a retrieval arm against the frozen golden set in
 * lib/retrieval/golden-set.json (361 cases from reply_queue_events: 285 with
 * the text a human actually sent, plus a 76-case reject cohort).
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (hydrate cases, run retrieval)
 * and OPENAI_API_KEY (embeddings + the grounded-support judge). It reads bodies
 * from the database at run time and never writes customer text to disk — only
 * aggregate scores land in the output file.
 *
 * The scoring maths lives in lib/retrieval/eval.ts and is unit-tested; this
 * file is just I/O and orchestration.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

import {
  aggregate,
  abstainedCorrectly,
  compareRuns,
  divergence,
  goldenSetManifest,
  groundedSupport,
  recallAtK,
  verifyGoldenSet,
  type CaseResult,
  type EvalPassage,
  type EvalReport,
} from "../lib/retrieval/eval"
import { DEFAULT_ABSTAIN_THRESHOLD } from "../lib/retrieval/search"

// ── env ─────────────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
    }
  } catch {
    // fall through to process.env
  }
  return { ...env, ...process.env } as Record<string, string>
}

const env = loadEnv()

function requireEnv(key: string): string {
  const value = env[key]
  if (!value || value === "[SENSITIVE]") {
    console.error(
      `\n${key} is missing or a placeholder.\n` +
        `Restore .env.local (vercel env pull --environment=production) before running the eval.\n`
    )
    process.exit(1)
  }
  return value
}

// ── golden set hydration ────────────────────────────────────────────────────

type GoldenCase = {
  id: string
  stratum: string
  action: "approve" | "edit" | "reject"
  suggestedBody: string
  finalBody: string | null
  conversationId: string
}

const GOLDEN_SQL = `
with base as (
  select id, action, coalesce(risk_band,'unknown') as band,
         case when playbook_id is not null then 'pb' else 'nopb' end as pb,
         suggested_body, final_body, intercom_conversation_id
  from reply_queue_events
  where suggested_body is not null and created_at <= $1::timestamptz
),
strata as (
  select *, action || '/' || band || '/' || pb as stratum,
         count(*) over (partition by action, band, pb) as stratum_n,
         row_number() over (partition by action, band, pb order by md5(id::text)) as rn
  from base
)
select id, stratum, action, suggested_body, final_body, intercom_conversation_id
from strata
where rn <= least(stratum_n, greatest(12, ceil(stratum_n * 0.25)))
`

async function hydrateGoldenSet(): Promise<GoldenCase[]> {
  const supabase = createClient(
    requireEnv("SUPABASE_URL") ?? requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  )
  const manifest = goldenSetManifest()

  // Executed through an RPC-less raw query helper; the selection rule is kept
  // identical to golden-set.json so the frozen set is reproducible.
  const { data, error } = await supabase.rpc("exec_eval_golden_set", { cutoff: manifest.cutoff })
  if (error) {
    console.error(
      "\nCould not hydrate the golden set. Create this helper once:\n\n" +
        `create or replace function exec_eval_golden_set(cutoff text)\n` +
        `returns table (id uuid, stratum text, action text, suggested_body text, final_body text, intercom_conversation_id text)\n` +
        `language sql stable as $fn$${GOLDEN_SQL.replace(/\$1/g, "cutoff")}$fn$;\n`
    )
    process.exit(1)
  }

  const cases = (data ?? []) as Array<Record<string, unknown>>
  const hydrated: GoldenCase[] = cases.map((r) => ({
    id: String(r.id),
    stratum: String(r.stratum),
    action: r.action as GoldenCase["action"],
    suggestedBody: String(r.suggested_body ?? ""),
    finalBody: (r.final_body as string | null) ?? null,
    conversationId: String(r.intercom_conversation_id ?? ""),
  }))

  // Fail loudly if the frozen set no longer reproduces — otherwise "the
  // baseline" quietly changes meaning between runs.
  const actual: Record<string, number> = {}
  for (const c of hydrated) actual[c.stratum] = (actual[c.stratum] ?? 0) + 1
  const check = verifyGoldenSet(actual)
  if (!check.ok) {
    console.error("\nGolden set drift detected — refusing to run:\n" + check.drift.join("\n"))
    process.exit(1)
  }
  console.log(`Golden set verified: ${hydrated.length} cases across ${Object.keys(actual).length} strata.`)
  return hydrated
}

// ── retrieval arms ──────────────────────────────────────────────────────────

type Arm = (queryText: string) => Promise<{ passages: EvalPassage[]; abstained: boolean }>

async function v2Arm(): Promise<Arm> {
  const { searchKnowledge } = await import("../lib/retrieval/search")
  return async (queryText) => {
    const outcome = await searchKnowledge(queryText, { includeInternal: true })
    return {
      abstained: outcome.abstained,
      passages: outcome.passages.map((p) => ({
        chunkId: p.chunkId,
        sourceKind: p.sourceKind,
        title: p.title,
        content: p.content,
        score: p.fusedScore,
        visibility: p.visibility,
      })),
    }
  }
}

/**
 * v1 baseline: the playbook gate. Notion is intentionally excluded — its
 * per-agent OAuth token isn't available to a script, which is itself one of the
 * reasons v1 grounding was unreliable in production.
 */
async function v1Arm(): Promise<Arm> {
  const { classifyPlaybookMatch, GATE_CONFIDENCE_THRESHOLD } = await import("../lib/playbook-gate")
  const { getPlaybooksDashboardData } = await import("../lib/playbooks")
  const { allRows } = await getPlaybooksDashboardData()

  return async (queryText) => {
    const gate = await classifyPlaybookMatch(queryText, allRows)
    const matched =
      gate.playbookId && gate.confidence >= GATE_CONFIDENCE_THRESHOLD
        ? allRows.find((p) => p.id === gate.playbookId)
        : undefined
    if (!matched) return { passages: [], abstained: true }
    return {
      abstained: false,
      passages: [
        {
          chunkId: matched.id,
          sourceKind: "playbook",
          title: matched.caseType,
          content: [matched.recognize, matched.checks, matched.resolution, matched.dosDonts]
            .filter(Boolean)
            .join("\n"),
          score: gate.confidence,
          visibility: "internal_only",
        },
      ],
    }
  }
}

// ── grounded-support judge ──────────────────────────────────────────────────

const JUDGE_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "grounded_support",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["total_claims", "supported_claims", "supporting_chunk_ids"],
      properties: {
        total_claims: { type: "integer", description: "Factual claims in the sent reply." },
        supported_claims: { type: "integer", description: "How many are supported by the passages." },
        supporting_chunk_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
}

async function judgeGroundedSupport(
  finalBody: string,
  passages: EvalPassage[]
): Promise<{ supported: number; total: number; relevantIds: string[] }> {
  const { openaiFetch } = await import("../lib/ai-throttle")
  const { getAuxDraftModel } = await import("../lib/draft-ai")

  const context = passages
    .map((p) => `[${p.chunkId}] ${p.title} (${p.sourceKind})\n${p.content}`)
    .join("\n\n")

  const res = await openaiFetch("chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: getAuxDraftModel(),
      max_completion_tokens: 1024,
      reasoning_effort: "none",
      response_format: JUDGE_SCHEMA,
      messages: [
        {
          role: "system",
          content:
            "You judge whether a support reply is grounded in retrieved passages. " +
            "Count only FACTUAL claims about policy, process, timelines, or account state — " +
            "ignore greetings, apologies, and tone. A claim is supported only if a passage " +
            "actually states it. List the ids of passages that supported something.",
        },
        {
          role: "user",
          content: `## Retrieved passages\n${context || "(none)"}\n\n## Reply that was actually sent\n${finalBody}\n\nReturn the JSON verdict now.`,
        },
      ],
    }),
  })

  if (!res.ok) return { supported: 0, total: 0, relevantIds: [] }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}")
    return {
      supported: Number(parsed.supported_claims ?? 0),
      total: Number(parsed.total_claims ?? 0),
      relevantIds: Array.isArray(parsed.supporting_chunk_ids) ? parsed.supporting_chunk_ids.map(String) : [],
    }
  } catch {
    return { supported: 0, total: 0, relevantIds: [] }
  }
}

// ── guardrails ──────────────────────────────────────────────────────────────

// Mirrors the rules in lib/draft-ai.ts. A hit here is a hard ship-blocker.
const GUARDRAILS: Array<[string, RegExp]> = [
  ["chargeback advice", /\b(dispute|chargeback)\b[^.]{0,60}\b(bank|card issuer|apple|google|paypal)\b/i],
  ["report-an-issue flow", /report (an issue|a problem)/i],
  ["keyword gating", /\b(reply|respond|type|say)\s+["'“][^"'”]{1,30}["'”]/i],
  ["request-a-review framing", /\b(request|submit) a review\b/i],
]

function guardrailHits(text: string): string[] {
  return GUARDRAILS.filter(([, re]) => re.test(text)).map(([name]) => name)
}

// ── main ────────────────────────────────────────────────────────────────────

async function run(armName: "v1" | "v2", outPath: string | null) {
  requireEnv("OPENAI_API_KEY")
  const cases = await hydrateGoldenSet()
  const arm = armName === "v2" ? await v2Arm() : await v1Arm()

  const results: CaseResult[] = []
  let done = 0

  for (const c of cases) {
    const query = c.suggestedBody.slice(0, 2000)
    const { passages, abstained } = await arm(query)

    const result: CaseResult = {
      id: c.id,
      stratum: c.stratum,
      action: c.action,
      guardrailHits: guardrailHits(c.suggestedBody),
    }

    if (c.action === "reject") {
      // No target text — score whether we correctly declined to retrieve.
      result.abstained = abstained || abstainedCorrectly(passages, DEFAULT_ABSTAIN_THRESHOLD)
    } else if (c.finalBody) {
      const judged = await judgeGroundedSupport(c.finalBody, passages)
      result.groundedSupport = groundedSupport(judged.supported, judged.total)
      result.recallAtK = recallAtK(passages, judged.relevantIds, 6)
      result.divergence = divergence(c.suggestedBody, c.finalBody)
    }

    results.push(result)
    done++
    if (done % 25 === 0) console.log(`  ${done}/${cases.length}`)
  }

  const report = aggregate(results)
  printReport(armName, report)

  if (outPath) {
    writeFileSync(outPath, JSON.stringify({ arm: armName, report }, null, 2))
    console.log(`\nWrote ${outPath}`)
  }
}

function printReport(label: string, report: EvalReport) {
  const pct = (v: number | null) => (v === null ? "   -  " : `${(v * 100).toFixed(1)}%`)
  console.log(`\n=== ${label} — ${report.total} cases ===`)
  console.log("stratum".padEnd(32), "n".padStart(4), "ground".padStart(8), "diverge".padStart(8), "abstain".padStart(8))
  for (const s of report.strata) {
    console.log(
      s.stratum.padEnd(32),
      String(s.n).padStart(4),
      pct(s.meanGroundedSupport).padStart(8),
      pct(s.meanDivergence).padStart(8),
      pct(s.abstainRate).padStart(8)
    )
  }
  console.log(
    "OVERALL".padEnd(32),
    String(report.overall.n).padStart(4),
    pct(report.overall.meanGroundedSupport).padStart(8),
    pct(report.overall.meanDivergence).padStart(8),
    pct(report.overall.abstainRate).padStart(8)
  )
  console.log(`guardrail hits: ${report.guardrailHits}`)
}

function compare(basePath: string, candPath: string) {
  const base = JSON.parse(readFileSync(basePath, "utf8")) as { arm: string; report: EvalReport }
  const cand = JSON.parse(readFileSync(candPath, "utf8")) as { arm: string; report: EvalReport }
  printReport(`baseline (${base.arm})`, base.report)
  printReport(`candidate (${cand.arm})`, cand.report)

  const verdict = compareRuns(base.report, cand.report)
  console.log(`\n=== SHIP VERDICT: ${verdict.pass ? "PASS" : "BLOCKED"} ===`)
  for (const reason of verdict.reasons) console.log(`  - ${reason}`)
  if (!verdict.pass) process.exitCode = 1
}

const args = process.argv.slice(2)
if (args[0] === "--compare") {
  compare(args[1], args[2])
} else {
  const arm = (args.find((a) => a.startsWith("--arm="))?.split("=")[1] ?? "v2") as "v1" | "v2"
  const out = args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? null
  run(arm, out).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
