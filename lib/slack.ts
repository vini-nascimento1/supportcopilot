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
  | { connected: false; error?: string }

export type SlackUnreadResult =
  | { connected: true; unreadCount: number; workspaceUrl: string }
  | { connected: false; unreadCount: 0; workspaceUrl: ""; error?: string }

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

  let total = 0

  await Promise.all(
    channelIds.map(async (channel) => {
      try {
        const url = new URL("https://slack.com/api/conversations.history")
        url.searchParams.set("channel", channel)
        url.searchParams.set("unreads", "true")
        url.searchParams.set("limit", "1")
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          next: { revalidate: 0 },
        })
        if (!res.ok) return
        const data = (await res.json()) as {
          ok: boolean
          unread_count_display?: number
        }
        if (!data.ok) return
        total += data.unread_count_display ?? 0
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
  parentTs?: string
  reactions?: SlackReaction[]
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

/** Resolve bot IDs to display names using bots.info API. */
async function resolveSlackBots(
  token: string,
  botIds: string[]
): Promise<Record<string, string>> {
  const unique = [...new Set(botIds)].slice(0, 20)
  const result: Record<string, string> = {}
  await Promise.all(
    unique.map(async (bid) => {
      try {
        const res = await fetch(`https://slack.com/api/bots.info?bot=${bid}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json()) as {
          ok: boolean
          bot?: { id?: string; name?: string; app_id?: string }
        }
        if (data.ok && data.bot?.name) {
          result[bid] = data.bot.name
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
    return data.ok && data.channel?.name ? data.channel.name : String(channelId)
  } catch {
    return String(channelId)
  }
}

async function fetchChannelMessages(
  token: string,
  channelId: string,
  limit = 30
): Promise<Array<{
  user?: string; bot_id?: string; text?: string; ts: string; subtype?: string
  reply_count?: number; thread_ts?: string
  bot_profile?: { id?: string; name?: string; app_id?: string }
  reactions?: Array<{ name: string; users: string[]; count: number }>
}>> {
  try {
    const url = new URL("https://slack.com/api/conversations.history")
    url.searchParams.set("channel", channelId)
    url.searchParams.set("limit", String(limit))
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await res.json()) as {
      ok: boolean
      messages?: Array<{
        user?: string; bot_id?: string; text?: string; ts: string; subtype?: string
        reply_count?: number; thread_ts?: string
        bot_profile?: { id?: string; name?: string; app_id?: string }
        reactions?: Array<{ name: string; users: string[]; count: number }>
      }>
    }
    if (!data.ok) {
      console.warn(`[slack] conversations.history error for ${channelId}:`, (data as Record<string, unknown>).error ?? "unknown")
      return []
    }
    // Allow bot_message subtype (workflows, automation) and messages without user field (bots)
    return (data.messages ?? []).filter((m) => {
      if (!m.subtype) return true
      if (m.subtype === "bot_message") return true
      return false
    })
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

// ── conversation listing (Phase 2 — all user channels) ─────────

export type SlackReaction = {
  name: string
  count: number
  users: string[]
}

export type SlackConversation = {
  id: string
  name: string
  type: "channel" | "im" | "mpim"
  unreadCount: number
  /** For DMs: the other user's display name */
  dmUser?: string
  /** For DMs: the other user's color */
  dmColor?: string
  /** Unix timestamp of the latest message (seconds), used for sorting */
  latestTs?: number
}

export type ConversationsResult =
  | { ok: true; conversations: SlackConversation[]; workspaceUrl: string }
  | { ok: false }

// ── dynamic conversation discovery ────────────────────────────────

/** Discover all conversations the user token has access to via `users.conversations`. */
async function fetchAllUserConversations(
  token: string,
  types = "public_channel,private_channel,im,mpim",
): Promise<SlackConversation[]> {
  const all: SlackConversation[] = []
  const dmUserMap = new Map<string, string>() // conversationId → userId
  let cursor: string | undefined

  try {
    do {
      const url = new URL("https://slack.com/api/users.conversations")
      url.searchParams.set("types", types)
      url.searchParams.set("limit", "200")
      url.searchParams.set("exclude_archived", "true")
      if (cursor) url.searchParams.set("cursor", cursor)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        channels?: Array<{
          id: string; name?: string
          is_channel?: boolean; is_im?: boolean; is_mpim?: boolean
          user?: string
        }>
        response_metadata?: { next_cursor?: string }
      }
      if (!data.ok) {
        console.error(`[slack] users.conversations failed:`, JSON.stringify(data))
        // If private_channel scope (groups:read) is missing, retry without it
        if (data.error === "missing_scope" && types.includes("private_channel")) {
          return fetchAllUserConversations(token, "public_channel,im,mpim")
        }
        return []
      }

      for (const ch of data.channels ?? []) {
        if (ch.is_im) {
          if (ch.user) dmUserMap.set(ch.id, ch.user)
          all.push({ id: ch.id, name: "Loading...", type: "im", unreadCount: 0 })
        } else if (ch.is_mpim) {
          all.push({ id: ch.id, name: ch.name ?? ch.id, type: "mpim", unreadCount: 0 })
        } else {
          all.push({ id: ch.id, name: ch.name ?? ch.id, type: "channel", unreadCount: 0 })
        }
      }

      cursor = data.response_metadata?.next_cursor
    } while (cursor)

    // Resolve DM user names in batch
    if (dmUserMap.size > 0) {
      const userIds = [...dmUserMap.values()]
      const users = await resolveSlackUsers(token, userIds)
      for (const conv of all) {
        if (conv.type === "im") {
          const uid = dmUserMap.get(conv.id)
          const user = uid ? users[uid] : undefined
          if (user) {
            conv.name = user.name
            conv.dmUser = user.name
            conv.dmColor = user.color
          } else {
            conv.name = uid ?? "Unknown"
            conv.dmUser = uid ?? "Unknown"
          }
        }
      }
    }

    return all
  } catch {
    return []
  }
}

/** List all available conversations — uses `users.conversations` for dynamic discovery, falls back to configured support channels. */
export async function getUserConversations(
  agentSlackToken?: string | null
): Promise<ConversationsResult> {
  const token = agentSlackToken ?? process.env.SLACK_BOT_TOKEN
  if (!token) return { ok: false }

  try {
    const authRes = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    })
    const auth = (await authRes.json()) as { ok: boolean; url?: string }
    if (!auth.ok) return { ok: false }
    const workspaceUrl = auth.url ?? "https://slack.com"

    // Dynamic discovery — show all conversations the user is actually in
    const all = await fetchAllUserConversations(token)
    if (all.length > 0) {
      console.log(`[slack] users.conversations returned ${all.length} conversations (${all.filter(c => c.type === 'channel').length} channels, ${all.filter(c => c.type === 'im').length} DMs)`)

      // Fetch latest message timestamps for sorting — batch in chunks
      const sorted = await attachLatestTimestamps(token, all)
      return { ok: true, conversations: sorted, workspaceUrl }
    }

    // Fallback: use configured support channels
    console.warn(`[slack] users.conversations returned empty — falling back to static channel config`)
    const channelIds = await getSupportChannelIds()
    const channels: SlackConversation[] = await Promise.all(
      channelIds.map(async (id) => {
        const name = await resolveSlackChannelName(token, id)
        return { id, name, type: "channel" as const, unreadCount: 0 }
      })
    )

    return { ok: true, conversations: channels, workspaceUrl }
  } catch {
    return { ok: false }
  }
}

/** Fetch latest message timestamps + unread counts for each conversation and sort by most recent. */
async function attachLatestTimestamps(
  token: string,
  conversations: SlackConversation[],
): Promise<SlackConversation[]> {
  const BATCH = 10
  for (let i = 0; i < conversations.length; i += BATCH) {
    const batch = conversations.slice(i, i + BATCH)
    await Promise.allSettled(
      batch.map(async (c) => {
        try {
          const res = await fetch(`https://slack.com/api/conversations.info?channel=${c.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          // conversations.info returns unread_count_display (mentions in channels,
          // every message in DMs) on the Channel object when called with a user token.
          // Without it the UI would show "all read" even when Slack itself has unreads.
          const data = (await res.json()) as {
            ok: boolean
            channel?: { latest?: { ts?: string }; unread_count_display?: number }
          }
          if (data.ok && data.channel?.latest?.ts) {
            c.latestTs = parseFloat(data.channel.latest.ts)
          }
          if (data.ok && typeof data.channel?.unread_count_display === "number") {
            c.unreadCount = data.channel.unread_count_display
          }
        } catch { /* skip */ }
      })
    )
  }

  return conversations.sort((a, b) => (b.latestTs ?? 0) - (a.latestTs ?? 0))
}

/** Fetch messages for a specific channel (public function version of fetchChannelMessages). */
export async function getConversationMessages(
  agentSlackToken: string | null | undefined,
  channelId: string,
  limit = 50
): Promise<{ messages: SlackMessage[]; channelName: string } | null> {
  const token = agentSlackToken ?? process.env.SLACK_BOT_TOKEN
  if (!token) return null

  try {
    const [raw, channelName] = await Promise.all([
      fetchChannelMessages(token, channelId, limit),
      resolveSlackChannelName(token, channelId),
    ])

    // Collect both user IDs and bot IDs
    const userIds = [...new Set(raw.map((m) => m.user).filter(Boolean) as string[])]
    const botIds = [...new Set(raw.map((m) => m.bot_id).filter(Boolean) as string[])]
    const [users, bots] = await Promise.all([
      resolveSlackUsers(token, userIds),
      resolveSlackBots(token, botIds),
    ])

    const messages: SlackMessage[] = [...raw].reverse().map((m) => {
      const id = m.user ?? m.bot_id ?? "unknown"
      if (m.bot_id && !m.user) {
        // Bot message — use bot profile name or resolved name
        const bot = bots[m.bot_id] ?? m.bot_profile?.name ?? `Bot (${m.bot_id})`
        return {
          id: m.ts,
          userId: m.bot_id,
          userName: bot,
          userColor: slackUserColor(m.bot_id),
          text: m.text ?? "",
          ts: m.ts,
          threadCount: m.reply_count,
          threadTs: m.thread_ts,
          reactions: m.reactions?.map((r) => ({ name: r.name, count: r.count, users: r.users })),
        }
      }
      return {
        id: m.ts,
        userId: id,
        userName: users[m.user ?? ""]?.name ?? m.user ?? "Unknown",
        userColor: users[m.user ?? ""]?.color ?? slackUserColor(id),
        text: m.text ?? "",
        ts: m.ts,
        threadCount: m.reply_count,
        threadTs: m.thread_ts,
        reactions: m.reactions?.map((r) => ({ name: r.name, count: r.count, users: r.users })),
      }
    })

    return { messages, channelName }
  } catch {
    return null
  }
}

/** List the user's DM + group-DM channel IDs (always relevant for unread count). */
async function getUserDmChannelIds(token: string): Promise<string[]> {
  try {
    const url = new URL("https://slack.com/api/users.conversations")
    url.searchParams.set("types", "im,mpim")
    url.searchParams.set("limit", "200")
    url.searchParams.set("exclude_archived", "true")
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    })
    if (!res.ok) return []
    const data = (await res.json()) as {
      ok: boolean
      channels?: Array<{ id: string }>
    }
    if (!data.ok) return []
    return (data.channels ?? []).map((c) => c.id)
  } catch {
    return []
  }
}

/** Get recent activity summary for the dashboard card. */
export async function getSlackUnreadSummary(
  agentSlackToken?: string | null
): Promise<SlackUnreadResult> {
  const token = agentSlackToken ?? process.env.SLACK_BOT_TOKEN
  if (!token) return { connected: false, unreadCount: 0, workspaceUrl: "" }

  try {
    const authRes = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    })
    const auth = (await authRes.json()) as { ok: boolean; url?: string }
    if (!auth.ok) return { connected: false, unreadCount: 0, workspaceUrl: "" }

    // Configured channels + the user's own DMs and mpims. Without the DM half
    // the badge silently shows 0 whenever the unread activity is in 1:1 chats
    // — Slack's native sidebar always counts those, and so should we.
    const [configured, dmIds] = await Promise.all([
      getSupportChannelIds(),
      getUserDmChannelIds(token),
    ])
    const allIds = Array.from(new Set([...configured, ...dmIds]))
    const messageCount = await countRecentMessages(token, allIds)

    return { connected: true, unreadCount: messageCount, workspaceUrl: auth.url ?? "https://slack.com" }
  } catch {
    return { connected: false, unreadCount: 0, workspaceUrl: "" }
  }
}

/** Send a message to a Slack channel. */
export async function sendSlackMessage(
  agentSlackToken: string | null | undefined,
  channelId: string,
  text: string,
  threadTs?: string
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const token = agentSlackToken ?? process.env.SLACK_BOT_TOKEN
  if (!token) return { ok: false, error: "No token" }

  try {
    const body: Record<string, string> = { channel: channelId, text }
    if (threadTs) body.thread_ts = threadTs

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { ok: boolean; ts?: string; error?: string }
    return data
  } catch {
    return { ok: false, error: "Network error" }
  }
}

/** Bulk-unread counter helper. */
export function countUnreadConversations(conversations: SlackConversation[]): number {
  return conversations.filter((c) => c.unreadCount > 0).length
}
