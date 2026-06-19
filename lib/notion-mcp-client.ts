import "server-only"

// Server-only live client for the hosted Notion MCP (mcp.notion.com). Connects
// over streamable HTTP with the agent's bearer access token and calls the
// `notion-search` tool (AI-search across connectors), feeding the raw result
// through the PURE mapAiSearchResults mapper (lib/notion-retrieval).
//
// NEVER throws into the draft path: every failure returns
// { backend:"none", error } so /api/draft can fall back to the base prompt.
//
// We use the official @modelcontextprotocol/sdk StreamableHTTP client transport
// and pass the access token as a static Authorization header via `requestInit`
// (we already manage the OAuth lifecycle in lib/notion-mcp-auth-server, so no
// SDK authProvider is needed). The tool response may arrive either as
// structuredContent or as a JSON string in a text content block — extractSearchPayload
// (pure, unit-tested) normalises both before mapping.

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

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

  const transport = new StreamableHTTPClientTransport(new URL(NOTION_MCP_URL), {
    requestInit: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  })

  const client = new Client(
    { name: "fanvue-support-copilot", version: "1.0.0" },
    { capabilities: {} }
  )

  try {
    await client.connect(transport)

    const result = await client.callTool({
      name: NOTION_SEARCH_TOOL,
      arguments: {
        query,
        query_type: "internal",
        content_search_mode: "ai_search",
        page_size: limit,
      },
    })

    const payload = extractSearchPayload(result)
    if (!payload) {
      return { snippets: [], backend: "none", error: "no_results_payload" }
    }

    const snippets = mapAiSearchResults(payload, limit)
    return { snippets, backend: "ai_search", error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : "mcp_error"
    return { snippets: [], backend: "none", error }
  } finally {
    // Best-effort cleanup; ignore close errors.
    try {
      await client.close()
    } catch {
      // ignore
    }
  }
}
