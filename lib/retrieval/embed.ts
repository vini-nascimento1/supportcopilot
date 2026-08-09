import "server-only"

// Embedding client for the retrieval corpus. Routed through the same
// process-wide throttle as every other OpenAI call (lib/ai-throttle.ts) so a
// nightly re-ingest of the whole corpus cannot stampede the org key alongside
// live drafting — the exact failure that made the reply queue hang before the
// throttle existed.
//
// DIMENSION CONTRACT: the model's output width must match the halfvec(3072)
// column in knowledge_chunks. pgvector caps HNSW at 2000 dims for `vector`,
// which is why the column is halfvec — see the create_knowledge_chunks
// migration. If the org key cannot reach text-embedding-3-large, change
// EMBEDDING_MODEL, EMBEDDING_DIMENSIONS and the column type together, and
// re-embed the whole corpus (checksums won't catch a model swap).

import { withAiSlot, openaiFetch, openaiApiKey } from "@/lib/ai-throttle"

export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large"
export const EMBEDDING_DIMENSIONS = 3072

// OpenAI accepts large batches, but a failed batch costs the whole batch. 96 is
// small enough to retry cheaply and large enough that the corpus (~500 chunks
// today) is a handful of calls.
const BATCH_SIZE = 96
const EMBED_TIMEOUT_MS = 60_000

export type EmbeddingResult =
  | { ok: true; embeddings: number[][] }
  | { ok: false; error: string }

function toPgHalfvec(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

/** Formats embeddings as pgvector literals ready for insert. */
export function toVectorLiterals(embeddings: number[][]): string[] {
  return embeddings.map(toPgHalfvec)
}

async function embedBatch(inputs: string[]): Promise<EmbeddingResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS)

  try {
    const res = await withAiSlot(
      () =>
        openaiFetch("embeddings", {
          method: "POST",
          body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: inputs,
          }),
          signal: controller.signal,
        }),
      controller.signal
    )

    if (!res.ok) {
      const detail = await res.text().catch(() => "unknown")
      console.error(`[retrieval/embed] provider error ${res.status}:`, detail.slice(0, 500))
      return { ok: false, error: `embedding provider error (${res.status})` }
    }

    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>
    }
    const rows = data.data ?? []
    if (rows.length !== inputs.length) {
      return { ok: false, error: `expected ${inputs.length} embeddings, got ${rows.length}` }
    }

    // The API may return out of order; `index` is authoritative.
    const ordered: number[][] = new Array(inputs.length)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const at = typeof row.index === "number" ? row.index : i
      const embedding = row.embedding
      if (!Array.isArray(embedding)) return { ok: false, error: `missing embedding at index ${at}` }
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        // Fail loudly rather than writing a wrong-width vector the column will
        // reject anyway — the error is far clearer here.
        return {
          ok: false,
          error: `dimension mismatch: model returned ${embedding.length}, schema expects ${EMBEDDING_DIMENSIONS}`,
        }
      }
      ordered[at] = embedding
    }

    return { ok: true, embeddings: ordered }
  } catch (e) {
    const err = e as Error
    console.error("[retrieval/embed] request failed:", err.name, err.message)
    return { ok: false, error: err.message }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Embeds many texts, batched. Returns an error for the WHOLE call if any batch
 * fails: a partially-embedded corpus is worse than an unchanged one, because
 * retrieval would silently score against a half-updated index.
 */
export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  if (!openaiApiKey()) return { ok: false, error: "OPENAI_API_KEY not configured" }
  if (texts.length === 0) return { ok: true, embeddings: [] }

  const all: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const result = await embedBatch(batch)
    if (!result.ok) return result
    all.push(...result.embeddings)
  }
  return { ok: true, embeddings: all }
}

/** Single-text convenience for the query side of retrieval. */
export async function embedQuery(text: string): Promise<{ ok: true; embedding: number[] } | { ok: false; error: string }> {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: "empty query" }
  const result = await embedTexts([trimmed])
  if (!result.ok) return result
  return { ok: true, embedding: result.embeddings[0] }
}
