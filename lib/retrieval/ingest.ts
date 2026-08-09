import "server-only"

// Ingest for the retrieval corpus. Reads the structured sources already in
// Supabase (playbooks, responses, Intercom macros), chunks them with the pure
// helpers in ./chunk, embeds only what changed, and upserts into
// knowledge_chunks.
//
// Mirrors the existing sync pattern in app/api/macros/sync/route.ts:
// service-role writes, upsert on a natural key, never throws into a caller.
//
// Notion is deliberately NOT ingested here yet. The live path uses a per-agent
// OAuth token (lib/notion-mcp-auth-server.ts), which is wrong for a background
// job — it would index whatever one arbitrary agent happens to see. Notion
// ingest needs a service-level credential and an explicit page allowlist,
// since it copies confidential fraud/compliance material into the app DB.

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { embedTexts, toVectorLiterals } from "@/lib/retrieval/embed"
import {
  chunkMacro,
  chunkPlaybook,
  chunkResponse,
  diffChunks,
  type ExistingChunk,
  type KnowledgeChunk,
} from "@/lib/retrieval/chunk"

export type IngestSummary = {
  ok: boolean
  bySource: Record<string, { sources: number; upserted: number; deleted: number; unchanged: number }>
  totalEmbedded: number
  errors: string[]
}

type Db = NonNullable<ReturnType<typeof getSupabaseAdminClient>>

function emptyStats() {
  return { sources: 0, upserted: 0, deleted: 0, unchanged: 0 }
}

// ── Source loaders ──────────────────────────────────────────────────────────

async function loadPlaybookChunks(db: Db): Promise<Map<string, KnowledgeChunk[]>> {
  const { data, error } = await db
    .from("playbooks")
    .select("id, case_type, aliases, recognize, checks, resolution, dos_donts")
  if (error) throw new Error(`playbooks: ${error.message}`)

  const out = new Map<string, KnowledgeChunk[]>()
  for (const row of data ?? []) {
    const chunks = chunkPlaybook({
      id: row.id as string,
      caseType: (row.case_type as string) ?? "",
      aliases: (row.aliases as string[] | null) ?? [],
      recognize: row.recognize as string | null,
      checks: row.checks as string | null,
      resolution: row.resolution as string | null,
      dosDonts: row.dos_donts as string | null,
    })
    if (chunks.length > 0) out.set(row.id as string, chunks)
  }
  return out
}

async function loadResponseChunks(db: Db): Promise<Map<string, KnowledgeChunk[]>> {
  const { data, error } = await db.from("responses").select("id, title, body, playbook_id")
  if (error) throw new Error(`responses: ${error.message}`)

  const out = new Map<string, KnowledgeChunk[]>()
  for (const row of data ?? []) {
    const chunks = chunkResponse({
      id: row.id as string,
      title: (row.title as string) ?? "",
      body: (row.body as string) ?? "",
      playbookId: (row.playbook_id as string | null) ?? null,
    })
    if (chunks.length > 0) out.set(row.id as string, chunks)
  }
  return out
}

async function loadMacroChunks(db: Db): Promise<Map<string, KnowledgeChunk[]>> {
  const { data, error } = await db.from("intercom_macros").select("id, name, body_text, visibility")
  if (error) throw new Error(`intercom_macros: ${error.message}`)

  const out = new Map<string, KnowledgeChunk[]>()
  for (const row of data ?? []) {
    const chunks = chunkMacro({
      id: row.id as string,
      name: (row.name as string) ?? "",
      bodyText: row.body_text as string | null,
      visibility: row.visibility as string | null,
    })
    if (chunks.length > 0) out.set(row.id as string, chunks)
  }
  return out
}

// ── Ingest one source kind ──────────────────────────────────────────────────

async function ingestKind(
  db: Db,
  sourceKind: KnowledgeChunk["sourceKind"],
  freshBySource: Map<string, KnowledgeChunk[]>,
  errors: string[]
): Promise<{ sources: number; upserted: number; deleted: number; unchanged: number }> {
  const stats = emptyStats()
  stats.sources = freshBySource.size

  const { data: existingRows, error: existingError } = await db
    .from("knowledge_chunks")
    .select("source_id, section, chunk_index, checksum")
    .eq("source_kind", sourceKind)
  if (existingError) throw new Error(`read existing ${sourceKind}: ${existingError.message}`)

  const existingBySource = new Map<string, ExistingChunk[]>()
  for (const row of existingRows ?? []) {
    const key = row.source_id as string
    const list = existingBySource.get(key) ?? []
    list.push({
      section: (row.section as string) ?? "",
      chunkIndex: (row.chunk_index as number) ?? 0,
      checksum: (row.checksum as string) ?? "",
    })
    existingBySource.set(key, list)
  }

  const toEmbed: KnowledgeChunk[] = []
  const deletions: Array<{ sourceId: string; section: string; chunkIndex: number }> = []

  for (const [sourceId, fresh] of freshBySource) {
    const diff = diffChunks(fresh, existingBySource.get(sourceId) ?? [])
    toEmbed.push(...diff.toUpsert)
    stats.unchanged += diff.unchanged
    for (const orphan of diff.toDelete) {
      deletions.push({ sourceId, section: orphan.section, chunkIndex: orphan.chunkIndex })
    }
  }

  // A source removed entirely must stop being retrievable, not just its
  // orphaned chunks. Without this, deleting a playbook leaves its guidance in
  // the index indefinitely.
  for (const sourceId of existingBySource.keys()) {
    if (!freshBySource.has(sourceId)) {
      for (const stale of existingBySource.get(sourceId) ?? []) {
        deletions.push({ sourceId, section: stale.section, chunkIndex: stale.chunkIndex })
      }
    }
  }

  if (toEmbed.length > 0) {
    const embedded = await embedTexts(toEmbed.map((c) => c.content))
    if (!embedded.ok) {
      errors.push(`${sourceKind}: ${embedded.error}`)
      return stats
    }
    const literals = toVectorLiterals(embedded.embeddings)
    const rows = toEmbed.map((c, i) => ({
      source_kind: c.sourceKind,
      source_id: c.sourceId,
      source_url: c.sourceUrl,
      title: c.title,
      heading_path: c.headingPath,
      section: c.section,
      chunk_index: c.chunkIndex,
      content: c.content,
      visibility: c.visibility,
      checksum: c.checksum,
      embedding: literals[i],
      indexed_at: new Date().toISOString(),
    }))

    const { error } = await db
      .from("knowledge_chunks")
      .upsert(rows, { onConflict: "source_kind,source_id,section,chunk_index" })
    if (error) {
      errors.push(`${sourceKind} upsert: ${error.message}`)
      return stats
    }
    stats.upserted = rows.length
  }

  for (const d of deletions) {
    const { error } = await db
      .from("knowledge_chunks")
      .delete()
      .eq("source_kind", sourceKind)
      .eq("source_id", d.sourceId)
      .eq("section", d.section)
      .eq("chunk_index", d.chunkIndex)
    if (error) errors.push(`${sourceKind} delete: ${error.message}`)
    else stats.deleted++
  }

  return stats
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Full re-ingest of the structured sources. Incremental by checksum: a nightly
 * run with no content changes embeds nothing and costs one query per kind.
 * Never throws — returns a summary with per-source errors so a partial failure
 * (say, macros) does not lose the playbook work that already succeeded.
 */
export async function reindexKnowledge(): Promise<IngestSummary> {
  const summary: IngestSummary = { ok: true, bySource: {}, totalEmbedded: 0, errors: [] }

  const db = getSupabaseAdminClient()
  if (!db) {
    return { ...summary, ok: false, errors: ["Supabase admin client unavailable"] }
  }

  const loaders: Array<[KnowledgeChunk["sourceKind"], (db: Db) => Promise<Map<string, KnowledgeChunk[]>>]> = [
    ["playbook", loadPlaybookChunks],
    ["response", loadResponseChunks],
    ["macro", loadMacroChunks],
  ]

  for (const [kind, loader] of loaders) {
    try {
      const fresh = await loader(db)
      const stats = await ingestKind(db, kind, fresh, summary.errors)
      summary.bySource[kind] = stats
      summary.totalEmbedded += stats.upserted
    } catch (e) {
      const message = (e as Error).message
      console.error(`[retrieval/ingest] ${kind} failed:`, message)
      summary.errors.push(`${kind}: ${message}`)
      summary.bySource[kind] = emptyStats()
    }
  }

  summary.ok = summary.errors.length === 0
  return summary
}
