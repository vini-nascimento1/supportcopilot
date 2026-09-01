import { Skeleton } from "@/components/ui/skeleton"

// Per-section placeholders shown while the briefing is being built (Suspense
// fallback in app/page.tsx). Shapes mirror the real sections so the layout
// doesn't jump when the data lands.

function CardRows({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 border-b px-3.5 py-2.5 last:border-b-0">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="mt-1.5 h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function HeroSkeleton() {
  return (
    <div className="rounded-xl border bg-card px-5 pt-4.5 pb-4">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-11/12" />
      <Skeleton className="mt-2 h-4 w-2/3" />
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Skeleton className="h-13 rounded-md" />
        <Skeleton className="h-13 rounded-md" />
        <Skeleton className="h-13 rounded-md" />
      </div>
    </div>
  )
}

export function AttentionListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card py-3 pr-3 pl-3.5">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="mt-2 h-3.5 w-1/2" />
          <Skeleton className="mt-1.5 h-3 w-4/5" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
      ))}
    </div>
  )
}

export function SectionHeaderSkeleton() {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="h-3 w-24" />
    </div>
  )
}

/** Left column: hero + "Needs you now". */
export function BriefingBoardSkeleton() {
  return (
    <>
      <HeroSkeleton />
      <section>
        <SectionHeaderSkeleton />
        <AttentionListSkeleton />
      </section>
    </>
  )
}

/** Right column: today, Slack, email. */
export function DigestsSkeleton() {
  return (
    <>
      <section>
        <SectionHeaderSkeleton />
        <CardRows rows={3} />
      </section>
      <section>
        <SectionHeaderSkeleton />
        <CardRows rows={3} />
      </section>
      <section>
        <SectionHeaderSkeleton />
        <CardRows rows={3} />
      </section>
    </>
  )
}

export function StatusBadgeSkeleton() {
  return <Skeleton className="h-5 w-12 rounded-4xl" />
}
