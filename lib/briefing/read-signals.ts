import "server-only"

import { getChannelLastRead } from "@/lib/slack"
import { getThreadsUnreadState } from "@/lib/gmail-client"
import type { AttentionItem } from "@/lib/briefing/types"

// "The agent already read this somewhere else."
//
// Home is not the only place these items live: a mention also sits in Slack and
// an email also sits in Gmail. If the agent read it there, keeping it on Home
// makes the page lie about what is outstanding. So on every briefing read we
// ask the two sources for their own read state and auto-dismiss (reason "read")
// whatever they say is seen — see lib/briefing/dismissals.ts.
//
// Three rules this module holds to:
//   • Only items carrying a `readSignal` are eligible. A signal is minted by
//     the source and only when it is actually reliable — a mention inside a
//     thread has none, because a channel's last_read says nothing about its
//     threads, and marking one read would silently drop a real question.
//   • Unknown is never "read". A failed lookup, a missing cursor, a thread we
//     could not fetch — all leave the item on the page.
//   • It never throws and never blocks the page. Both lookups run in parallel
//     against a short deadline; whatever has not answered by then simply does
//     not contribute this time round.
//
// Nothing here persists or logs a payload: channel ids, thread ids and counts.

/** How long the whole read-signal check may take before the briefing goes on without it. */
export const READ_CHECK_TIMEOUT_MS = 2500

/** Most channels one check will ask Slack about. */
export const MAX_SLACK_CHANNEL_CHECKS = 15

/** Most threads one check will ask Gmail about. */
export const MAX_GMAIL_THREAD_CHECKS = 10

export type ReadCheckPlan = {
  slackChannels: string[]
  gmailThreads: string[]
}

export type ReadState = {
  /** channel id → `conversations.info().last_read` ts. Missing = unknown. */
  lastReadByChannel: Record<string, string>
  /** thread id → still unread? Missing = unknown. */
  unreadByThread: Record<string, boolean>
}

/**
 * What to ask each source, derived from the items alone. Pure.
 *
 * Deduplicated (one mention per channel is enough to learn the cursor for all
 * of them) and capped, so a heavy briefing cannot turn a page load into dozens
 * of API calls.
 */
export function planReadChecks(items: AttentionItem[]): ReadCheckPlan {
  const channels = new Set<string>()
  const threads = new Set<string>()

  for (const item of items) {
    const signal = item.readSignal
    if (!signal) continue
    if (signal.kind === "slack_channel") {
      if (signal.channelId) channels.add(signal.channelId)
    } else if (signal.kind === "gmail_thread") {
      if (signal.threadId) threads.add(signal.threadId)
    }
  }

  return {
    slackChannels: [...channels].slice(0, MAX_SLACK_CHANNEL_CHECKS),
    gmailThreads: [...threads].slice(0, MAX_GMAIL_THREAD_CHECKS),
  }
}

/**
 * Which items the read state says are already seen. Pure, so the rule is
 * testable without touching Slack or Gmail.
 *
 * Slack: the channel cursor is a "1712345678.000100" string ordered as a
 * decimal number, so the comparison is numeric, not lexical. An unparseable ts
 * on either side means we cannot tell, which means not read.
 *
 * Gmail: only an explicit `false` (the thread carries no UNREAD label on any
 * message) counts. `undefined` is a thread we never got an answer for.
 */
export function resolveReadItems(items: AttentionItem[], state: ReadState): string[] {
  const out: string[] = []

  for (const item of items) {
    const signal = item.readSignal
    if (!signal) continue

    if (signal.kind === "slack_channel") {
      const lastRead = state.lastReadByChannel[signal.channelId]
      if (!lastRead) continue
      const cursor = Number(lastRead)
      const ts = Number(signal.ts)
      if (!Number.isFinite(cursor) || !Number.isFinite(ts)) continue
      if (cursor >= ts) out.push(item.id)
      continue
    }

    if (signal.kind === "gmail_thread") {
      if (state.unreadByThread[signal.threadId] === false) out.push(item.id)
    }
  }

  return out
}

export type DetectReadOptions = {
  slackToken: string | null
  googleToken: string | null
  email: string | null
  /** Overridable for tests. */
  timeoutMs?: number
}

/**
 * Ask both sources what the agent has already read, and return the item ids
 * that are settled. Never throws, never rejects, never waits longer than
 * `timeoutMs` — on a timeout it answers with whatever came back in time, which
 * may be nothing, and the items simply stay on the page until the next load.
 */
export async function detectReadItems(
  items: AttentionItem[],
  opts: DetectReadOptions
): Promise<Set<string>> {
  try {
    const plan = planReadChecks(items)
    const slackToken = opts.slackToken
    const googleToken = opts.googleToken
    const wantSlack = plan.slackChannels.length > 0 && Boolean(slackToken)
    const wantGmail = plan.gmailThreads.length > 0 && Boolean(googleToken)
    if (!wantSlack && !wantGmail) return new Set()

    // Filled in as the lookups land, read after the race — so a partial answer
    // is still worth something when the deadline wins.
    const state: ReadState = { lastReadByChannel: {}, unreadByThread: {} }

    const lookups = Promise.all([
      wantSlack
        ? getChannelLastRead(slackToken as string, plan.slackChannels)
            .then((byChannel) => {
              Object.assign(state.lastReadByChannel, byChannel)
            })
            .catch(() => {})
        : Promise.resolve(),
      wantGmail
        ? getThreadsUnreadState(googleToken as string, opts.email, plan.gmailThreads)
            .then((byThread) => {
              Object.assign(state.unreadByThread, byThread)
            })
            .catch(() => {})
        : Promise.resolve(),
    ]).then(() => {})

    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, opts.timeoutMs ?? READ_CHECK_TIMEOUT_MS)
    })
    try {
      await Promise.race([lookups, deadline])
    } finally {
      if (timer) clearTimeout(timer)
    }

    return new Set(resolveReadItems(items, state))
  } catch {
    return new Set()
  }
}
