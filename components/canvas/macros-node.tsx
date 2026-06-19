"use client"

import { useCallback, useEffect, useState } from "react"
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react"
import {
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PinButton } from "@/components/canvas/pin-button"
import type { MacroRow } from "@/app/api/macros/route"

export type MacrosNodeData = {
  /** Present on case canvases; absent on the ad-hoc canvas (send disabled). */
  conversationId?: string
}

export type MacrosNodeType = Node<MacrosNodeData, "macros">

// Strip HTML to plain text for copy/preview (DOMParser is client-only).
function htmlToText(html: string): string {
  if (typeof window === "undefined") return html
  const doc = new DOMParser().parseFromString(html, "text/html")
  return (doc.body.textContent ?? "").replace(/\s+\n/g, "\n").trim()
}

export function MacrosNode({ id, data, selected }: NodeProps<MacrosNodeType>) {
  const [macros, setMacros] = useState<MacroRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [syncing, setSyncing] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  // D9 "Adapt to case": draft-only, per-macro inline preview. Never sent.
  const [adaptingId, setAdaptingId] = useState<string | null>(null)
  const [adaptedDrafts, setAdaptedDrafts] = useState<Record<string, string>>({})
  const [adaptCopiedId, setAdaptCopiedId] = useState<string | null>(null)

  const load = useCallback(async (q: string) => {
    try {
      // Only "everyone" macros: Intercom's API never populates
      // visible_to_team_ids, so we can't tell which agent a "specific_teams"
      // (personal/team) macro belongs to — they'd leak to everyone. See ADR-0011.
      const res = await fetch(
        `/api/macros?visibility=everyone&q=${encodeURIComponent(q)}`,
      )
      if (!res.ok) throw new Error(await res.text())
      const json = (await res.json()) as { macros: MacroRow[] }
      setMacros(json.macros)
      setError(null)
    } catch (e) {
      setError((e as Error).message || "Failed to load macros")
      setMacros([])
    }
  }, [])

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => void load(query), 250)
    return () => clearTimeout(t)
  }, [query, load])

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await fetch("/api/macros/sync", { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      const json = (await res.json()) as { synced: number }
      toast.success(`Synced ${json.synced} macros from Intercom`)
      await load(query)
    } catch (e) {
      toast.error(`Macro sync failed: ${(e as Error).message}`)
    } finally {
      setSyncing(false)
    }
  }, [load, query])

  const copy = useCallback((m: MacroRow) => {
    const text = m.bodyText ?? htmlToText(m.body)
    void navigator.clipboard.writeText(text)
    setCopiedId(m.id)
    setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1000)
  }, [])

  const send = useCallback(
    async (m: MacroRow) => {
      if (!data.conversationId) return
      const preview = (m.bodyText ?? htmlToText(m.body)).slice(0, 140)
      if (!window.confirm(`Send macro "${m.name}" as an admin reply in Intercom?\n\n${preview}…`)) {
        return
      }
      setSendingId(m.id)
      try {
        const res = await fetch("/api/draft/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: data.conversationId,
            body: m.body,
            html: true,
          }),
        })
        if (!res.ok) throw new Error(await res.text())
        toast.success(`Sent "${m.name}" to the conversation`)
      } catch (e) {
        toast.error(`Send failed: ${(e as Error).message}`)
      } finally {
        setSendingId(null)
      }
    },
    [data.conversationId],
  )

  // Adapt a macro to THIS case via deepseek. Streams a draft into an inline,
  // editable preview under the row. Draft-only: nothing is ever sent here.
  const adapt = useCallback(
    async (m: MacroRow) => {
      if (!data.conversationId) return
      setAdaptingId(m.id)
      setAdaptedDrafts((d) => ({ ...d, [m.id]: "" }))
      try {
        const res = await fetch("/api/draft/adapt-macro", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: data.conversationId,
            macroId: m.id,
          }),
        })
        if (!res.ok || !res.body) throw new Error(await res.text())

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let acc = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          acc += decoder.decode(value, { stream: true })
          setAdaptedDrafts((d) => ({ ...d, [m.id]: acc }))
        }
      } catch (e) {
        toast.error(`Adapt failed: ${(e as Error).message}`)
        setAdaptedDrafts((d) => {
          const next = { ...d }
          delete next[m.id]
          return next
        })
      } finally {
        setAdaptingId((a) => (a === m.id ? null : a))
      }
    },
    [data.conversationId],
  )

  const copyAdapted = useCallback((id: string, text: string) => {
    void navigator.clipboard.writeText(text)
    setAdaptCopiedId(id)
    setTimeout(() => setAdaptCopiedId((c) => (c === id ? null : c)), 1000)
  }, [])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card shadow-md">
      <NodeResizer isVisible={selected} minWidth={300} minHeight={240} />
      <div className="flex h-10 shrink-0 cursor-grab items-center gap-2 border-b bg-muted/50 px-3 active:cursor-grabbing">
        <ZapIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold">Macros</span>
        <div className="nodrag ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="Sync from Intercom"
            onClick={sync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
          </Button>
          <PinButton nodeId={id} />
        </div>
      </div>

      <div className="nodrag flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <SearchIcon className="size-3 shrink-0 text-muted-foreground" />
        <Input
          className="h-6 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
          placeholder="Search macros…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="nodrag flex-1 overflow-y-auto p-2">
        {macros === null && (
          <div className="flex h-full items-center justify-center">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && <p className="p-2 text-xs text-destructive">{error}</p>}
        {macros !== null && macros.length === 0 && !error && (
          <p className="p-2 text-xs text-muted-foreground">
            No macros. Hit sync ↻ to pull them from Intercom.
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {macros?.map((m) => (
            <li key={m.id} className="rounded-lg border bg-background p-2">
              <div className="flex items-center gap-1">
                <span className="truncate text-xs font-medium">{m.name}</span>
                {m.visibility !== "everyone" && (
                  <span className="shrink-0 rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">
                    {m.visibility}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    title="Copy text"
                    onClick={() => copy(m)}
                  >
                    {copiedId === m.id ? (
                      <CheckIcon className="size-3 text-emerald-500" />
                    ) : (
                      <CopyIcon className="size-3" />
                    )}
                  </Button>
                  {data.conversationId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title="Adapt to this case (AI draft — review before sending)"
                      onClick={() => adapt(m)}
                      disabled={adaptingId === m.id}
                    >
                      {adaptingId === m.id ? (
                        <Loader2Icon className="size-3 animate-spin" />
                      ) : (
                        <SparklesIcon className="size-3 text-violet-500" />
                      )}
                    </Button>
                  )}
                  {data.conversationId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title="Send as admin reply in Intercom"
                      onClick={() => send(m)}
                      disabled={sendingId === m.id}
                    >
                      {sendingId === m.id ? (
                        <Loader2Icon className="size-3 animate-spin" />
                      ) : (
                        <SendIcon className="size-3" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                {m.bodyText ?? htmlToText(m.body)}
              </p>
              {adaptedDrafts[m.id] !== undefined && (
                <div className="mt-2 rounded-md border border-violet-200 bg-violet-50/50 p-1.5 dark:border-violet-900 dark:bg-violet-950/20">
                  <div className="mb-1 flex items-center gap-1">
                    <SparklesIcon className="size-2.5 text-violet-500" />
                    <span className="text-[10px] font-medium text-violet-700 dark:text-violet-300">
                      Adapted draft — review &amp; copy (not sent)
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-5"
                      title="Copy adapted draft"
                      disabled={!adaptedDrafts[m.id]}
                      onClick={() => copyAdapted(m.id, adaptedDrafts[m.id])}
                    >
                      {adaptCopiedId === m.id ? (
                        <CheckIcon className="size-2.5 text-emerald-500" />
                      ) : (
                        <CopyIcon className="size-2.5" />
                      )}
                    </Button>
                  </div>
                  <textarea
                    className="h-24 w-full resize-y rounded border bg-background p-1.5 text-[11px] leading-snug focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400"
                    value={adaptedDrafts[m.id]}
                    placeholder={
                      adaptingId === m.id ? "Adapting…" : "Adapted draft"
                    }
                    onChange={(e) =>
                      setAdaptedDrafts((d) => ({ ...d, [m.id]: e.target.value }))
                    }
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
