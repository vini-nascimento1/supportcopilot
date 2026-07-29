// Pinned cards: a pinned node keeps ONE global position/size across every
// canvas (case or ad-hoc) and can't be dragged — predictable muscle memory
// for the agent. Registry lives in localStorage, keyed by node id (node ids
// are stable across canvases: "ai", "case-info", "tool:<uuid>", …).

export interface PinnedGeometry {
  position: { x: number; y: number }
  width?: number
  height?: number
  /** Tool cards only: screen rect (px, relative to the canvas pane) captured
      at pin time. When present, the card renders in a fixed overlay layer
      instead of React Flow's pannable/zoomable viewport — so panning/zooming
      the canvas no longer resizes its embedded native view. Cleared on unpin. */
  screen?: { left: number; top: number; width: number; height: number }
}

const PINS_KEY = "fv-canvas-pins-v1"
const PINS_EVENT = "fv-canvas-pins-changed"

export function getPins(): Record<string, PinnedGeometry> {
  try {
    const raw = localStorage.getItem(PINS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function write(pins: Record<string, PinnedGeometry>) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins))
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(PINS_EVENT))
}

export function isPinned(id: string): boolean {
  return id in getPins()
}

export function setPin(id: string, geometry: PinnedGeometry) {
  write({ ...getPins(), [id]: geometry })
}

// Merges the anchor rect into an existing pin without touching the world
// position/size (which React Flow / edges still key off of). No-op if the
// node isn't pinned.
export function setPinScreen(
  id: string,
  screen: NonNullable<PinnedGeometry["screen"]>,
) {
  const pins = getPins()
  const pin = pins[id]
  if (!pin) return
  write({ ...pins, [id]: { ...pin, screen } })
}

// Stable-reference cache so useSyncExternalStore callers (see ToolNode) don't
// re-render every tick — getPins() re-parses JSON on every call, which would
// otherwise hand back a new object identity even when the value is unchanged.
const screenCache = new Map<string, { json: string; value: PinnedGeometry["screen"] }>()

export function getPinScreen(id: string): PinnedGeometry["screen"] | null {
  const screen = getPins()[id]?.screen
  if (!screen) {
    screenCache.delete(id)
    return null
  }
  const json = JSON.stringify(screen)
  const cached = screenCache.get(id)
  if (cached && cached.json === json) return cached.value ?? null
  screenCache.set(id, { json, value: screen })
  return screen
}

export function removePin(id: string) {
  const pins = getPins()
  delete pins[id]
  write(pins)
}

// Escape hatch: pins are global and can end up with stale geometry from a
// different window/pane size (see clampPinnedScreenRect in canvas-bounds.ts
// for the render-time guard) — but a pinned card's own header/pin-toggle can
// itself be hard to reach if something's gone wrong with it visually. This
// gives every canvas a guaranteed way out that doesn't depend on that card
// rendering correctly first.
export function clearAllPins() {
  write({})
}

export function subscribePins(cb: () => void) {
  window.addEventListener(PINS_EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(PINS_EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}
