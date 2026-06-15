"use client"

import { useEffect, useState } from "react"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CaseCanvas } from "@/components/canvas/case-canvas"
import { type CaseInfoData } from "@/components/canvas/case-info-node"
import { type ConversationData } from "@/components/canvas/conversation-node"
import { isAdhoc, type CanvasTab } from "@/lib/canvas-tabs-store"
import { type CanvasTool } from "@/lib/canvas-tools"

type Bootstrap = {
  caseInfo: CaseInfoData
  conversation: ConversationData
  playbookId?: string
  playbookName?: string
  ticketText: string
}

interface Props {
  tab: CanvasTab
  active: boolean
  tools: CanvasTool[]
  downloadUrl?: string
  /** Lets the host refresh the tab label once the customer name is known. */
  onResolveTitle?: (id: string, title: string) => void
}

// One keep-alive canvas. Ad-hoc canvases need no server data; case canvases
// fetch the same payload the route-per-canvas page computes (via
// /api/canvas/bootstrap) exactly once, then stay mounted for the session.
export function CanvasPane({ tab, active, tools, downloadUrl, onResolveTitle }: Props) {
  const adhoc = isAdhoc(tab.id)
  const [data, setData] = useState<Bootstrap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (adhoc) return
    let cancelled = false
    fetch(`/api/canvas/bootstrap?id=${encodeURIComponent(tab.id)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Failed to load (${res.status})`)
        }
        return res.json() as Promise<Bootstrap>
      })
      .then((payload) => {
        if (cancelled) return
        setData(payload)
        if (payload.caseInfo?.customerName) {
          onResolveTitle?.(tab.id, payload.caseInfo.customerName)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network error")
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, adhoc, attempt])

  if (adhoc) {
    return (
      <CaseCanvas
        storageKey={tab.id}
        tools={tools}
        downloadUrl={downloadUrl}
        active={active}
        multiplexed
      />
    )
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <AlertCircleIcon className="size-6 text-destructive" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null)
              setAttempt((a) => a + 1)
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <CaseCanvas
      storageKey={tab.id}
      tools={tools}
      downloadUrl={downloadUrl}
      active={active}
      multiplexed
      caseInfo={data.caseInfo}
      conversation={data.conversation}
      playbookId={data.playbookId}
      playbookName={data.playbookName}
      ticketText={data.ticketText}
    />
  )
}
