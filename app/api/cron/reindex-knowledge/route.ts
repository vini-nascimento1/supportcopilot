import { NextResponse } from "next/server"

import { reindexKnowledge } from "@/lib/retrieval/ingest"

// Rebuilds the retrieval corpus (knowledge_chunks) from playbooks, responses
// and Intercom macros. Invoked on a schedule by Supabase pg_cron via pg_net
// (net.http_post) with a shared CRON_SECRET header — NOT a user session, same
// as app/api/cron/triage-sweep/route.ts and app/api/automation/sweep/route.ts.
//
// Incremental: unchanged chunks are skipped by checksum, so a nightly run with
// no content edits embeds nothing. Safe to run more often than needed.
export const dynamic = "force-dynamic"
// Embedding the whole corpus from cold is a few hundred chunks through a
// throttled provider; the incremental path is far quicker.
export const maxDuration = 300

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET
  const provided = req.headers.get("x-cron-secret")
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const summary = await reindexKnowledge()
  // 207 on partial failure so a monitor can distinguish "some sources failed"
  // from a clean run, matching the triage sweep's convention.
  return NextResponse.json(summary, { status: summary.ok ? 200 : 207 })
}
