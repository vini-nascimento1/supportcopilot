"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { GmailResult } from "@/lib/gmail-client"
import { GmailCard } from "@/components/cards/gmail-card"

const POLL_INTERVAL_MS = 30_000 // 30 seconds

export function GmailCardLive({ initial }: { initial: GmailResult }) {
  const [gmail, setGmail] = useState<GmailResult>(initial)
  const [lastUpdatedIso, setLastUpdatedIso] = useState<string>(() => new Date().toISOString())
  const mountedRef = useRef(true)

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/gmail/unread")
      if (!res.ok) return
      const data: GmailResult = await res.json()
      if (mountedRef.current) {
        setGmail(data)
        setLastUpdatedIso(new Date().toISOString())
      }
    } catch {
      // Stale data stays visible until next successful poll.
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const id = setInterval(fetchUnread, POLL_INTERVAL_MS)

    // Manual refresh via custom event from the refresh button in the card header.
    function handleRefresh() { fetchUnread() }
    window.addEventListener("refresh-gmail", handleRefresh)

    return () => {
      mountedRef.current = false
      clearInterval(id)
      window.removeEventListener("refresh-gmail", handleRefresh)
    }
  }, [fetchUnread])

  return <GmailCard gmail={gmail} lastUpdatedIso={lastUpdatedIso} />
}
