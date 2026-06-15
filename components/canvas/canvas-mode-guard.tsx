"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { readMultitask } from "@/lib/use-canvas-multitask"

// Sits on the route-per-canvas pages. When the user has turned on hard
// multitasking, send them to the keep-alive workspace instead so the canvas
// they open joins the live set rather than replacing it. No-op when the
// toggle is off, so the default experience is untouched.
export function CanvasModeGuard({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  useEffect(() => {
    if (readMultitask()) {
      router.replace(`/workspace?id=${encodeURIComponent(workspaceId)}`)
    }
  }, [router, workspaceId])
  return null
}
