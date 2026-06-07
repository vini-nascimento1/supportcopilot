"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { GMAIL_FILTERS, type GmailFilterKey } from "@/lib/gmail-filters"

const STORAGE_KEY = "gmail-filter"

export function GmailFilterBar() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlFilter = searchParams.get("filter")
  const [active, setActive] = useState<GmailFilterKey>(
    () => (urlFilter as GmailFilterKey) || "primary"
  )

  // Sync localStorage → state on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as GmailFilterKey | null
    const initial = urlFilter && urlFilter in GMAIL_FILTERS
      ? (urlFilter as GmailFilterKey)
      : stored && stored in GMAIL_FILTERS
        ? stored
        : "primary"
    setActive(initial)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function select(key: GmailFilterKey) {
    setActive(key)
    localStorage.setItem(STORAGE_KEY, key)
    router.push(`/gmail?filter=${key}`)
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto px-4 py-2 lg:px-6">
      {(Object.keys(GMAIL_FILTERS) as GmailFilterKey[]).map((key) => (
        <button
          key={key}
          onClick={() => select(key)}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            active === key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/20 bg-background text-muted-foreground hover:bg-muted"
          }`}
        >
          {GMAIL_FILTERS[key].label}
        </button>
      ))}
    </div>
  )
}
