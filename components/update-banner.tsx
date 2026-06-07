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
    // Initial fetch — only writes to a ref, never calls setState.
    async function init() {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`)
        if (res.ok) {
          currentVersion.current = (await res.json()) as Version
        }
      } catch {
        // Ignore — user might be offline.
      }
    }

    init()

    // Poll for changes — this is the only path that calls setState.
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`)
        if (!res.ok) return
        const v: Version = await res.json()
        if (currentVersion.current && currentVersion.current.sha !== v.sha) {
          setNewVersion(v)
        }
      } catch {
        // Ignore.
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(id)
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
