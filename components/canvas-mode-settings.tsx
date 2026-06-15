"use client"

import { LayersIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { setMultitask, useCanvasMultitask } from "@/lib/use-canvas-multitask"

export function CanvasModeSettings() {
  const on = useCanvasMultitask()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LayersIcon className="size-4 text-muted-foreground" />
          Canvas
        </CardTitle>
        <CardDescription>
          How the canvas behaves when you switch between open tabs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 py-1">
          <div className="min-w-0">
            <p className="text-sm font-medium">Hard multitasking</p>
            <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
              Keep every open canvas live at once. Switching tabs never reloads,
              and each case keeps its AI chat, draft and notes in memory — at the
              cost of using more RAM. When off, each canvas loads fresh every time
              you open it.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Toggle hard multitasking"
            onClick={() => setMultitask(!on)}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
              on ? "bg-primary" : "bg-input",
            )}
          >
            <span
              className={cn(
                "inline-block size-5 transform rounded-full bg-background shadow transition-transform",
                on ? "translate-x-[1.375rem]" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
