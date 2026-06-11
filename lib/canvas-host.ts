// Bridge to the Electron desktop shell (web/desktop). When the app runs inside
// the shell, the preload script exposes window.canvasHost and tool cards on the
// canvas become real embedded browser views (WebContentsView). In a regular
// browser the host is absent and tool cards degrade to link cards.
// See FanvueSupport/Engineering/Decisions/ADR-0009.

export interface ToolBounds {
  x: number
  y: number
  width: number
  height: number
}

export type ToolEvent =
  | { id: string; kind: "title"; value: string }
  | { id: string; kind: "loading"; value: boolean }
  | { id: string; kind: "url"; value: string }

export interface CanvasHost {
  version: number
  openTool(id: string, url: string): Promise<void>
  closeTool(id: string): void
  closeAllTools(): void
  setToolBounds(id: string, bounds: ToolBounds, zoom: number): void
  setToolVisible(id: string, visible: boolean): void
  reloadTool(id: string): void
  navigateTool(id: string, url: string): void
  onToolEvent(cb: (event: ToolEvent) => void): () => void
}

declare global {
  interface Window {
    canvasHost?: CanvasHost
  }
}

export function getCanvasHost(): CanvasHost | null {
  if (typeof window === "undefined") return null
  return window.canvasHost ?? null
}
