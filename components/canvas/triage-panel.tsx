"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  CheckIcon,
  Loader2Icon,
  RadarIcon,
  ShieldAlertIcon,
  SparklesIcon,
  SquareIcon,
  StarIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCanvasNav } from "@/components/canvas/canvas-nav"
import { readApiError } from "@/lib/api-error"
import { onCanvasRefresh } from "@/lib/canvas-refresh"
import { useCanvasListHotkeys } from "@/lib/canvas-hotkeys"
import {
  markRecentlyAssigned,
  readRecentlyAssigned,
  subscribeRecentlyAssigned,
} from "@/lib/triage-recently-assigned"
import { cn, relativeTime } from "@/lib/utils"
import {
  AUDIENCES,
  EMPTY_TRIAGE_PREFS,
  type RankedTriageItem,
  type TriagePrefs,
} from "@/lib/triage/match"

// Mirrors lib/triage/store.ts TriageSweepStatus — that module is server-only
// and can't be imported into this client component.
type TriageSweepStatus = { ranAt: string; complete: boolean; seen: number; error: string | null }

const AUDIENCE_OPTIONS = Object.keys(AUDIENCES) as Array<keyof typeof AUDIENCES>
const MAX_KEYWORDS = 20
const MAX_MATCHED_TERMS_SHOWN = 4
const PREFS_SAVE_DEBOUNCE_MS = 600
// Mirrors BULK_MAX in app/api/reply-queue/assign-bulk/route.ts — lets the
// client know exactly which selected ids the server will actually attempt,
// so only those (not ids beyond the cap) get removed from the list on success.
const BULK_ASSIGN_MAX = 15

// The "Triage" tab of the canvas left sidebar: a filtered, urgency-ranked view
// of open conversations nobody is working (unassigned, or Fin-held), swept
// into a pool by the backend cron/manual sweep (lib/triage/sweep.ts). The
// agent tunes personal filters (keywords + optional AI-expanded similar
// terms, audience, priority-only) and the list re-ranks server-side
// (lib/triage/match.ts filterAndRank). Every row has exactly one human-gated
// write — "Assign to me" (POST /api/reply-queue/assign), the same endpoint the
// Inbox tab uses — which assigns in Intercom and kicks off the AI draft; the
// case then shows up in the Queue tab. The agent can also multi-select rows
// and claim them together via "Assign N + draft" (POST
// /api/reply-queue/assign-bulk) — still one explicit click, just batched; the
// AI never auto-assigns either way. Nothing else here writes anywhere.
export function TriagePanel({
  active,
  onCount,
}: {
  active: boolean
  onCount?: (n: number) => void
}) {
  const nav = useCanvasNav()
  const [ranked, setRanked] = useState<RankedTriageItem[] | null>(null)
  const [pool, setPool] = useState(0)
  const [prefs, setPrefs] = useState<TriagePrefs>(EMPTY_TRIAGE_PREFS)
  const [sweptAt, setSweptAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sweeping, setSweeping] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [keywordDraft, setKeywordDraft] = useState("")
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [sweepStatus, setSweepStatus] = useState<TriageSweepStatus | null>(null)
  // Ids the agent just claimed — hidden locally until the TTL expires, in case
  // a poll races the server's pool delete (see lib/triage-recently-assigned).
  const [recentlyAssigned, setRecentlyAssigned] = useState<Set<string>>(() => new Set())

  // Whether the in-flight/pending prefs save carries a keyword change with
  // expand=true — that's the only save shape that costs an LLM call, so it's
  // the only one worth a distinct spinner next to the checkbox label.
  const [expandSaving, setExpandSaving] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastKeywordsKeyRef = useRef<string>("")
  // True from the moment a prefs change is scheduled until its save settles.
  // The 45s poll must not sync prefs from the server in that window — it would
  // clobber the user's in-progress chip edits with stale server state (the
  // debounced save then restores them, but the flicker reads as data loss).
  const prefsDirtyRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/triage")
      const data = await res.json()
      setRanked(Array.isArray(data.items) ? data.items : [])
      setPool(typeof data.pool === "number" ? data.pool : 0)
      setSweptAt(typeof data.sweptAt === "string" ? data.sweptAt : null)
      setSweepStatus(
        data.sweepStatus && typeof data.sweepStatus.complete === "boolean"
          ? (data.sweepStatus as TriageSweepStatus)
          : null
      )
      if (!prefsDirtyRef.current) {
        setPrefs(data.prefs ?? EMPTY_TRIAGE_PREFS)
        lastKeywordsKeyRef.current = (data.prefs?.keywords ?? []).join(",")
      }
      setError(typeof data.error === "string" ? data.error : null)
    } catch {
      setError("Couldn't load the triage pool.")
      setRanked((prev) => prev ?? [])
    }
  }, [])

  // Poll every 45s + on canvas refresh, only while this tab is the active,
  // visible one — mirrors queue-panel's gating.
  useEffect(() => {
    if (!active) return
    queueMicrotask(() => void load())
    const id = setInterval(() => void load(), 45_000)
    const off = onCanvasRefresh(() => void load())
    return () => {
      clearInterval(id)
      off()
    }
  }, [active, load])

  // Keep the local "just assigned" set in sync (written by assign/bulk below,
  // and possibly by another pane via the storage event).
  useEffect(() => {
    const sync = () => setRecentlyAssigned(readRecentlyAssigned())
    sync()
    return subscribeRecentlyAssigned(sync)
  }, [])

  // What the panel actually shows: the ranked list minus anything the agent
  // just claimed (server already evicts these; this covers a poll that raced
  // the delete). Null while loading, same as `ranked`.
  const visibleRanked = useMemo(
    () =>
      ranked && recentlyAssigned.size > 0
        ? ranked.filter((r) => !recentlyAssigned.has(r.item.conversationId))
        : ranked,
    [ranked, recentlyAssigned]
  )

  useEffect(() => {
    onCount?.(visibleRanked?.length ?? 0)
  }, [visibleRanked, onCount])

  // Derived, not synced via an effect: whenever the ranked list reloads, any
  // selected id no longer present (assigned/closed/filtered out elsewhere)
  // simply drops out of this view. The underlying `selected` set may still
  // hold the stale id, but nothing reads `selected` directly for display or
  // actions — only this filtered value — so it behaves exactly as if the
  // selection had been reset.
  const selectedVisible = useMemo(() => {
    if (!visibleRanked || selected.size === 0) return selected
    const liveIds = new Set(visibleRanked.map((r) => r.item.conversationId))
    let changed = false
    const next = new Set<string>()
    for (const id of selected) {
      if (liveIds.has(id)) next.add(id)
      else changed = true
    }
    return changed ? next : selected
  }, [visibleRanked, selected])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  // Debounced prefs save — any filter change (keywords, expand, audiences,
  // priorityOnly) lands here so a burst of chip edits collapses into one POST.
  const savePrefs = useCallback((next: TriagePrefs) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    prefsDirtyRef.current = true
    const keywordsChanged = next.keywords.join(",") !== lastKeywordsKeyRef.current
    setExpandSaving(keywordsChanged && next.expand)
    saveTimerRef.current = setTimeout(() => {
      void (async () => {
        setSavingPrefs(true)
        try {
          const res = await fetch("/api/triage/prefs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              keywords: next.keywords,
              expand: next.expand,
              audiences: next.audiences,
              priorityOnly: next.priorityOnly,
            }),
          })
          if (!res.ok) throw new Error(await readApiError(res, `Failed (${res.status})`))
          const data = await res.json()
          const saved: TriagePrefs = data.prefs ?? next
          setPrefs(saved)
          lastKeywordsKeyRef.current = saved.keywords.join(",")
          if (data.warning === "expansion unavailable") {
            toast.warning("AI expansion unavailable — matching literal keywords only")
          }
          await load()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't save filters.")
        } finally {
          prefsDirtyRef.current = false
          setSavingPrefs(false)
          setExpandSaving(false)
        }
      })()
    }, PREFS_SAVE_DEBOUNCE_MS)
  }, [load])

  const updatePrefs = useCallback(
    (patch: Partial<TriagePrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch }
        savePrefs(next)
        return next
      })
    },
    [savePrefs]
  )

  // Commits an explicit term (used for comma-split paste, where the value to
  // add isn't the `keywordDraft` state — reading that here would race the
  // pending setState from the same change) or, with no argument, whatever is
  // currently in the draft input (the Enter/comma-keystroke path).
  const commitKeywordText = useCallback(
    (text: string) => {
      const term = text.trim().toLowerCase()
      if (!term) return
      setPrefs((prev) => {
        if (prev.keywords.includes(term) || prev.keywords.length >= MAX_KEYWORDS) return prev
        const next = { ...prev, keywords: [...prev.keywords, term] }
        savePrefs(next)
        return next
      })
    },
    [savePrefs]
  )

  const commitKeyword = useCallback(() => {
    commitKeywordText(keywordDraft)
    setKeywordDraft("")
  }, [keywordDraft, commitKeywordText])

  // Paste-safe: "vip, urgent, refund" splits into three chips in one go. The
  // segment after the last comma (if any) becomes the new draft rather than
  // being committed, so a paste ending mid-word doesn't lose that fragment.
  const onKeywordInputChange = useCallback(
    (value: string) => {
      if (!value.includes(",")) {
        setKeywordDraft(value)
        return
      }
      const parts = value.split(",")
      const trailing = parts.pop() ?? ""
      parts.forEach(commitKeywordText)
      setKeywordDraft(trailing)
    },
    [commitKeywordText]
  )

  const removeKeyword = useCallback(
    (term: string) => {
      setPrefs((prev) => {
        const next = { ...prev, keywords: prev.keywords.filter((k) => k !== term) }
        savePrefs(next)
        return next
      })
    },
    [savePrefs]
  )

  const toggleAudience = useCallback(
    (audience: string) => {
      const has = prefs.audiences.includes(audience)
      updatePrefs({
        audiences: has
          ? prefs.audiences.filter((a) => a !== audience)
          : [...prefs.audiences, audience],
      })
    },
    [prefs.audiences, updatePrefs]
  )

  const clearFilters = useCallback(() => {
    setKeywordDraft("")
    setPrefs(EMPTY_TRIAGE_PREFS)
    savePrefs(EMPTY_TRIAGE_PREFS)
  }, [savePrefs])

  const sweepNow = async () => {
    setSweeping(true)
    try {
      const res = await fetch("/api/triage/run", { method: "POST" })
      if (res.status === 429) {
        toast.info("Swept less than a minute ago")
        return
      }
      if (!res.ok) throw new Error(await readApiError(res, `Failed (${res.status})`))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sweep right now.")
    } finally {
      setSweeping(false)
    }
  }

  const remove = useCallback((conversationId: string) => {
    setRanked((prev) => (prev ? prev.filter((r) => r.item.conversationId !== conversationId) : prev))
  }, [])

  const hasFilters =
    prefs.keywords.length > 0 || prefs.audiences.length > 0 || prefs.priorityOnly

  const assignToMe = async (conversationId: string) => {
    setAssigningId(conversationId)
    try {
      const res = await fetch("/api/reply-queue/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      })
      if (!res.ok) throw new Error(await readApiError(res, `Failed (${res.status})`))
      toast.success("Assigned — drafting a reply")
      markRecentlyAssigned([conversationId])
      remove(conversationId)
      if (nav) nav.open(conversationId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't assign this case.")
    } finally {
      setAssigningId(null)
    }
  }

  const toggleSelect = useCallback((conversationId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(conversationId)) next.delete(conversationId)
      else next.add(conversationId)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelected(
      selectedVisible.size > 0
        ? new Set()
        : new Set((visibleRanked ?? []).map((r) => r.item.conversationId))
    )
  }, [selectedVisible, visibleRanked])

  const assignSelected = async () => {
    const ids = Array.from(selectedVisible)
    if (ids.length === 0) return
    // Mirror the server's own cap/order so we know exactly which ids it will
    // have attempted, independent of what it reports back.
    const taken = ids.slice(0, BULK_ASSIGN_MAX)

    setBulkAssigning(true)
    try {
      const res = await fetch("/api/reply-queue/assign-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: ids }),
      })
      if (!res.ok) throw new Error(await readApiError(res, `Failed (${res.status})`))
      const data = await res.json()

      const assignedCount = typeof data.assigned === "number" ? data.assigned : 0
      const failedList: Array<{ conversationId: string; error?: string }> = Array.isArray(data.failed)
        ? data.failed
        : []
      const dropped = typeof data.dropped === "number" ? data.dropped : 0
      const failedIds = new Set(failedList.map((f) => f.conversationId))

      toast.success(`Assigned ${assignedCount} — drafting replies`)
      if (failedList.length > 0) {
        toast.warning(`${failedList.length} couldn't be assigned`)
      }
      if (dropped > 0) {
        toast.info(`Only the first ${BULK_ASSIGN_MAX} were sent (${dropped} not sent)`)
      }

      // Remove only the ids the server actually took AND succeeded on — ids
      // beyond the cap were never attempted, and failed ids stay so the
      // agent can retry them.
      const removedIds = new Set(taken.filter((id) => !failedIds.has(id)))
      markRecentlyAssigned(Array.from(removedIds))
      setRanked((prev) => (prev ? prev.filter((r) => !removedIds.has(r.item.conversationId)) : prev))
      setSelected(new Set())
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't assign the selected cases.")
    } finally {
      setBulkAssigning(false)
    }
  }

  // Ctrl/Cmd+A toggles select-all; Ctrl/Cmd+Enter fires the primary bulk action
  // ("Assign N + draft") on the current selection.
  useCanvasListHotkeys({
    active,
    onSelectAll: toggleSelectAll,
    onPrimary: () => {
      if (selectedVisible.size === 0 || bulkAssigning) return
      void assignSelected()
    },
  })

  return (
    <div className="flex h-full flex-col">
      <TriageHeader
        sweptAt={sweptAt}
        pool={pool}
        sweeping={sweeping}
        sweepStatus={sweepStatus}
        onSweep={() => void sweepNow()}
      />
      <FilterBar
        prefs={prefs}
        keywordDraft={keywordDraft}
        onKeywordDraftChange={onKeywordInputChange}
        onCommitKeyword={commitKeyword}
        onRemoveKeyword={removeKeyword}
        onToggleExpand={() => updatePrefs({ expand: !prefs.expand })}
        onToggleAudience={toggleAudience}
        onTogglePriorityOnly={() => updatePrefs({ priorityOnly: !prefs.priorityOnly })}
        expandSaving={expandSaving}
        savingPrefs={savingPrefs}
      />

      <div className="flex-1 overflow-y-auto">
        {visibleRanked === null && <TriageSkeleton />}
        {visibleRanked !== null && visibleRanked.length === 0 && (
          <TriageEmptyState
            pool={pool}
            hasFilters={hasFilters}
            error={error}
            onClearFilters={clearFilters}
          />
        )}
        {visibleRanked !== null && visibleRanked.length > 0 && (
          <div className="flex flex-col gap-1.5 p-2">
            {error && <p className="px-1 text-xs text-destructive">{error}</p>}
            <button
              type="button"
              onClick={toggleSelectAll}
              disabled={bulkAssigning}
              title="Select all (Ctrl+A) · Ctrl+Enter to assign + draft"
              className="flex w-fit items-center gap-1.5 px-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {selectedVisible.size > 0 ? (
                <CheckIcon className="size-3.5 text-primary" />
              ) : (
                <SquareIcon className="size-3.5" />
              )}
              {selectedVisible.size > 0 ? `Clear (${selectedVisible.size})` : "Select all"}
            </button>
            {visibleRanked.map((entry) => (
              <TriageRow
                key={entry.item.conversationId}
                entry={entry}
                assigning={assigningId === entry.item.conversationId}
                disabled={assigningId !== null || bulkAssigning}
                selected={selectedVisible.has(entry.item.conversationId)}
                selectDisabled={bulkAssigning}
                onToggleSelect={() => toggleSelect(entry.item.conversationId)}
                onAssign={() => void assignToMe(entry.item.conversationId)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedVisible.size > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t bg-background px-2 py-2">
          <span className="text-[11px] text-muted-foreground">{selectedVisible.size} selected</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-[11px]"
            onClick={() => setSelected(new Set())}
            disabled={bulkAssigning}
          >
            Clear
          </Button>
          <Button
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => void assignSelected()}
            disabled={bulkAssigning}
          >
            {bulkAssigning ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <UserPlusIcon className="size-3.5" />
            )}
            Assign {selectedVisible.size} + draft
          </Button>
        </div>
      )}
    </div>
  )
}

function TriageHeader({
  sweptAt,
  pool,
  sweeping,
  sweepStatus,
  onSweep,
}: {
  sweptAt: string | null
  pool: number
  sweeping: boolean
  sweepStatus: TriageSweepStatus | null
  onSweep: () => void
}) {
  const swept = sweptAt ? relativeTime(sweptAt) : ""
  // The pool count is only trustworthy when the last sweep ran to completion.
  // A partial/errored sweep means the queue is bigger than what's shown and
  // some conversations weren't refreshed this run — flag it so the agent reads
  // "N in pool" as a floor, not the whole picture.
  const partial = sweepStatus != null && !sweepStatus.complete
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b px-2 py-2">
      <div className="flex items-center gap-2">
        <RadarIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[11px] text-muted-foreground">
          Last swept {swept || "never"}
        </span>
        <Badge
          variant={partial ? "outline" : "secondary"}
          className="h-5 shrink-0 px-1.5 font-normal tabular-nums"
        >
          {pool} in pool{partial ? "+" : ""}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-[11px] text-muted-foreground"
          onClick={onSweep}
          disabled={sweeping}
        >
          {sweeping ? <Loader2Icon className="size-3.5 animate-spin" /> : <RadarIcon className="size-3.5" />}
          Sweep now
        </Button>
      </div>
      {partial && (
        <p className="flex items-center gap-1 text-[10px] leading-tight text-amber-600 dark:text-amber-400">
          <ShieldAlertIcon className="size-3 shrink-0" />
          {sweepStatus?.error
            ? "Last sweep couldn't finish — showing the last good pool; some may be missing or stale."
            : "Large queue — last sweep was partial; more may be unassigned than shown."}
        </p>
      )}
    </div>
  )
}

function FilterBar({
  prefs,
  keywordDraft,
  onKeywordDraftChange,
  onCommitKeyword,
  onRemoveKeyword,
  onToggleExpand,
  onToggleAudience,
  onTogglePriorityOnly,
  expandSaving,
  savingPrefs,
}: {
  prefs: TriagePrefs
  keywordDraft: string
  onKeywordDraftChange: (v: string) => void
  onCommitKeyword: () => void
  onRemoveKeyword: (term: string) => void
  onToggleExpand: () => void
  onToggleAudience: (audience: string) => void
  onTogglePriorityOnly: () => void
  expandSaving: boolean
  savingPrefs: boolean
}) {
  const activeFilterCount =
    prefs.audiences.length + (prefs.priorityOnly ? 1 : 0)

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b px-2 py-2">
      <div className="flex items-center gap-1.5">
        <Input
          value={keywordDraft}
          onChange={(e) => onKeywordDraftChange(e.target.value)}
          onKeyDown={(e) => {
            // Plain Enter or a typed "," commits the current draft as a chip
            // (preventDefault keeps the comma itself out of the input). A
            // pasted string containing commas instead goes through
            // onKeywordDraftChange -> onKeywordInputChange, which splits it.
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              onCommitKeyword()
            }
          }}
          placeholder="Filter by keyword…"
          className="h-7 flex-1 text-xs"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-[11px]">
              Filters
              {activeFilterCount > 0 && (
                <Badge
                  variant="secondary"
                  className="h-4 px-1 text-[10px] font-normal tabular-nums"
                >
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 text-xs">
            <p className="text-[11px] font-medium text-muted-foreground">Audience</p>
            <div className="flex flex-wrap gap-1.5">
              {AUDIENCE_OPTIONS.map((audience) => (
                <ChipToggle
                  key={audience}
                  label={audience}
                  active={prefs.audiences.includes(audience)}
                  onClick={() => onToggleAudience(audience)}
                />
              ))}
            </div>
            <div className="mt-1 border-t pt-2">
              <ChipToggle
                label="Priority only"
                active={prefs.priorityOnly}
                onClick={onTogglePriorityOnly}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {prefs.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {prefs.keywords.map((term) => (
            <Badge key={term} variant="outline" className="h-5 gap-1 px-1.5 font-normal">
              {term}
              <button
                type="button"
                onClick={() => onRemoveKeyword(term)}
                aria-label={`Remove ${term}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-fit items-center gap-1.5 text-left"
      >
        <span
          className={cn(
            "flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors",
            prefs.expand
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/40"
          )}
        >
          {prefs.expand && <CheckIcon className="size-2.5" />}
        </span>
        <span className="text-[11px] text-muted-foreground">Match similar terms (AI)</span>
        {expandSaving && <Loader2Icon className="size-3 animate-spin text-muted-foreground" />}
      </button>
      {savingPrefs && !expandSaving && (
        <span className="text-[10px] text-muted-foreground">Saving filters…</span>
      )}
    </div>
  )
}

function ChipToggle({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/30 text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
}

function TriageRow({
  entry,
  assigning,
  disabled,
  selected,
  selectDisabled,
  onToggleSelect,
  onAssign,
}: {
  entry: RankedTriageItem
  assigning: boolean
  disabled: boolean
  selected: boolean
  selectDisabled: boolean
  onToggleSelect: () => void
  onAssign: () => void
}) {
  const nav = useCanvasNav()
  const { item, matchedTerms } = entry
  const caseHref = `/cases/${item.conversationId}/canvas`
  const openPeek = () => {
    if (nav) nav.open(item.conversationId)
  }
  const shownTerms = matchedTerms.slice(0, MAX_MATCHED_TERMS_SHOWN)
  const overflow = matchedTerms.length - shownTerms.length

  const header = (
    <>
      <span className="flex items-center gap-2">
        <span className="truncate text-xs font-medium">
          {item.customerName ?? "Unknown"}
        </span>
        {item.priority && (
          <StarIcon className="size-3 shrink-0 fill-current text-primary" />
        )}
        {item.capabilityGap && (
          <span
            title="Sensitive category — verify in fadmin"
            className="inline-flex shrink-0 text-destructive"
          >
            <ShieldAlertIcon className="size-3.5" />
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {relativeTime(item.waitingSince)}
        </span>
      </span>
      {/* Ticket theme: the subject when there is one, else a preview of the
          first customer message (subject is often empty on chat/widget
          tickets — see lib/intercom.ts toSweepConversation). */}
      {(item.subject || item.snippet) && (
        <span className="line-clamp-1 text-[11px] text-muted-foreground">
          {item.subject || item.snippet}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-1">
        {item.slaStatus === "missed" && (
          <Badge variant="destructive" className="h-4 px-1 text-[10px] font-normal">
            SLA missed
          </Badge>
        )}
        {item.slaStatus === "active" && (
          <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
            SLA active
          </Badge>
        )}
        {item.matchedPlaybookName && (
          <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
            {item.matchedPlaybookName}
          </Badge>
        )}
        {shownTerms.map((term) => (
          <span
            key={term}
            className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {term}
          </span>
        ))}
        {overflow > 0 && (
          <span className="text-[10px] text-muted-foreground">+{overflow}</span>
        )}
      </span>
    </>
  )

  return (
    <article
      className={cn(
        "rounded-md border bg-card transition-colors hover:border-foreground/20",
        selected && "border-primary/60 bg-primary/5",
        selectDisabled && "opacity-60"
      )}
    >
      {/* Row body: checkbox toggles multi-select without opening the peek
          (stopPropagation); the rest of the row peeks the case (no
          assignment) — client-side tab switch when this canvas is inside the
          keep-alive workspace (nav present), a plain navigation link on the
          route-per-canvas pages otherwise. Same split as InboxPanel/QueuePanel. */}
      <div className="flex items-start gap-1 px-1.5 pt-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect()
          }}
          disabled={selectDisabled}
          aria-pressed={selected}
          aria-label={selected ? "Deselect case" : "Select case"}
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center disabled:opacity-50",
            selected ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"
          )}
        >
          {selected ? <CheckIcon className="size-4" /> : <SquareIcon className="size-4" />}
        </button>
        {nav ? (
          <button
            type="button"
            onClick={openPeek}
            className="flex w-full flex-col gap-1 pb-1.5 text-left"
          >
            {header}
          </button>
        ) : (
          <Link href={caseHref} className="flex w-full flex-col gap-1 pb-1.5 text-left">
            {header}
          </Link>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t px-2.5 py-1.5">
        <Button
          size="sm"
          className="ml-auto h-7 px-2.5 text-xs"
          onClick={(e) => {
            e.stopPropagation()
            onAssign()
          }}
          disabled={disabled}
        >
          {assigning ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <UserPlusIcon className="size-3.5" />
          )}
          Assign to me
        </Button>
      </div>
    </article>
  )
}

function TriageSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-md border bg-card px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ml-auto h-2.5 w-8" />
          </div>
          <Skeleton className="mt-1.5 h-2.5 w-5/6" />
        </div>
      ))}
    </div>
  )
}

function TriageEmptyState({
  pool,
  hasFilters,
  error,
  onClearFilters,
}: {
  pool: number
  hasFilters: boolean
  error: string | null
  onClearFilters: () => void
}) {
  const noMatch = !error && pool > 0
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
      <div
        className={
          error
            ? "flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"
            : "flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
        }
      >
        <SparklesIcon className="size-5" />
      </div>
      <p className="text-xs font-medium">
        {error
          ? "Couldn't load the triage pool."
          : noMatch
            ? `No tickets match your filters (${pool} in pool).`
            : "Nothing in the triage pool right now."}
      </p>
      {error && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Retrying every 45 seconds.
        </p>
      )}
      {noMatch && hasFilters && (
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={onClearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  )
}
