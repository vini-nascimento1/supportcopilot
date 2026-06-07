import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

/**
 * Slack integration.
 *
 * Token resolution order (Phase 1 → Phase 2):
 *   1. `agentSlackToken` passed in (from `agents.slack_token` in Supabase, Phase 2)
 *   2. `SLACK_BOT_TOKEN` env var (dev fallback / shared workspace bot)
 *
 * In Phase 2, each agent connects their Slack via an OAuth flow in /settings.
 * The token is stored encrypted in `agents.slack_token`.
 * Required scopes: channels:history, channels:read
 */

export type SlackResult =
  | { connected: true; messageCount: number; channels: string[]; slackLink: string }
  | { connected: false }

async function getSupportChannelIds(): Promise<string[]> {
  const envChannels = process.env.SLACK_SUPPORT_CHANNEL_IDS
  if (envChannels) return envChannels.split(",").map((c) => c.trim())

  const supabase = getSupabaseAdminClient()
  if (!supabase) return []

  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "slack_channels")
    .maybeSingle()

  if (!data?.value) return []
  const raw = data.value
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { ids?: unknown[] }).ids)
      ? (raw as { ids: unknown[] }).ids
      : []
  return arr
    .map((item) => {
      if (typeof item === "string") return item
      if (item && typeof item === "object" && "id" in item)
        return String((item as { id: unknown }).id)
      return null
    })
    .filter((id): id is string => id !== null)
}


async function countRecentMessages(
  token: string,
  channelIds: string[]
): Promise<number> {
  if (channelIds.length === 0) return 0

  const oldest = ((Date.now() - 24 * 60 * 60 * 1000) / 1000).toString()
  let total = 0

  await Promise.all(
    channelIds.map(async (channel) => {
      try {
        const url = new URL("https://slack.com/api/conversations.history")
        url.searchParams.set("channel", channel)
        url.searchParams.set("oldest", oldest)
        url.searchParams.set("limit", "200")
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          next: { revalidate: 0 },
        })
        if (!res.ok) return
        const data = (await res.json()) as {
          ok: boolean
          messages?: Array<{ subtype?: string }>
        }
        if (!data.ok) return
        total += (data.messages ?? []).filter((m) => !m.subtype).length
      } catch {
        // ignore per-channel errors
      }
    })
  )

  return total
}

export async function getSlackActivity(
  agentSlackToken?: string | null
): Promise<SlackResult> {
  const token = agentSlackToken ?? process.env.SLACK_BOT_TOKEN
  if (!token) return { connected: false }

  try {
    const authRes = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    })
    if (!authRes.ok) return { connected: false }
    const auth = (await authRes.json()) as { ok: boolean; url?: string }
    if (!auth.ok) return { connected: false }

    const channelIds = await getSupportChannelIds()
    const messageCount = await countRecentMessages(token, channelIds)

    return {
      connected: true,
      messageCount,
      channels: channelIds,
      slackLink: auth.url ?? "https://slack.com",
    }
  } catch {
    return { connected: false }
  }
}

// ── types for mini Slack feed ──────────────────────────────────

export type SlackMessage = {
  id: string
  userId: string
  userName: string
  userColor: string
  text: string
  ts: string
  threadCount?: number
  threadTs?: string
  parentTs?: string // if this is a thread reply, points to parent
}

export type SlackThreadReply = {
  id: string
  userId: string
  userName: string
  userColor: string
  text: string
  ts: string
  parentTs: string
}

export type SlackChannel = {
  id: string
  name: string
}

export type SlackFeedResult =
  | { connected: true; channels: SlackChannel[]; messages: Record<string, SlackMessage[]>; workspaceUrl: string }
  | { connected: false }

// ── helpers ────────────────────────────────────────────────────

function slackUserColor(userId: string): string {
  const palette = ["#e879f9", "#38bdf8", "#34d399", "#fb923c", "#f87171", "#a78bfa", "#fbbf24", "#4ade80"]
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff
  return palette[hash % palette.length]
}

async function resolveSlackUsers(
  token: string,
  userIds: string[]
): Promise<Record<string, { name: string; color: string }>> {
  const unique = [...new Set(userIds)].slice(0, 30) // cap to avoid rate limits
  const result: Record<string, { name: string; color: string }> = {}
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const res = await fetch(`https://slack.com/api/users.info?user=${uid}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json()) as {
          ok: boolean
          user?: { profile?: { display_name?: string; real_name?: string } }
        }
        if (data.ok && data.user?.profile) {
          const name =
            data.user.profile.display_name?.trim() ||
            data.user.profile.real_name?.trim() ||
            uid
          result[uid] = { name, color: slackUserColor(uid) }
        }
      } catch {
        /* ignore */
      }
    })
  )
  return result
}

async function resolveSlackChannelName(token: string, channelId: string): Promise<string> {
  try {
    const res = await fetch(`https://slack.com/api/conversations.info?channel=${encodeURIComponent(channelId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await res.json()) as { ok: boolean; channel?: { name?: string } }
    return data.ok && data.channel?.name ? `#${data.channel.name}` : String(channelId)
  } catch {
    return String(channelId)
  }
}

async function fetchChannelMessages(
  token: string,
  channelId: string,
  limit = 30
): Promise<Array<{ user?: string; text?: string; ts: string; subtype?: string; reply_count?: number; thread_ts?: string }>> {
  try {
    const url = new URL("https://slack.com/api/conversations.history")
    url.searchParams.set("channel", channelId)
    url.searchParams.set("limit", String(limit))
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await res.json()) as {
      ok: boolean
      messages?: Array<{ user?: string; text?: string; ts: string; subtype?: string; reply_count?: number; thread_ts?: string }>
    }
    if (!data.ok) return []
    return (data.messages ?? []).filter((m) => !m.subtype && m.user)
  } catch {
    return []
  }
}

export async function getSlackFeed(agentSlackToken?: string | null): Promise<SlackFeedResult> {
  const token = agentSlackToken ?? process.env.SLACK_BOT_TOKEN
  if (!token) return { connected: false }

  try {
    const authRes = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const auth = (await authRes.json()) as { ok: boolean; url?: string }
    if (!auth.ok) return { connected: false }

    const channelIds = await getSupportChannelIds()
    if (channelIds.length === 0) {
      return { connected: true, channels: [], messages: {}, workspaceUrl: auth.url ?? "https://slack.com" }
    }

    // Fetch channel names and messages in parallel
    const [channelNames, ...channelMsgArrays] = await Promise.all([
      Promise.all(channelIds.map((id) => resolveSlackChannelName(token, id))),
      ...channelIds.map((id) => fetchChannelMessages(token, id, 30)),
    ])

    // Resolve user names for all messages
    const allUserIds = (channelMsgArrays as Array<Array<{ user?: string; text?: string; ts: string; subtype?: string; reply_count?: number; thread_ts?: string }>>)
      .flat()
      .map((m) => m.user)
      .filter(Boolean) as string[]
    const users = await resolveSlackUsers(token, allUserIds)

    const channels: SlackChannel[] = channelIds.map((id, i) => ({
      id,
      name: (channelNames as string[])[i],
    }))

    const messages: Record<string, SlackMessage[]> = {}
    channelIds.forEach((id, i) => {
      const raw = (channelMsgArrays as Array<Array<{ user?: string; text?: string; ts: string; subtype?: string; reply_count?: number; thread_ts?: string }>>)[i]
      messages[id] = [...raw].reverse().map((m) => ({
        id: m.ts,
        userId: m.user ?? "unknown",
        userName: users[m.user ?? ""]?.name ?? m.user ?? "Unknown",
        userColor: users[m.user ?? ""]?.color ?? slackUserColor(m.user ?? ""),
        text: m.text ?? "",
        ts: m.ts,
        threadCount: m.reply_count,
        threadTs: m.thread_ts,
      }))
    })

    return { connected: true, channels, messages, workspaceUrl: auth.url ?? "https://slack.com" }
  } catch {
    return { connected: false }
  }
}

// ── thread replies ─────────────────────────────────────────────

export type ThreadRepliesResult =
  | { ok: true; replies: SlackThreadReply[] }
  | { ok: false }

export async function getThreadReplies(
  agentSlackToken: string | null | undefined,
  channelId: string,
  threadTs: string
): Promise<ThreadRepliesResult> {
  const token = agentSlackToken ?? process.env.SLACK_BOT_TOKEN
  if (!token) return { ok: false }

  try {
    const url = new URL("https://slack.com/api/conversations.replies")
    url.searchParams.set("channel", channelId)
    url.searchParams.set("ts", threadTs)
    url.searchParams.set("limit", "50")
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await res.json()) as {
      ok: boolean
      messages?: Array<{ user?: string; text?: string; ts: string; parent_user_id?: string; subtype?: string }>
    }
    if (!data.ok) return { ok: false }

    const replies = (data.messages ?? [])
      .filter((m) => !m.subtype && m.user && m.ts !== threadTs) // exclude parent
      .map((m) => ({
        id: m.ts,
        userId: m.user ?? "unknown",
        userName: m.user ?? "Unknown",
        userColor: slackUserColor(m.user ?? ""),
        text: m.text ?? "",
        ts: m.ts,
        parentTs: threadTs,
      }))

    // Resolve user names
    const userIds = replies.map((r) => r.userId).filter(Boolean)
    const users = await resolveSlackUsers(token, userIds)
    for (const reply of replies) {
      const u = users[reply.userId]
      if (u) {
        reply.userName = u.name
        reply.userColor = u.color
      }
    }

    return { ok: true, replies }
  } catch {
    return { ok: false }
  }
}

/** Build a permalink to a specific Slack message. */
export function getMessagePermalink(
  workspaceUrl: string,
  channelId: string,
  ts: string
): string {
  const tsClean = ts.replace(".", "")
  return `${workspaceUrl}/archives/${channelId}/p${tsClean}`
}
