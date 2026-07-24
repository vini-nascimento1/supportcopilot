import "server-only"

// Server-only live client for the hosted Notion MCP (mcp.notion.com). Sends
// JSON-RPC over plain fetch (no SDK), calling `notion-search` (AI-search across
// connectors) with the agent's bearer access token, feeding the raw result
// through the PURE mapAiSearchResults mapper (lib/notion-retrieval).
//
// NEVER throws into the draft path: every failure returns
// { backend:"none", error } so /api/draft can fall back to the base prompt.

import {
  mapAiSearchResults,
  extractSearchPayload,
  type RetrievalResult,
} from "@/lib/notion-retrieval"
import { NOTION_MCP_URL } from "@/lib/notion-mcp-oauth"

export const NOTION_SEARCH_TOOL = "notion-search"

// Connects to the hosted MCP with the bearer token, calls notion-search, and
// returns mapped snippets. Never throws.
export async function searchNotionViaMcp(
  accessToken: string,
  query: string,
  limit: number
): Promise<RetrievalResult> {
  if (!accessToken || !query.trim()) {
    return { snippets: [], backend: "none", error: "missing_token_or_query" }
  }

  try {
    const response = await fetch(NOTION_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "tools/call",
        params: {
          name: NOTION_SEARCH_TOOL,
          arguments: {
            query,
            query_type: "internal",
            content_search_mode: "ai_search",
            page_size: limit,
          },
        },
      }),
    })

    if (!response.ok) {
      return { snippets: [], backend: "none", error: `http_${response.status}` }
    }

    const json: unknown = await response.json()
    const rpcResult: unknown =
      typeof json === "object" &&
      json !== null &&
      "result" in (json as Record<string, unknown>)
        ? (json as Record<string, unknown>).result
        : json

    const payload = extractSearchPayload(rpcResult)
    if (!payload) {
      return { snippets: [], backend: "none", error: "no_results_payload" }
    }

    const snippets = mapAiSearchResults(payload, limit)
    return { snippets, backend: "ai_search", error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : "mcp_error"
    return { snippets: [], backend: "none", error }
  }
}
