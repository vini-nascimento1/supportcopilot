"use client"

import { useCallback, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { AttentionList } from "@/components/home/attention-list"
import { BriefingHero, type HeroTarget } from "@/components/home/briefing-hero"
import { SectionHeader } from "@/components/home/section-header"
import { SourceEmptyState } from "@/components/home/source-empty-state"
import { useDismissals } from "@/components/home/use-dismissals"
import { buildFallbackNarrative } from "@/lib/briefing/narrative-fallback"
import { countBriefing, isNeedsYouNow, type AttentionItem, type Briefing } from "@/lib/briefing/types"

// Hero + "Needs you now" share one piece of state (which row is open, and what
// the agent has dismissed this session), so they live in the same client
// component: a hero tile jumps to and expands the first matching item, and a
// dismissal instantly re-counts the tiles and the section header.
//
// The server does the same filtering at read time
// (lib/briefing/build.ts::applyDismissals), so a reload agrees with what the
// agent already saw. The right-hand digests are server-rendered and catch up on
// the next load.

function matchesTarget(item: AttentionItem, target: HeroTarget): boolean {
  if (target === "email") return item.kind === "email_action"
  return item.prepared?.kind === target
}

export function needsYouNow(briefing: Briefing): AttentionItem[] {
  const generatedMs = Date.parse(briefing.generatedAt)
  const nowMs = Number.isNaN(generatedMs) ? 0 : generatedMs
  // Calendar events are always shown in the Today timeline instead, even when
  // the next one is imminent — the timeline marks it as starting soon.
  return briefing.items.filter((i) => i.source !== "calendar" && isNeedsYouNow(i, nowMs))
}

export function BriefingBoard({
  briefing,
  downloadUrl,
}: {
  briefing: Briefing
  downloadUrl?: string
}) {
  const { dismissedIds, dismiss } = useDismissals()
  const rows = useMemo(() => needsYouNow(briefing), [briefing])
  const [openId, setOpenId] = useState<string | null>(rows[0]?.id ?? null)

  const dismissedSet = useMemo(() => new Set(dismissedIds), [dismissedIds])
  const remaining = useMemo(
    () => briefing.items.filter((i) => !dismissedSet.has(i.id)),
    [briefing.items, dismissedSet],
  )
  const visibleRows = useMemo(() => rows.filter((i) => !dismissedSet.has(i.id)), [rows, dismissedSet])

  // Hero numbers are recomputed from what is left, and the narrative falls back
  // to the deterministic sentence the moment it would otherwise describe rows
  // that are no longer on screen. Same rule the server applies.
  const hero = useMemo<Briefing>(() => {
    if (dismissedSet.size === 0) return briefing
    const counts = countBriefing(remaining)
    return {
      ...briefing,
      items: remaining,
      counts,
      narrative: buildFallbackNarrative(remaining, counts),
      narrativeSource: "fallback",
    }
  }, [briefing, dismissedSet, remaining])

  const onToggle = useCallback((id: string) => {
    setOpenId((prev) => (prev === id ? null : id))
  }, [])

  // An explicit "not for me": the X button or a left swipe on a phone.
  const onDismiss = useCallback((id: string) => dismiss([id], "Dismissed"), [dismiss])

  // Acting on an item is reading it: a sent or rejected draft, a Slack answer
  // sent, or a deep link opened at the source.
  const onHandled = useCallback((id: string) => dismiss([id], "Cleared from Home"), [dismiss])

  const onClearAll = useCallback(() => {
    const ids = visibleRows.map((i) => i.id)
    if (ids.length === 0) return
    dismiss(ids, `Cleared ${ids.length} item${ids.length === 1 ? "" : "s"}`)
  }, [dismiss, visibleRows])

  const onJump = useCallback(
    (target: HeroTarget) => {
      const match = visibleRows.find((i) => matchesTarget(i, target))
      if (!match) return
      setOpenId(match.id)
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-home-item="${CSS.escape(match.id)}"]`)
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" })
      })
    },
    [visibleRows],
  )

  const { drafted, researched, locked } = hero.counts
  const detail = [
    drafted > 0 ? `${drafted} drafted` : null,
    researched > 0 ? `${researched} researched` : null,
    locked > 0 ? `${locked} locked` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  const intercom = briefing.sources.find((s) => s.source === "intercom")

  return (
    <>
      <BriefingHero briefing={hero} onJump={onJump} />

      <section>
        <SectionHeader
          title="Needs you now"
          count={visibleRows.length}
          detail={detail || undefined}
          action={
            visibleRows.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="-my-1 h-6 px-2 text-[11.5px] text-muted-foreground"
                onClick={onClearAll}
              >
                Clear all
              </Button>
            ) : undefined
          }
        />
        <AttentionList
          items={rows}
          dismissedIds={dismissedIds}
          openId={openId}
          onToggle={onToggle}
          onDismiss={onDismiss}
          onHandled={onHandled}
          downloadUrl={downloadUrl}
          empty={
            <SourceEmptyState
              status={intercom ?? { source: "intercom", state: "ok", count: 0 }}
              okMessage="Nothing needs you right now. Enjoy it."
            />
          }
        />
      </section>
    </>
  )
}
