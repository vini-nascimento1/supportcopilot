"use client"

import { useEffect, useRef, useState } from "react"
import { RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

const POLL_INTERVAL_MS = 300_000 // 5 minutes

interface Version {
  sha: string
  timestamp: string
}

export function UpdateBanner() {
  const [newVersion, setNewVersion] = useState<Version | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const currentVersion = useRef<Version | null>(null)

  useEffect(() => {
    let cancelled = false

    async function checkVersion(isInitial = false) {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`)
        if (!res.ok) return
        const v: Version = await res.json()

        if (isInitial) {
          // First fetch — store baseline, don't show banner yet.
          currentVersion.current = v
        } else if (currentVersion.current && currentVersion.current.sha !== v.sha && !cancelled) {
          setNewVersion(v)
        }
      } catch {
        // Ignore — user might be offline.
      }
    }

    // Check immediately on mount to set the baseline.
    checkVersion(true)

    // Then poll every 5 minutes.
    const id = setInterval(() => checkVersion(false), POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!newVersion || dismissed) return null

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex justify-center px-4">
      <Card className="flex items-center gap-3 px-4 py-3 shadow-lg">
        <RefreshCw className="size-4 shrink-0 text-blue-500" />
        <p className="text-sm">
          A new version of Support Copilot is available (
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {newVersion.sha}
          </code>
          ).
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="default"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </Card>
    </div>
  )
}
