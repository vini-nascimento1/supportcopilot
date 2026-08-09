---
title: Retrieval Architecture
area: AI Pipeline
status: in-progress
added: 2026-08-09
---

# Retrieval Architecture

How the draft pipeline finds the knowledge it grounds a reply on. Replaces the
winner-take-all playbook gate and the hosted-Notion-MCP highlight path described
in [[Draft Verify Pipeline]] and [[Notion MCP Integration]].

**Status: built, flagged off.** `RETRIEVAL_V2` defaults to off. Both paths are
runnable so the frozen eval set can score them on identical inputs. It ships on
evidence, not judgement — see [Ship criteria](#ship-criteria).

## Why this exists

The old retrieval was measurably net-negative. From `reply_queue_events`
(n=1,201 real human decisions on AI drafts):

| Bucket | n | Approve | Edit | Reject |
|---|---|---|---|---|
| Playbook matched | 1007 | **57.6%** | 28.1% | 14.3% |
| No playbook matched | 194 | **67.5%** | 18.6% | 13.9% |

Matching a playbook made the draft **worse**. Four compounding causes:

1. **Winner-take-all.** `lib/playbook-gate.ts` is an LLM classifier over
   `case_type + aliases` strings — no embeddings, no passages. It picks exactly
   one playbook out of 61, or nothing.
2. **A wrong match raised the trust signal.** `deriveRiskBand` returned `ready`
   on `gateMatched` alone, so the worst drafts arrived wearing the highest
   confidence badge.
3. **Grounding was a teaser.** The Notion MCP returns `highlight` (~200 chars),
   injected verbatim as the grounding text, behind a per-agent OAuth token that
   silently returns nothing when an agent hasn't connected Notion.
4. **The KB article layer was empty.** `searchArticles` passed the entire ticket
   as one Intercom `~` (contains) needle, so it essentially never matched — the
   layer the prompt calls "your factual source of truth".

Gate confidence was not predictive either: approvals averaged 0.792, edits
0.835. Edits scored *higher*.

## The corpus: `knowledge_chunks`

| column | purpose |
|---|---|
| `source_kind` | `playbook` \| `response` \| `macro` \| `notion` \| `article` |
| `source_id`, `source_url`, `title`, `heading_path` | provenance for citations |
| `section`, `chunk_index` | natural key with the two above |
| `content` | the passage the model actually reads |
| `visibility` | `customer_safe` \| `internal_only` — the firewall |
| `embedding` | `halfvec(3072)`, HNSW cosine |
| `content_tsv` | generated tsvector, GIN indexed (lexical arm) |
| `checksum`, `indexed_at` | incremental re-ingest |

**Why `halfvec`, not `vector`:** pgvector caps HNSW at **2000 dimensions** for
the `vector` type — verified against this database, which rejects
`vector(3072)` with *"column cannot have more than 2000 dimensions for hnsw
index"*. `halfvec(3072)` indexes fine and keeps full `text-embedding-3-large`
dimensionality at fp16. If the org key ever loses access to `-large`, change
`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` and the column type **together** and
re-embed everything — checksums do not detect a model swap.

### Chunking is field-level, not window-level

Playbooks are chunked **per field** (`recognize` / `checks` / `resolution` /
`dos_donts`). The corpus is already semantically structured: "does this case
apply to me?" and "what do I do?" are different questions and must rank
independently. At 1,958 chars average (max 7,768), one embedding per playbook
produces a single blurred vector that matches everything weakly — which is
cause #1 above. Responses and macros are atomic (one chunk). Notion splits on
heading boundaries, then ~800-token windows with ~100-token overlap, carrying
the `heading_path` into the embedded text so an isolated window still knows
what it is about.

## The firewall has four layers

Internal material (Slack, Drive, Linear, fraud/compliance procedure, playbook
bodies naming Fadmin and ban codes) must never reach customer-facing text.

1. **Column default** — `visibility` defaults to `internal_only`, so a
   mis-ingest fails closed.
2. **Ingest classification** — reuses `isInternalSource()` from
   [[Notion MCP Integration]]: a Notion `page` is first-class support knowledge,
   every connector type is internal.
3. **SQL** — `match_knowledge_chunks(..., include_internal)` defaults to
   **false**. A caller that forgets cannot leak.
4. **Prompt** — `buildEvidenceSection()` renders internal passages in a separate
   section that explicitly forbids quoting, naming the source, or revealing that
   an internal source exists.

## Hybrid search

`lib/retrieval/search.ts`. Ranking is pure and unit-tested; the I/O sits behind
a dynamic import, the same split [[System Prompt Architecture]] notes for
`lib/playbook-gate.ts`.

1. **Vector arm** — cosine top-30 via HNSW.
2. **Lexical arm** — `websearch_to_tsquery` top-30. Vectors blur exact
   identifiers; this catches `SYS_CB911`, `W-8BEN`,
   `auto_ban_high_risk_country`, a BIN.
3. **Fusion** — Reciprocal Rank Fusion, `score = Σ 1/(60 + rank)`. No tunable
   weights to drift. A chunk found by **both** arms accumulates two terms and
   outranks a single-arm favourite, because agreement between an embedding and a
   keyword match is strong evidence of real relevance.
4. **Diversity cap** — max 2 chunks per source, so one long playbook's four
   field-chunks can't crowd out the macro that actually answers the question.
5. **Abstain** — below `DEFAULT_ABSTAIN_THRESHOLD` (0.016, derived from the RRF
   arithmetic: a rank-1 single-arm hit scores 1/61 = 0.0164) it returns **no
   evidence at all**.

**Abstaining is the point, not a fallback.** Retrieving the least-bad passage
was worse than retrieving nothing — that is what the 57.6% vs 67.5% gap
measures. Silence beats a confident wrong playbook.

## Risk band, rebased

`deriveEvidenceRiskBand()` in `lib/reply-queue.ts` replaces "gate matched →
ready". `ready` now requires a passage **both arms agreed on** *and* something
customer-safe to ground the reply in. Capability-gap and `requires_manual_action`
locks are unchanged and still outrank everything.

The playbook gate deliberately **still runs** under v2. It no longer grounds the
draft, but `requires_manual_action` is a safety control that locks the send when
a human must do a system step the AI can't. Folding that flag into the retrieved
chunks would remove the extra LLM call; until then correctness beats the saving.

## Eval: how this gets to ship

`lib/retrieval/eval.ts` + `lib/retrieval/golden-set.json`.

- **361 cases** frozen from `reply_queue_events`, stratified across 15
  action/risk-band/playbook cells. 285 paired (AI draft + what the human
  actually sent) and a 76-case reject cohort.
- Frozen by a **cutoff timestamp plus a deterministic md5 ordering** rather than
  361 hardcoded ids. Rows at or before the cutoff never change, so the rule
  reproduces the same set forever, and `verifyGoldenSet()` fails loudly if the
  counts drift.
- Metrics: grounded support (primary), word-level divergence from the sent text,
  recall@k, abstain rate on the reject cohort, guardrail regressions.

### Ship criteria

`compareRuns()` blocks the cutover unless **all** hold:

- grounded support up by at least 2pp overall,
- **zero** new guardrail hits (chargeback advice, fabricated flows, keyword
  gating — see [[System Prompt Architecture]] §3b),
- no stratum down more than 5pp.

Reporting is per-stratum. A regression in a small-but-important cell
(`needs_check/nopb`, n=5) must not be averaged away by the headline.

## Ingest

`lib/retrieval/ingest.ts`, driven by `app/api/cron/reindex-knowledge`
(`x-cron-secret`, same pattern as the triage sweep). Checksum-gated, so a
nightly run with no content edits embeds nothing. Deletes orphaned chunks and
whole removed sources — without that, deleting a playbook leaves its guidance
retrievable forever, serving dead policy.

Embedding goes through `withAiSlot` so a full re-ingest can't stampede the org
key alongside live drafting.

**Notion is not ingested yet.** The live path uses a per-agent OAuth token,
which is wrong for a background job — it would index whatever one arbitrary
agent happens to see. It needs a service-level credential and an explicit page
allowlist, since ingest copies confidential fraud/compliance material into the
app database.

## Key files

- `lib/retrieval/chunk.ts` — pure chunking + `diffChunks()`
- `lib/retrieval/embed.ts` — batched embeddings through the shared throttle
- `lib/retrieval/ingest.ts` — incremental corpus rebuild
- `lib/retrieval/search.ts` — RRF, diversity, abstain, `searchKnowledge()`
- `lib/retrieval/eval.ts` + `golden-set.json` — offline eval
- `lib/retrieval/flag.ts` — `RETRIEVAL_V2`
- `lib/draft-ai.ts` — `buildEvidenceSection()`, `buildEvidenceSystemPrompt()`
- `lib/reply-queue.ts` — `deriveEvidenceRiskBand()`
- Migrations: `create_knowledge_chunks`, `create_match_knowledge_chunks`

## Data flow

```
ticket text
     │
     ├─ embedQuery() ──────────────┐
     │                             ▼
     └─ raw text ──▶ match_knowledge_chunks(embedding, text, include_internal=false)
                             │
                     vector top-30 + lexical top-30
                             │
                             ▼
                     fuseRankings()   (RRF, k=60)
                             │
                     diversify()      (max 2 per source)
                             │
                     decideOutcome()  ──▶ abstain? ──▶ no evidence, ask a question
                             │
                             ▼
                partitionByVisibility()
                   customer_safe │ internal_only
                             │
                             ▼
                  buildEvidenceSection()  ──▶ numbered, cited passages
                             │
                             ▼
              deriveEvidenceRiskBand() ──▶ ready | needs_check | low_confidence
```

See also: [[Draft Verify Pipeline]], [[System Prompt Architecture]],
[[Database Schema Reference]], [[Notion MCP Integration]].
