"use client"

import Link from "next/link"
import { forwardRef, type ComponentPropsWithoutRef } from "react"

import { useCanvasMultitask } from "@/lib/use-canvas-multitask"

type Props = Omit<ComponentPropsWithoutRef<typeof Link>, "href"> & {
  conversationId: string
}

// Entry point into a case canvas that respects the hard-multitasking
// preference. When it's on, link straight to the keep-alive workspace instead
// of /cases/[id]/canvas — otherwise we'd render the route-per-canvas page only
// for its mode guard to immediately bounce to /workspace (a visible double
// load). Forwards ref + props so it composes with <Button asChild>.
export const CanvasLink = forwardRef<HTMLAnchorElement, Props>(function CanvasLink(
  { conversationId, ...props },
  ref,
) {
  const multitask = useCanvasMultitask()
  const href = multitask
    ? `/workspace?id=${encodeURIComponent(conversationId)}`
    : `/cases/${conversationId}/canvas`
  return <Link ref={ref} href={href} {...props} />
})
