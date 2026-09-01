"use client"

import type { Briefing } from "@/lib/briefing/types"

export type HeroTarget = "draft" | "answer" | "email"

const SOURCE_LABEL: Record<string, string> = {
  intercom: "Intercom",
  slack: "Slack",
  gmail: "Gmail",
  calendar: "Calendar",
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

type Tile = { target: HeroTarget; k: string; v: string }

function buildTiles(briefing: Briefing): Tile[] {
  const { drafted, researched, locked } = briefing.counts
  const emails = briefing.items.filter((i) => i.kind === "email_action").length
  const ready = Math.max(0, drafted - locked)
  const tiles: Tile[] = []

  if (drafted > 0) {
    tiles.push({
      target: "draft",
      k: `Review ${drafted} ticket ${plural(drafted, "reply", "replies")}`,
      v: locked > 0 ? `${ready} ready to send · ${locked} locked` : `${ready} ready to send`,
    })
  }
  if (researched > 0) {
    tiles.push({
      target: "answer",
      k: `Check ${researched} ${plural(researched, "answer", "answers")}`,
      v: "Researched from Notion, Slack and macros",
    })
  }
  if (emails > 0) {
    tiles.push({
      target: "email",
      k: `Decide on ${emails} ${plural(emails, "email", "emails")}`,
      v: "Nothing drafted · you answer these",
    })
  }
  return tiles
}

export function BriefingHero({
  briefing,
  onJump,
}: {
  briefing: Briefing
  onJump: (target: HeroTarget) => void
}) {
  const tiles = buildTiles(briefing)
  const connected = briefing.sources
    .filter((s) => s.state === "ok")
    .map((s) => SOURCE_LABEL[s.source] ?? s.source)

  return (
    <section className="relative overflow-hidden rounded-xl border border-white/10 bg-neutral-900 px-5 pt-4.5 pb-4 text-neutral-50 dark:bg-neutral-800">
      <p className="mb-2.5 flex items-center gap-2 text-[11.5px] font-semibold text-neutral-50/60">
        <span className="relative flex size-[7px] shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-full rounded-full bg-current" />
        </span>
        Your day, in one read
      </p>

      <p className="mb-3.5 max-w-[56ch] text-[17px] leading-relaxed font-normal tracking-tight text-pretty lg:text-lg">
        {briefing.narrative}
      </p>

      {tiles.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {tiles.map((tile) => (
            <button
              key={tile.target}
              type="button"
              onClick={() => onJump(tile.target)}
              className="flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-md border border-white/10 bg-white/8 px-3 py-2.5 text-left transition-colors hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/40 focus-visible:outline-none"
            >
              <span className="text-[12.5px] leading-tight font-semibold">{tile.k}</span>
              <span className="text-[11px] leading-tight text-neutral-50/60">{tile.v}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap justify-between gap-x-3 gap-y-1.5 text-[11px] text-neutral-50/60">
        <span>{connected.length > 0 ? connected.join(" · ") : "No sources connected"}</span>
        <span className="font-semibold text-neutral-50">Nothing is sent without your tap.</span>
      </div>
    </section>
  )
}
