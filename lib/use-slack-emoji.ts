"use client"

import { useEffect, useState } from "react"
import type { EmojiMap } from "@/lib/slack-utils"

type SlackEmojiResponse = {
  ok: boolean
  emoji?: Record<string, string>
  cacheTs?: string
  error?: string
}

/**
 * Resolve Slack emoji aliases recursively.
 * Slack's emoji.list returns entries like `"robot_face": "alias:robot"`.
 */
function resolveAliases(raw: Record<string, string>): EmojiMap {
  const resolved: EmojiMap = {}

  function resolve(name: string, depth = 0): string | undefined {
    if (depth > 10) return undefined // prevent infinite alias chains
    const val = raw[name]
    if (!val) return undefined
    if (typeof val === "string" && val.startsWith("alias:")) {
      const alias = val.slice(6)
      // Check if the alias target is another alias
      if (raw[alias] && raw[alias]!.startsWith("alias:")) {
        return resolve(alias, depth + 1)
      }
      return raw[alias]
    }
    return val
  }

  for (const name of Object.keys(raw)) {
    const val = resolve(name)
    if (val) resolved[name] = val
  }

  return resolved
}

/**
 * Fetch the full Slack emoji list (including custom workspace emoji) and
 * merge it with the built-in fallback map.
 *
 * Returns:
 *   loading  — true while the initial fetch is in progress
 *   error    — error message if fetch failed
 *   emojiMap — merged map (fallback + Slack dynamic). Stable reference;
 *              only changes when re-fetched data differs.
 */
export function useSlackEmojis() {
  const [emojiMap, setEmojiMap] = useState<EmojiMap | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchEmoji() {
      try {
        const res = await fetch("/api/slack/emoji")
        const data = (await res.json()) as SlackEmojiResponse

        if (cancelled) return

        if (data.ok && data.emoji) {
          const resolved = resolveAliases(data.emoji)
          setEmojiMap(resolved)
          setError(null)
        } else {
          // Non-critical — fallback map will still work
          console.warn("Failed to fetch Slack emoji:", data.error)
          setError(data.error ?? "Unknown error")
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("Failed to fetch Slack emoji list (fallback map still works):", err)
          setError(err instanceof Error ? err.message : "Network error")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchEmoji()

    return () => {
      cancelled = true
    }
  }, [])

  return { emojiMap, loading, error }
}
