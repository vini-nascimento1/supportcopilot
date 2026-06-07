import "server-only"

/**
 * Notion KB integration.
 *
 * Token resolution order (Phase 1 → Phase 2):
 *   1. `agentNotionToken` passed in (from `agents.notion_token` in Supabase, Phase 2)
 *   2. `NOTION_API_KEY` env var (dev fallback / shared internal integration)
 *
 * In Phase 2, each agent connects their Notion via an OAuth flow in /settings.
 * Required scope: read_content (internal integration or public OAuth app).
 */

export type NotionResult =
  | { connected: true; pageCount: number; lastSynced: string | null; notionLink: string }
  | { connected: false }

export async function getNotionKBStatus(
  agentNotionToken?: string | null
): Promise<NotionResult> {
  const token = agentNotionToken ?? process.env.NOTION_API_KEY
  if (!token) return { connected: false }

  try {
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        filter: { value: "page", property: "object" },
        page_size: 100,
        sort: { direction: "descending", timestamp: "last_edited_time" },
      }),
      next: { revalidate: 0 },
    })
    if (!res.ok) return { connected: false }

    const data = (await res.json()) as {
      results?: Array<{ last_edited_time?: string }>
    }

    const pages = data.results ?? []
    return {
      connected: true,
      pageCount: pages.length,
      lastSynced: pages[0]?.last_edited_time ?? null,
      notionLink: "https://notion.so",
    }
  } catch {
    return { connected: false }
  }
}
