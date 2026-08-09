// Feature flag for retrieval v2 (chunked corpus + hybrid search + evidence
// prompt) versus v1 (playbook gate + Notion MCP highlights).
//
// Default OFF. v2 does not ship on judgement — it ships when the frozen golden
// set in lib/retrieval/eval.ts shows a material gain in grounded support with
// zero guardrail regressions and no stratum down more than 5pp. Until then both
// paths stay runnable so the eval can score them on identical inputs.
//
// Pure and dependency-free so prompt/pipeline modules can read it without
// dragging in server-only code.

export function isRetrievalV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RETRIEVAL_V2 === "1" || env.RETRIEVAL_V2 === "true"
}
