// Pinned cards: a pinned node keeps ONE global position/size across every
// canvas (case or ad-hoc) and can't be dragged — predictable muscle memory
// for the agent. Registry lives in localStorage, keyed by node id (node ids
// are stable across canvases: "ai", "case-info", "tool:<uuid>", …).

export interface PinnedGeometry {
  position: { x: number; y: number }
  width?: number
  height?: number
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

export function removePin(id: string) {
  const pins = getPins()
  delete pins[id]
  write(pins)
}

export function subscribePins(cb: () => void) {
  window.addEventListener(PINS_EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(PINS_EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}
