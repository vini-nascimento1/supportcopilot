"use client"

import { useState } from "react"
import { CheckIcon } from "lucide-react"
import { parseSteps } from "@/lib/parse-steps"

export { parseSteps }

export function PlaybookChecklist({
  checks,
}: {
  checks: string | null | undefined
}) {
  const steps = parseSteps(checks)
  const [checked, setChecked] = useState<boolean[]>(() => steps.map(() => false))

  function toggle(i: number) {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
  }

  function resetAll() {
    setChecked(steps.map(() => false))
  }

  if (steps.length === 0)
    return <p className="text-sm text-muted-foreground">No checks recorded.</p>

  const doneCount = checked.filter(Boolean).length

  return (
    <div className="flex flex-col gap-1">
      {steps.map((step, i) => (
        <button
          key={i}
          onClick={() => toggle(i)}
          className="flex w-full cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted"
        >
          <span
            className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
              checked[i]
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40"
            }`}
          >
            {checked[i] && <CheckIcon className="size-3" />}
          </span>
          <span
            className={`text-sm leading-snug ${checked[i] ? "text-muted-foreground line-through" : ""}`}
          >
            {step}
          </span>
        </button>
      ))}
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {doneCount}/{steps.length} checked
        </span>
        {doneCount > 0 && (
          <button
            onClick={resetAll}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}
