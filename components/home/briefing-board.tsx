"use client"

import { useCallback, useState } from "react"

import { AttentionList } from "@/components/home/attention-list"
import { BriefingHero, type HeroTarget } from "@/components/home/briefing-hero"
import { SectionHeader } from "@/components/home/section-header"
import { SourceEmptyState } from "@/components/home/source-empty-state"
import { isNeedsYouNow, type AttentionItem, type Briefing } from "@/lib/briefing/types"

// Hero + "Needs you now" share one piece of state (which row is open), so they
// live in the same client component: a hero tile jumps to and expands the first
// matching item.

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
  const items = needsYouNow(briefing)
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null)

  const onToggle = useCallback((id: string) => {
    setOpenId((prev) => (prev === id ? null : id))
  }, [])

  const onJump = useCallback(
    (target: HeroTarget) => {
      const match = items.find((i) => matchesTarget(i, target))
      if (!match) return
      setOpenId(match.id)
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-home-item="${CSS.escape(match.id)}"]`)
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" })
      })
    },
    [items],
  )

  const { drafted, researched, locked } = briefing.counts
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
      <BriefingHero briefing={briefing} onJump={onJump} />

      <section>
        <SectionHeader
          title="Needs you now"
          count={items.length}
          detail={detail || undefined}
        />
        <AttentionList
          items={items}
          openId={openId}
          onToggle={onToggle}
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
