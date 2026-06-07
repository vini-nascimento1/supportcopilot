"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import type { CalRange } from "@/lib/gcal"

const RANGE_OPTIONS: { value: CalRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
]

function RangeTabs({ current }: { current: CalRange }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function navigate(range: CalRange) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("cal", range)
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="flex gap-1 pt-1">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => navigate(opt.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            current === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function CalendarRangeTabs({ current }: { current: CalRange }) {
  return (
    <Suspense
      fallback={
        <div className="flex gap-1 pt-1">
          {RANGE_OPTIONS.map((opt) => (
            <span
              key={opt.value}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                current === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {opt.label}
            </span>
          ))}
        </div>
      }
    >
      <RangeTabs current={current} />
    </Suspense>
  )
}
