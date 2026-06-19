import "server-only"

import { getFreshNotionMcpToken } from "@/lib/notion-mcp-auth-server"
import { searchNotionViaMcp } from "@/lib/notion-mcp-client"
import type { NotionSnippet } from "@/lib/notion-retrieval"

// How many Notion snippets to retrieve per call.
export const NOTION_RETRIEVAL_LIMIT = 5

// Ground a response in live Notion retrieval via the agent's own hosted-MCP
// connection. Best-effort: any failure (not connected, needs re-consent,
// network/MCP error) returns [] so callers fall back gracefully — never throws.
// Shared by /api/draft (tail drafts) and /api/ai/case-chat (the copilot).
export async function retrieveNotionSnippets(
  email: string,
  origin: string,
  query: string,
  limit: number = NOTION_RETRIEVAL_LIMIT
): Promise<NotionSnippet[]> {
  if (!query.trim()) return []
  try {
    const tokenResult = await getFreshNotionMcpToken(email, origin)
    if (!tokenResult.accessToken) return []
    const result = await searchNotionViaMcp(tokenResult.accessToken, query, limit)
    return result.backend === "ai_search" ? result.snippets : []
  } catch {
    return []
  }
}
