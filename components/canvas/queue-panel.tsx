"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  InboxIcon,
  InfoIcon,
  Loader2Icon,
  PencilIcon,
  RotateCwIcon,
  SendIcon,
  ShieldAlertIcon,
  SparklesIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCanvasNav } from "@/components/canvas/canvas-nav"
import { readApiError } from "@/lib/api-error"
import { onCanvasRefresh } from "@/lib/canvas-refresh"
import { useCanvasListHotkeys } from "@/lib/canvas-hotkeys"
import {
  addPendingOnRequestDrafts,
  isStuck,
  readPendingOnRequestDrafts,
  removePendingOnRequestDrafts,
  subscribePendingOnRequestDrafts,
  type PendingOnRequestDraft,
} from "@/lib/on-request-drafts"
import { cn, relativeTime } from "@/lib/utils"

// Mirrors lib/reply-queue-store.ts QueueItem (defined locally — that module is
// server-only, can't be imported into a client component).
type RiskBand = "ready" | "needs_check" | "low_confidence"
type SuggestionSource = { title?: string; url?: string; kind?: string }
type QueueItem = {
  id: string
  intercomConversationId: string
  ownerId: string | null
  customerName: string | null
  subject: string | null
  body: string
  justification: string
  sources: SuggestionSource[]
  confidence: number | null
  riskBand: RiskBand
  createdAt: string
}
// A non-read conversation whose AI draft is still being generated (no ready row
// yet). Mirrors the `drafting` payload from /api/reply-queue. `waitingSince` is
// when the customer's message landed (Intercom waiting_since) — the basis for
// telling a fresh placeholder from one that's been silently failing.
type DraftingItem = {
  conversationId: string
  customerName: string | null
  subject: string | null
  waitingSince: string | null
}

const byOldest = (a: QueueItem, b: QueueItem) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()

// How long a conversation may sit in the "drafting" list (no ready row yet)
// before we treat generation as likely failed rather than just slow. Measured
// from when WE first observed it drafting (client-side), NOT the customer's
// Intercom waiting_since — an old triage ticket has been "waiting" for ages, but
// its draft only just started, so the customer clock produced instant false
// failures. The backfill retries a conversation once per BACKFILL_WINDOW_MS
// (5 min), so this must be longer than one retry cycle.
const AUTONOMOUS_STUCK_AFTER_MS = 6 * 60 * 1000

// After the agent hits Retry on a stuck autonomous card, treat it as freshly
// drafting for this long — the card flips back to the "Drafting…" spinner
// instead of staying red, giving visible feedback while the recompute runs. A
// successful recompute lands within a poll or two and the card moves to "Ready";
// if it fails again, the card returns to stuck once this window elapses.
const AUTONOMOUS_RETRY_GRACE_MS = 4 * 60 * 1000

// stuck when it has been continuously in the drafting list longer than the
// threshold (draftingSinceMs = when we first saw it there, undefined = brand new).
function isAutonomousDraftingStuck(draftingSinceMs: number | undefined, nowMs: number): boolean {
  return draftingSinceMs != null && nowMs - draftingSinceMs > AUTONOMOUS_STUCK_AFTER_MS
}

// Single source of truth for the audited send path — POST /api/draft/send then
// POST /api/reply-queue/resolve — shared by QueueRow's own approve button AND
// the "Ready to send" bulk bar, so the two paths can never diverge.
async function postSendAndResolve(
  item: QueueItem,
  body: string
): Promise<{ ok: boolean; resolvedOk: boolean; error?: string }> {
  const bodyChanged = body.trim() !== item.body.trim()
  try {
    const res = await fetch("/api/draft/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: item.intercomConversationId, body }),
    })
    if (!res.ok) {
      return {
        ok: false,
        resolvedOk: false,
        error: await readApiError(res, `Failed to send (${res.status})`),
      }
    }
  } catch (error) {
    return {
      ok: false,
      resolvedOk: false,
      error:
        error instanceof Error ? error.message : "Couldn't send. Open the case and try there.",
    }
  }

  // The queue-clearing resolve call is best-effort — the send already went out,
  // so a failure here just means the row lingers until the next reconcile.
  const resolveRes = await fetch("/api/reply-queue/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: item.intercomConversationId,
      suggestionId: item.id,
      action: bodyChanged ? "edit" : "approve",
      bodyChanged,
      finalBody: body,
    }),
  }).catch(() => null)

  return { ok: true, resolvedOk: !!resolveRes?.ok }
}

// Shared reject/dismiss path — a single resolve call, no outbound send.
async function postReject(item: QueueItem): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/reply-queue/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: item.intercomConversationId,
        suggestionId: item.id,
        action: "reject",
      }),
    })
    if (!res.ok) return { ok: false, error: await res.text() }
    return { ok: true }
  } catch {
    return { ok: false, error: "Couldn't dismiss this suggestion." }
  }
}

// The autonomous non-read AI reply queue: pre-computed suggestions for the
// conversations assigned to the signed-in agent, in two bands. The agent
// approves the send with one click (human-gated). Draft-only: nothing leaves the
// system without that click. Rendered as the "Queue" tab of the canvas left
// sidebar (see canvas-left-sidebar.tsx).
export function QueuePanel({
  active,
  onCount,
}: {
  active: boolean
  onCount?: (n: number) => void
}) {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [drafting, setDrafting] = useState<DraftingItem[]>([])
  // Drafts the agent generated on demand from the Inbox for tickets that are no
  // longer non-read (already replied). Durable — never staled by reconciliation.
  const [onRequest, setOnRequest] = useState<QueueItem[]>([])
  const [manualDrafting, setManualDrafting] = useState<PendingOnRequestDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  // Wall-clock, ticked by the poll below (never Date.now() during render — that's
  // an impure call). Drives the "stuck placeholder → failed" cutoff.
  const [now, setNow] = useState(0)

  // Multi-select for the "Ready to send" band only (mirrors inbox-panel.tsx).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkActing, setBulkActing] = useState(false)
  const [confirmBulkSend, setConfirmBulkSend] = useState(false)
  // Separate multi-select for the "On request" band (its own send/cancel bar).
  const [selectedOnReq, setSelectedOnReq] = useState<Set<string>>(new Set())
  const [onReqActing, setOnReqActing] = useState(false)
  const [confirmOnReqSend, setConfirmOnReqSend] = useState(false)
  // Autonomous "drafting…" placeholders the agent dismissed after they got
  // stuck. Session-local (no localStorage): a reload re-evaluating them as
  // stuck-again is fine, and this avoids a persistence layer for what's really
  // just "stop showing me this one for now".
  const [dismissedAutonomous, setDismissedAutonomous] = useState<Set<string>>(new Set())
  // conversationId → timestamp of the last Retry click. While within
  // AUTONOMOUS_RETRY_GRACE_MS, the card renders as "Drafting…" again instead of
  // stuck (session-local; expires by time).
  const [retriedAutonomous, setRetriedAutonomous] = useState<Record<string, number>>({})
  // conversationId → when we FIRST observed it in the drafting list. Drives the
  // stuck cutoff off actual drafting duration, not the customer's wait time.
  const [draftingSince, setDraftingSince] = useState<Record<string, number>>({})
  const masterRef = useRef<HTMLInputElement>(null)
  // Anchor ID (not index) for shift-click range selection — the poll reorders
  // the list, so an index would select the wrong range after a refresh.
  const anchorRef = useRef<string | null>(null)
  const onReqAnchorRef = useRef<string | null>(null)
  const onReqMasterRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reply-queue")
      const data = await res.json()
      const nextItems: QueueItem[] = Array.isArray(data.items) ? data.items : []
      const nextDrafting: DraftingItem[] = Array.isArray(data.drafting) ? data.drafting : []
      const nextOnRequest: QueueItem[] = Array.isArray(data.onRequest) ? data.onRequest : []
      setItems(nextItems)
      setDrafting(nextDrafting)
      setOnRequest(nextOnRequest)
      // Track first-seen-drafting: keep the timestamp for conversations still
      // drafting, stamp new ones now, drop those that resolved/left.
      setDraftingSince((prev) => {
        const nowMs = Date.now()
        const next: Record<string, number> = {}
        for (const d of nextDrafting) {
          next[d.conversationId] = prev[d.conversationId] ?? nowMs
        }
        return next
      })
      removePendingOnRequestDrafts(
        [...nextItems, ...nextOnRequest].map((item) => item.intercomConversationId)
      )
      setError(typeof data.error === "string" ? data.error : null)
      // Drop any selected ids that polled away (sent/rejected/no longer in the
      // ready band), so a bulk action only ever acts on rows still on screen.
      const readyIds = new Set(
        nextItems.filter((i) => i.riskBand !== "needs_check").map((i) => i.id)
      )
      setSelectedIds((prev) => {
        let changed = false
        const next = new Set<string>()
        prev.forEach((id) => (readyIds.has(id) ? next.add(id) : (changed = true)))
        return changed ? next : prev
      })
      const onReqIds = new Set(nextOnRequest.map((i) => i.id))
      setSelectedOnReq((prev) => {
        let changed = false
        const next = new Set<string>()
        prev.forEach((id) => (onReqIds.has(id) ? next.add(id) : (changed = true)))
        return changed ? next : prev
      })
    } catch {
      setError("Couldn't load the reply queue.")
      setItems((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    const sync = () => setManualDrafting(readPendingOnRequestDrafts())
    sync()
    return subscribePendingOnRequestDrafts(sync)
  }, [])

  // Poll every 30s + on canvas refresh, but only while this tab is the active,
  // visible one — no background polling when the agent is on the Inbox tab or
  // the sidebar is collapsed.
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    tick()
    queueMicrotask(() => void load())
    // Each poll reconciles against live Intercom (server-side), so keep it a
    // touch lighter than the inbox list. The same tick advances `now` so stuck
    // placeholders flip to their failed card within one poll.
    const id = setInterval(() => {
      tick()
      void load()
    }, 15_000)
    const off = onCanvasRefresh(() => void load())
    return () => {
      clearInterval(id)
      off()
    }
  }, [active, load])

  const remove = useCallback((id: string) => {
    setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev))
    setOnRequest((prev) => prev.filter((i) => i.id !== id))
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  // Re-kick generation for a placeholder whose draft never landed. Resets the
  // placeholder timer so it shows "Drafting…" again while the retry runs; the
  // generate endpoint's upsert makes a repeat harmless if the first attempt was
  // merely slow rather than failed.
  const retryManual = useCallback(async (item: PendingOnRequestDraft) => {
    try {
      const res = await fetch("/api/reply-queue/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: [item.conversationId] }),
      })
      if (!res.ok) throw new Error(await readApiError(res, `Failed (${res.status})`))
      addPendingOnRequestDrafts([
        {
          conversationId: item.conversationId,
          customerName: item.customerName,
          subject: item.subject,
        },
      ])
      toast.success("Retrying — the draft will appear here shortly.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't restart generation.")
    }
  }, [])

  const dismissManual = useCallback((conversationId: string) => {
    removePendingOnRequestDrafts([conversationId])
  }, [])

  // Re-kick generation for an autonomous placeholder that's been stuck past
  // AUTONOMOUS_STUCK_AFTER_MS — the backfill loop kept retrying every poll and
  // silently failing (commonly a transient Verboo error/rate-limit). Un-dismiss
  // it too, in case the agent had previously hidden it.
  const retryAutonomous = useCallback(async (item: DraftingItem) => {
    try {
      const res = await fetch("/api/reply-queue/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: [item.conversationId] }),
      })
      if (!res.ok) throw new Error(await readApiError(res, `Failed (${res.status})`))
      setDismissedAutonomous((prev) => {
        if (!prev.has(item.conversationId)) return prev
        const next = new Set(prev)
        next.delete(item.conversationId)
        return next
      })
      // Flip the card back to "Drafting…" immediately AND restart the drafting
      // clock, so it can't fall back to "stuck" while the retried generation is
      // still legitimately running (the grace window is shorter than the stuck
      // threshold, so without this the card falsely re-fails mid-retry).
      const stamp = Date.now()
      setRetriedAutonomous((prev) => ({ ...prev, [item.conversationId]: stamp }))
      setDraftingSince((prev) => ({ ...prev, [item.conversationId]: stamp }))
      toast.success("Retrying — the draft will appear here shortly.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't restart generation.")
    }
  }, [])

  const dismissAutonomous = useCallback((conversationId: string) => {
    setDismissedAutonomous((prev) => new Set(prev).add(conversationId))
  }, [])

  const ready = useMemo(
    () => items?.filter((i) => i.riskBand !== "needs_check").sort(byOldest) ?? [],
    [items]
  )
  const needsCheck = items?.filter((i) => i.riskBand === "needs_check").sort(byOldest) ?? []
  const onRequestSorted = [...onRequest].sort(byOldest)
  const visibleIds = new Set([
    ...drafting.map((item) => item.conversationId),
    ...(items ?? []).map((item) => item.intercomConversationId),
    ...onRequest.map((item) => item.intercomConversationId),
  ])
  // Manual (on-request) placeholders not yet resolved into a real row. Split by
  // age: fresh ones still show the animated "Drafting…" card; ones past
  // STUCK_AFTER_MS are treated as failed (generation almost certainly errored —
  // e.g. a 429 that outlasted retries) and get a Retry / Dismiss card instead of
  // hanging silently until the 20-min TTL. `now` is ticked by the poll effect
  // (never Date.now() during render), so a card flips within one poll.
  const manualUnresolved = manualDrafting.filter((item) => !visibleIds.has(item.conversationId))
  const manualStuck = manualUnresolved.filter((item) => isStuck(item, now))
  const manualFresh = manualUnresolved.filter((item) => !isStuck(item, now))
  // Same idea for the AUTONOMOUS backfill placeholders (a non-read conversation
  // with no draft yet, not agent-requested): the backfill loop silently retries
  // every ~5 min, so one still stuck past AUTONOMOUS_STUCK_AFTER_MS is very
  // likely failing outright, not just slow. Surface it the same way rather than
  // spinning forever with no way for the agent to intervene.
  // A card the agent just retried is treated as freshly drafting for the grace
  // window — visible feedback while the recompute runs, instead of staying red.
  const isRetrying = (conversationId: string) => {
    const at = retriedAutonomous[conversationId]
    return at != null && now - at < AUTONOMOUS_RETRY_GRACE_MS
  }
  const autonomousStuck = drafting.filter(
    (item) =>
      isAutonomousDraftingStuck(draftingSince[item.conversationId], now) &&
      !isRetrying(item.conversationId) &&
      !dismissedAutonomous.has(item.conversationId)
  )
  const autonomousFresh = drafting.filter(
    (item) =>
      !isAutonomousDraftingStuck(draftingSince[item.conversationId], now) ||
      isRetrying(item.conversationId)
  )
  const draftingVisible: DraftingItem[] = [
    ...autonomousFresh,
    ...manualFresh.map((item) => ({
      conversationId: item.conversationId,
      customerName: item.customerName,
      subject: item.subject,
      waitingSince: null,
    })),
  ]
  const stuckCount = manualStuck.length + autonomousStuck.length
  const total = (items?.length ?? 0) + draftingVisible.length + stuckCount + onRequest.length

  // Retry every stuck card at once (autonomous + manual) in a single generate
  // call. Mirrors the per-card retries: re-kick generation, reset the autonomous
  // grace timer, un-dismiss, and reset the manual placeholder timers.
  const retryAll = async () => {
    const autoIds = autonomousStuck.map((i) => i.conversationId)
    const manualItems = manualStuck
    const allIds = [...autoIds, ...manualItems.map((i) => i.conversationId)]
    if (allIds.length === 0) return
    try {
      const res = await fetch("/api/reply-queue/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: allIds }),
      })
      if (!res.ok) throw new Error(await readApiError(res, `Failed (${res.status})`))
      const stamp = Date.now()
      setRetriedAutonomous((prev) => {
        const next = { ...prev }
        for (const id of autoIds) next[id] = stamp
        return next
      })
      // Restart the drafting clock too (see retryAutonomous) so retried cards
      // don't falsely re-fail while regeneration is still in flight.
      setDraftingSince((prev) => {
        const next = { ...prev }
        for (const id of autoIds) next[id] = stamp
        return next
      })
      setDismissedAutonomous((prev) => {
        if (autoIds.every((id) => !prev.has(id))) return prev
        const next = new Set(prev)
        for (const id of autoIds) next.delete(id)
        return next
      })
      if (manualItems.length > 0) {
        addPendingOnRequestDrafts(
          manualItems.map((i) => ({
            conversationId: i.conversationId,
            customerName: i.customerName,
            subject: i.subject,
          }))
        )
      }
      toast.success(`Retrying ${allIds.length} draft${allIds.length > 1 ? "s" : ""}…`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't restart generation.")
    }
  }

  useEffect(() => {
    onCount?.((items?.length ?? 0) + draftingVisible.length + stuckCount + onRequest.length)
  }, [items, draftingVisible.length, stuckCount, onRequest.length, onCount])

  const allReadySelected = ready.length > 0 && selectedIds.size === ready.length
  const someReadySelected = selectedIds.size > 0 && !allReadySelected
  // Native checkbox indeterminate can only be set imperatively, in an effect.
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someReadySelected
  }, [someReadySelected])

  // Toggle one ready row, or — when shift is held and we have an anchor —
  // select the whole contiguous range from the anchor to here (Gmail/Finder
  // behaviour). The anchor only moves on a plain (non-shift) click.
  const toggleReadyAt = useCallback(
    (index: number, shift: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        const anchorIdx = anchorRef.current
          ? ready.findIndex((r) => r.id === anchorRef.current)
          : -1
        if (shift && anchorIdx >= 0) {
          const lo = Math.min(anchorIdx, index)
          const hi = Math.max(anchorIdx, index)
          for (let i = lo; i <= hi; i++) {
            const id = ready[i]?.id
            if (id) next.add(id)
          }
        } else {
          const id = ready[index]?.id
          if (id) {
            if (next.has(id)) next.delete(id)
            else next.add(id)
          }
          anchorRef.current = ready[index]?.id ?? null
        }
        return next
      })
    },
    [ready]
  )

  const toggleAllReady = useCallback(() => {
    anchorRef.current = null
    setSelectedIds((prev) =>
      prev.size === ready.length ? new Set() : new Set(ready.map((r) => r.id))
    )
  }, [ready])

  const clearBulkSelection = useCallback(() => {
    setSelectedIds(new Set())
    setConfirmBulkSend(false)
    anchorRef.current = null
  }, [])

  // Bulk: approve & send every selected ready suggestion, in order (real
  // Intercom writes — kept sequential, not Promise.all). Sent items are removed
  // immediately via `remove`; failures stay selected so the agent can retry or
  // open the case. Guarded by an inline confirm (irreversible outbound sends).
  const bulkApproveSend = async () => {
    const targets = ready.filter((i) => selectedIds.has(i.id))
    if (targets.length === 0) return
    setBulkActing(true)
    let sent = 0
    let failed = 0
    let resolveFailed = false
    for (const item of targets) {
      const result = await postSendAndResolve(item, item.body)
      if (result.ok) {
        sent++
        if (!result.resolvedOk) resolveFailed = true
        remove(item.id)
      } else {
        failed++
      }
    }
    setConfirmBulkSend(false)
    setBulkActing(false)
    if (sent > 0) toast.success(`Sent ${sent}`)
    if (failed > 0) toast.warning(`${failed} couldn't send`)
    // Some sends went out but the queue-clearing resolve failed — reconcile.
    if (resolveFailed) void load()
  }

  // Bulk: dismiss every selected ready suggestion. Sequential for the same
  // reason as above — each is a real resolve write.
  const bulkReject = async () => {
    const targets = ready.filter((i) => selectedIds.has(i.id))
    if (targets.length === 0) return
    setBulkActing(true)
    let dismissed = 0
    let failed = 0
    for (const item of targets) {
      const result = await postReject(item)
      if (result.ok) {
        dismissed++
        remove(item.id)
      } else {
        failed++
      }
    }
    setBulkActing(false)
    if (dismissed > 0) toast.success(`Dismissed ${dismissed}`)
    if (failed > 0) toast.warning(`${failed} couldn't be dismissed`)
  }

  // ── "On request" band selection + bulk send/cancel (mirrors the ready band) ──
  const toggleOnReqAt = (index: number, shift: boolean) => {
    setSelectedOnReq((prev) => {
      const next = new Set(prev)
      const anchorIdx = onReqAnchorRef.current
        ? onRequestSorted.findIndex((r) => r.id === onReqAnchorRef.current)
        : -1
      if (shift && anchorIdx >= 0) {
        const lo = Math.min(anchorIdx, index)
        const hi = Math.max(anchorIdx, index)
        for (let i = lo; i <= hi; i++) {
          const id = onRequestSorted[i]?.id
          if (id) next.add(id)
        }
      } else {
        const id = onRequestSorted[index]?.id
        if (id) {
          if (next.has(id)) next.delete(id)
          else next.add(id)
        }
        onReqAnchorRef.current = onRequestSorted[index]?.id ?? null
      }
      return next
    })
  }

  const toggleAllOnReq = () => {
    onReqAnchorRef.current = null
    setSelectedOnReq((prev) =>
      prev.size === onRequestSorted.length
        ? new Set()
        : new Set(onRequestSorted.map((r) => r.id))
    )
  }

  const clearOnReqSelection = () => {
    setSelectedOnReq(new Set())
    setConfirmOnReqSend(false)
    onReqAnchorRef.current = null
  }

  const bulkSendOnReq = async () => {
    const targets = onRequestSorted.filter((i) => selectedOnReq.has(i.id))
    if (targets.length === 0) return
    setOnReqActing(true)
    let sent = 0
    let failed = 0
    let resolveFailed = false
    for (const item of targets) {
      const result = await postSendAndResolve(item, item.body)
      if (result.ok) {
        sent++
        if (!result.resolvedOk) resolveFailed = true
        remove(item.id)
      } else {
        failed++
      }
    }
    setConfirmOnReqSend(false)
    setOnReqActing(false)
    if (sent > 0) toast.success(`Sent ${sent}`)
    if (failed > 0) toast.warning(`${failed} couldn't send`)
    if (resolveFailed) void load()
  }

  const bulkCancelOnReq = async () => {
    const targets = onRequestSorted.filter((i) => selectedOnReq.has(i.id))
    if (targets.length === 0) return
    setOnReqActing(true)
    let dismissed = 0
    let failed = 0
    for (const item of targets) {
      const result = await postReject(item)
      if (result.ok) {
        dismissed++
        remove(item.id)
      } else {
        failed++
      }
    }
    setOnReqActing(false)
    if (dismissed > 0) toast.success(`Dismissed ${dismissed}`)
    if (failed > 0) toast.warning(`${failed} couldn't be dismissed`)
  }

  const allOnReqSelected =
    onRequestSorted.length > 0 && selectedOnReq.size === onRequestSorted.length
  const someOnReqSelected = selectedOnReq.size > 0 && !allOnReqSelected
  useEffect(() => {
    if (onReqMasterRef.current) onReqMasterRef.current.indeterminate = someOnReqSelected
  }, [someOnReqSelected])

  // Ctrl/Cmd+A toggles select-all (ready band); Ctrl/Cmd+Enter arms the
  // "Approve & send" confirm, then a second press sends — a send is an
  // irreversible outbound message, so it still takes the two-step confirm.
  useCanvasListHotkeys({
    active,
    onSelectAll: toggleAllReady,
    onPrimary: () => {
      if (selectedIds.size === 0 || bulkActing) return
      if (confirmBulkSend) void bulkApproveSend()
      else setConfirmBulkSend(true)
    },
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {items === null && <QueueSkeleton />}
        {items !== null && total === 0 && <EmptyState error={error} />}
        {items !== null && total > 0 && (
          <div className="flex flex-col gap-4 p-2">
            {error && <p className="px-1 text-xs text-destructive">{error}</p>}
            {draftingVisible.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <SparklesIcon className="size-3 text-primary" />
                  <h2 className="text-xs font-medium">Drafting</h2>
                  <Badge
                    variant="secondary"
                    className="h-4 px-1 text-[10px] font-normal tabular-nums"
                  >
                    {draftingVisible.length}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1.5">
                  {draftingVisible.map((d) => (
                    <DraftingCard key={d.conversationId} item={d} />
                  ))}
                </div>
              </section>
            )}
            {stuckCount > 0 && (
              <section className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <AlertTriangleIcon className="size-3 text-destructive" />
                  <h2 className="text-xs font-medium">Couldn&apos;t draft</h2>
                  <Badge
                    variant="secondary"
                    className="h-4 px-1 text-[10px] font-normal tabular-nums"
                  >
                    {stuckCount}
                  </Badge>
                  {stuckCount > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto h-6 gap-1 px-2 text-[11px]"
                      onClick={() => void retryAll()}
                    >
                      <RotateCwIcon className="size-3" />
                      Retry all
                    </Button>
                  )}
                </div>
                <p className="px-1 text-[11px] leading-snug text-muted-foreground">
                  Generation didn&apos;t finish (often a temporary rate-limit hiccup). Retry, or
                  dismiss and open the case directly.
                </p>
                <div className="flex flex-col gap-1.5">
                  {manualStuck.map((item) => (
                    <FailedDraftCard
                      key={item.conversationId}
                      item={item}
                      onRetry={() => retryManual(item)}
                      onDismiss={() => dismissManual(item.conversationId)}
                    />
                  ))}
                  {autonomousStuck.map((item) => (
                    <FailedDraftCard
                      key={item.conversationId}
                      item={item}
                      onRetry={() => retryAutonomous(item)}
                      onDismiss={() => dismissAutonomous(item.conversationId)}
                    />
                  ))}
                </div>
              </section>
            )}
            {ready.length > 0 && (
              <Band
                title="Ready to send"
                hint="One click sends it. Oldest first."
                count={ready.length}
                headerAccessory={
                  <input
                    ref={masterRef}
                    type="checkbox"
                    checked={allReadySelected}
                    onChange={toggleAllReady}
                    aria-label="Select all ready to send"
                    title="Select all (Ctrl+A) · Ctrl+Enter to approve & send"
                    className="size-3.5 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary"
                  />
                }
              >
                {ready.map((i, index) => (
                  <QueueRow
                    key={i.intercomConversationId}
                    item={i}
                    onDone={remove}
                    onRefresh={load}
                    selectable
                    selected={selectedIds.has(i.id)}
                    onToggleSelect={(shift) => toggleReadyAt(index, shift)}
                  />
                ))}
              </Band>
            )}
            {needsCheck.length > 0 && (
              <Band
                title="Needs your check"
                hint="Verify in fadmin before sending — the send is locked."
                count={needsCheck.length}
              >
                {needsCheck.map((i) => (
                  <QueueRow key={i.intercomConversationId} item={i} onDone={remove} onRefresh={load} />
                ))}
              </Band>
            )}
            {onRequestSorted.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <SparklesIcon className="size-3 text-primary" />
                  <h2 className="text-xs font-medium">On request</h2>
                  <Badge
                    variant="secondary"
                    className="h-4 px-1 text-[10px] font-normal tabular-nums"
                  >
                    {onRequestSorted.length}
                  </Badge>
                  <input
                    ref={onReqMasterRef}
                    type="checkbox"
                    checked={allOnReqSelected}
                    onChange={toggleAllOnReq}
                    aria-label="Select all on-request drafts"
                    title="Select all on request"
                    className="ml-auto size-3.5 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary"
                  />
                </div>
                <p className="px-1 text-[11px] leading-snug text-muted-foreground">
                  Drafts you generated from the Inbox — including tickets you&apos;ve already
                  replied to. Send or dismiss right here.
                </p>
                {selectedOnReq.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-2 py-2">
                    <span className="text-xs font-medium tabular-nums">
                      {selectedOnReq.size} selected
                    </span>
                    <button
                      type="button"
                      onClick={clearOnReqSelection}
                      className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Clear
                    </button>
                    {confirmOnReqSend ? (
                      <div className="ml-auto flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">
                          Approve &amp; send {selectedOnReq.size}?
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px]"
                          onClick={() => setConfirmOnReqSend(false)}
                          disabled={onReqActing}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 gap-1.5 px-2.5 text-[11px]"
                          onClick={() => void bulkSendOnReq()}
                          disabled={onReqActing}
                        >
                          {onReqActing ? (
                            <Loader2Icon className="size-3.5 animate-spin" />
                          ) : (
                            <SendIcon className="size-3.5" />
                          )}
                          Confirm
                        </Button>
                      </div>
                    ) : (
                      <div className="ml-auto flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 px-2.5 text-[11px]"
                          onClick={() => void bulkCancelOnReq()}
                          disabled={onReqActing}
                        >
                          {onReqActing ? (
                            <Loader2Icon className="size-3.5 animate-spin" />
                          ) : (
                            <XIcon className="size-3.5" />
                          )}
                          Cancel {selectedOnReq.size}
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 gap-1.5 px-2.5 text-[11px]"
                          onClick={() => setConfirmOnReqSend(true)}
                          disabled={onReqActing}
                          title="Send is an irreversible outbound message to the customer"
                        >
                          <SendIcon className="size-3.5" />
                          Approve &amp; send {selectedOnReq.size}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  {onRequestSorted.map((i, index) => (
                    <QueueRow
                      key={i.intercomConversationId}
                      item={i}
                      onDone={remove}
                      onRefresh={load}
                      selectable
                      selected={selectedOnReq.has(i.id)}
                      onToggleSelect={(shift) => toggleOnReqAt(index, shift)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Bulk actions for the "Ready to send" band only. Tip: shift-click a
          second checkbox to select the whole range between it and the last one. */}
      {selectedIds.size > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-muted/40 px-2 py-2">
          <span className="text-xs font-medium tabular-nums">{selectedIds.size} selected</span>
          <button
            type="button"
            onClick={clearBulkSelection}
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear
          </button>
          {confirmBulkSend ? (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">
                Approve &amp; send {selectedIds.size}?
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-[11px]"
                onClick={() => setConfirmBulkSend(false)}
                disabled={bulkActing}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-[11px]"
                onClick={() => void bulkApproveSend()}
                disabled={bulkActing}
              >
                {bulkActing ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <SendIcon className="size-3.5" />
                )}
                Confirm
              </Button>
            </div>
          ) : (
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2.5 text-[11px]"
                onClick={() => void bulkReject()}
                disabled={bulkActing}
              >
                {bulkActing ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <XIcon className="size-3.5" />
                )}
                Reject {selectedIds.size}
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-[11px]"
                onClick={() => setConfirmBulkSend(true)}
                disabled={bulkActing}
                title="Send is an irreversible outbound message to the customer"
              >
                <SendIcon className="size-3.5" />
                Approve &amp; send {selectedIds.size}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Placeholder card shown while the AI is generating a draft for a non-read
// conversation — an animated sparkle, who it's for, a typing-dots ellipsis, and
// shimmering skeleton lines. Replaced by the real QueueRow on the next poll.
function DraftingCard({ item }: { item: DraftingItem }) {
  return (
    <article className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center gap-2 px-2.5 pt-2">
        <SparklesIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
        <span className="truncate text-xs font-medium text-muted-foreground">
          Drafting a reply for{" "}
          <span className="text-foreground">{item.customerName ?? "the customer"}</span>
        </span>
        <TypingDots />
      </div>
      {item.subject && (
        <p className="truncate px-2.5 pt-0.5 text-[11px] text-muted-foreground/70">
          {item.subject}
        </p>
      )}
      <div className="flex flex-col gap-1.5 px-2.5 pb-2.5 pt-2">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-11/12" />
        <Skeleton className="h-2.5 w-2/3" />
      </div>
    </article>
  )
}

// Shown when a manual on-request draft never resolved into a real row within
// STUCK_AFTER_MS — generation errored (commonly a 429 that outlasted retries).
// Replaces the silent "Drafting…" hang with an explicit Retry / Dismiss.
function FailedDraftCard({
  item,
  onRetry,
  onDismiss,
}: {
  item: { conversationId: string; customerName: string | null; subject: string | null }
  onRetry: () => Promise<void>
  onDismiss: () => void
}) {
  const [busy, setBusy] = useState(false)
  const retry = async () => {
    setBusy(true)
    try {
      await onRetry()
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="overflow-hidden rounded-md border border-destructive/30 bg-card">
      <div className="flex items-center gap-2 px-2.5 pt-2">
        <AlertTriangleIcon className="size-3.5 shrink-0 text-destructive" />
        <span className="truncate text-xs font-medium">
          Couldn&apos;t draft for{" "}
          <span className="text-foreground">{item.customerName ?? "the customer"}</span>
        </span>
      </div>
      {item.subject && (
        <p className="truncate px-2.5 pt-0.5 text-[11px] text-muted-foreground/70">
          {item.subject}
        </p>
      )}
      <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-2">
        <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => void retry()} disabled={busy}>
          {busy ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <RotateCwIcon className="size-3.5" />
          )}
          Retry
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2.5 text-xs text-muted-foreground"
          onClick={() => onDismiss()}
          disabled={busy}
        >
          <XIcon className="size-3.5" />
          Dismiss
        </Button>
      </div>
    </article>
  )
}

// Three softly-staggered pulsing dots — a lightweight "…thinking" affordance.
function TypingDots() {
  return (
    <span className="ml-auto inline-flex shrink-0 gap-0.5 text-primary" aria-hidden>
      <span className="animate-pulse">•</span>
      <span className="animate-pulse [animation-delay:200ms]">•</span>
      <span className="animate-pulse [animation-delay:400ms]">•</span>
    </span>
  )
}

function Band({
  title,
  hint,
  count,
  headerAccessory,
  children,
}: {
  title: string
  hint: string
  count: number
  headerAccessory?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-xs font-medium">{title}</h2>
        <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal tabular-nums">
          {count}
        </Badge>
        {headerAccessory && <div className="ml-auto flex items-center">{headerAccessory}</div>}
      </div>
      <p className="px-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

// A compact row by default: customer + waited time + 1-line subject. Clicking
// the header expands it inline to reveal the suggested body, the "Why" popover,
// inline quick-edit, and the approve actions.
function QueueRow({
  item,
  onDone,
  onRefresh,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  item: QueueItem
  onDone: (id: string) => void
  onRefresh: () => Promise<void>
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (shift: boolean) => void
}) {
  const nav = useCanvasNav()
  const locked = item.riskBand === "needs_check"
  const unassigned = item.ownerId === null
  const caseHref = `/cases/${item.intercomConversationId}/canvas`
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState(item.body)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  // Switch tabs client-side inside the workspace; navigate otherwise.
  const openCase = () => {
    if (nav) nav.open(item.intercomConversationId)
  }

  const send = async () => {
    if (sending) return
    setSending(true)
    const result = await postSendAndResolve(item, body)
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't send. Open the case and try there.")
      setSending(false)
      setConfirming(false)
      return
    }
    toast.success(`Sent to ${item.customerName ?? "the customer"}`)
    onDone(item.id)
    if (!result.resolvedOk) {
      toast.warning("Sent to Intercom, but couldn't clear the queue yet. Refreshing.")
      void onRefresh()
    }
  }

  const onApprove = () => {
    if (locked && !confirming) {
      setConfirming(true)
      return
    }
    void send()
  }

  const assignToMe = async () => {
    setAssigning(true)
    try {
      const res = await fetch("/api/reply-queue/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: item.intercomConversationId }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Assigned to you. Regenerating with your Notion context.")
      await onRefresh()
    } catch {
      toast.error("Couldn't assign this case.")
    } finally {
      setAssigning(false)
    }
  }

  const reject = async () => {
    setRejecting(true)
    const result = await postReject(item)
    if (result.ok) {
      toast.success("Suggestion dismissed")
      onDone(item.id)
    } else {
      toast.error("Couldn't dismiss this suggestion.")
      setRejecting(false)
    }
  }

  const citable = item.sources.filter((s) => s.url)

  return (
    <article
      className={cn(
        "rounded-md border bg-card transition-colors hover:border-foreground/20",
        selected && "border-foreground/30 bg-accent/40"
      )}
    >
      <div className="flex items-start gap-2 px-2.5 py-2">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => {}}
            // onClick (not onChange) carries shiftKey — needed for range selection.
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect?.(e.shiftKey)
            }}
            aria-label={`Select suggestion for ${item.customerName ?? "customer"}`}
            className="mt-0.5 size-3.5 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary"
          />
        )}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="truncate text-xs font-medium">
              {item.customerName ?? "Customer"}
            </span>
            {item.riskBand === "low_confidence" && (
              <Badge
                variant="outline"
                className="h-4 px-1 text-[10px] font-normal text-muted-foreground"
              >
                review carefully
              </Badge>
            )}
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {relativeTime(item.createdAt)}
            </span>
          </span>
          {item.subject && (
            <span className="truncate text-[11px] text-muted-foreground">{item.subject}</span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="border-t px-2.5 py-2.5">
          {editing ? (
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl/Cmd+Enter = Approve & send (same as clicking the button,
                // including the needs_check confirm step). Plain Enter/Shift+Enter
                // keep their normal newline behavior in the textarea.
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault()
                  if (!sending && !rejecting) onApprove()
                }
              }}
              className="min-h-32 text-xs leading-relaxed"
              autoFocus
            />
          ) : (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
              {body}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                  <InfoIcon className="size-3.5" />
                  Why
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 text-xs leading-relaxed">
                <p className="text-foreground/90">{item.justification}</p>
                {citable.length > 0 && (
                  <div className="mt-2 border-t pt-2">
                    <p className="mb-1 font-medium text-muted-foreground">Sources</p>
                    <ul className="flex flex-col gap-1">
                      {citable.map((s, idx) => (
                        <li key={idx}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-foreground/80 underline-offset-2 hover:underline"
                          >
                            <ExternalLinkIcon className="size-3 shrink-0" />
                            <span className="truncate">{s.title ?? s.url}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {nav ? (
              <button
                type="button"
                onClick={openCase}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLinkIcon className="size-3.5" />
                Open case
              </button>
            ) : (
              <Link
                href={caseHref}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLinkIcon className="size-3.5" />
                Open case
              </Link>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-[11px] text-muted-foreground"
              onClick={() => setEditing((e) => !e)}
            >
              <PencilIcon className="size-3.5" />
              {editing ? "Done" : "Edit"}
            </Button>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            {unassigned ? (
              <Button
                size="sm"
                className="ml-auto h-7 px-2.5 text-xs"
                onClick={() => void assignToMe()}
                disabled={assigning}
              >
                {assigning ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <UserPlusIcon className="size-3.5" />
                )}
                Assign to me
              </Button>
            ) : confirming ? (
              <>
                <span className="text-[11px] text-muted-foreground">Are you sure?</span>
                <Button
                  size="sm"
                  className="ml-auto h-7 px-2.5 text-xs"
                  onClick={() => void send()}
                  disabled={sending}
                >
                  {sending && <Loader2Icon className="size-3.5 animate-spin" />}
                  Yes
                </Button>
                {nav ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    onClick={openCase}
                  >
                    No, I need to manually check
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" asChild>
                    <Link href={caseHref}>No, I need to manually check</Link>
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 px-2.5 text-xs text-muted-foreground"
                  onClick={() => void reject()}
                  disabled={sending || rejecting}
                >
                  {rejecting && <Loader2Icon className="size-3.5 animate-spin" />}
                  Reject
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={onApprove}
                  disabled={sending || rejecting}
                >
                  {sending && <Loader2Icon className="size-3.5 animate-spin" />}
                  Approve &amp; send
                </Button>
              </>
            )}
          </div>

          {unassigned && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <UserPlusIcon className="size-3.5 shrink-0" />
              Assigning is a human-gated Intercom write, then the draft refreshes with your Notion access.
            </p>
          )}
          {locked && !confirming && !unassigned && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldAlertIcon className="size-3.5 shrink-0" />
              Verify payout / KYC / media in fadmin before sending.
            </p>
          )}
        </div>
      )}
    </article>
  )
}

function RowSkeleton() {
  return (
    <div className="rounded-md border bg-card px-2.5 py-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="ml-auto h-2.5 w-8" />
      </div>
      <Skeleton className="mt-1.5 h-2.5 w-5/6" />
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      <Skeleton className="mb-1 h-3 w-28" />
      <RowSkeleton />
      <RowSkeleton />
      <RowSkeleton />
    </div>
  )
}

function EmptyState({ error }: { error: string | null }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
      <div
        className={
          error
            ? "flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"
            : "flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
        }
      >
        <InboxIcon className="size-5" />
      </div>
      <p className="text-xs font-medium">
        {error ? "Couldn't load the reply queue." : "You're all caught up"}
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {error
          ? "Retrying every 30 seconds. Open a case directly if you need it now."
          : "Suggestions for conversations assigned to you show up here as the AI drafts them — usually within a few seconds."}
      </p>
    </div>
  )
}
