"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { CasesQueueData } from "@/lib/intercom"
import { IntercomCard } from "@/components/cards/intercom-card"

const POLL_INTERVAL_MS = 30_000 // 30 seconds

export function IntercomCardLive({
  initial,
  appId,
}: {
  initial: CasesQueueData
  appId: string
}) {
  const [cases, setCases] = useState<CasesQueueData>(initial)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchCases = useCallback(async () => {
    try {
      const res = await fetch("/api/cases")
      if (!res.ok) {
        if (res.status === 401) {
          setError("Session expired — refresh to reconnect.")
          return
        }
        setError(`API returned ${res.status}`)
        return
      }
      const data: CasesQueueData = await res.json()
      if (mountedRef.current) {
        setCases(data)
        setError(null)
      }
    } catch {
      // Network error — stale data stays visible until connection returns.
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const id = setInterval(fetchCases, POLL_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [fetchCases])

  // Merge the error state into the data for the static card to render.
  const displayData: CasesQueueData = error
    ? { ...cases, mode: "error", error }
    : cases

  return <IntercomCard cases={displayData} appId={appId} />
}
