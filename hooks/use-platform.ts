"use client"

import { useSyncExternalStore } from "react"

import { getCanvasHost } from "@/lib/canvas-host"
import { useIsMobile } from "@/hooks/use-mobile"

// false during SSR/hydration, true once mounted on the client — lets us read
// window.canvasHost without a hydration mismatch. Same pattern as
// components/canvas/case-canvas.tsx's useMounted().
function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

export interface Platform {
  /** Running inside the Electron desktop shell (window.canvasHost present). */
  isDesktopApp: boolean
  /** Viewport is below the 768px mobile breakpoint (hooks/use-mobile.ts). */
  isMobileViewport: boolean
  /** Canvas is a usable surface right now — false on mobile viewports
      regardless of platform (Canvas on mobile is out of scope). */
  canvasAvailable: boolean
}

/**
 * usePlatform() — shell/viewport facts the sidebar and mobile nav use to
 * decide what to show. SSR-safe: every field is false on the server and on
 * the first client render, then resolves post-mount/post-hydration so there
 * is no hydration mismatch.
 */
export function usePlatform(): Platform {
  const mounted = useMounted()
  const isMobileViewport = useIsMobile()
  const isDesktopApp = mounted && !!getCanvasHost()

  return {
    isDesktopApp,
    isMobileViewport: mounted && isMobileViewport,
    canvasAvailable: mounted && !isMobileViewport,
  }
}
