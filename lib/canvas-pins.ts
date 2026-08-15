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

const PINS_KEY = "fv-canvas-pins-v2"
const PINS_EVENT = "fv-canvas-pins-changed"

// v1 screen rects were captured inside React Flow's zoom transform, i.e.
// scaled by whatever the canvas zoom happened to be at pin time — many are
// poisoned (pane-sized or bigger; the "Fadmin covers the whole canvas"
// incident). Migrate once: keep every pin's world geometry, drop only the
// screen rect — ToolNode re-captures it with the fixed, zoom-normalized
// measurement on the next render, so pinned cards heal without user action.
const LEGACY_PINS_KEY = "fv-canvas-pins-v1"

// getPins() runs on every ToolNode/PinButton render (useSyncExternalStore
// getSnapshot), so the migration probe below — 2 localStorage.getItem calls,
// occasionally a setItem/removeItem — must not repeat forever. Gate it to
// once per page load; migrateLegacyPins() itself stays idempotent (safe to
// call again) so this is purely a perf gate, not a correctness dependency.
let migrated = false

function migrateLegacyPins(): void {
  if (migrated) return
  migrated = true
  try {
    if (localStorage.getItem(PINS_KEY) !== null) return
    const raw = localStorage.getItem(LEGACY_PINS_KEY)
    if (raw === null) return
    const pins: Record<string, PinnedGeometry> = {}
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object") {
        for (const [id, pin] of Object.entries(
          parsed as Record<string, PinnedGeometry>,
        )) {
          if (!pin || typeof pin !== "object" || !pin.position) continue
          const migrated: PinnedGeometry = { position: pin.position }
          if (pin.width !== undefined) migrated.width = pin.width
          if (pin.height !== undefined) migrated.height = pin.height
          pins[id] = migrated
        }
      }
    } catch {
      // corrupt v1 payload — migrate to an empty registry
    }
    localStorage.setItem(PINS_KEY, JSON.stringify(pins))
    localStorage.removeItem(LEGACY_PINS_KEY)
  } catch {
    // no localStorage (SSR) — nothing to migrate
  }
}

// Test-only: vitest stubs a fresh localStorage per test (vi.stubGlobal), but
// the `migrated` flag above lives outside that stub and would otherwise leak
// across tests — the second test to touch a legacy pin would silently skip
// migration against its own, unrelated fake store. Call from beforeEach.
export function resetPinMigrationForTests(): void {
  migrated = false
}

export function getPins(): Record<string, PinnedGeometry> {
  migrateLegacyPins()
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
  // A degenerate rect (zero/negative/NaN — e.g. captured off a hidden pane)
  // is treated as absent so the card renders in-flow and re-captures a real
  // one, instead of anchoring to garbage.
  if (!screen || !(screen.width >= 1) || !(screen.height >= 1)) {
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

export interface NodeGeometry {
  position: { x: number; y: number }
  width?: number
  height?: number
}

/**
 * What to persist for a node when saving a per-case canvas layout. A pinned
 * node's live position/width/height is the GLOBAL pin geometry (applyPins in
 * case-canvas.tsx overwrites it at mount) — saving that back verbatim would
 * permanently destroy this case's own layout the moment ANY pin exists. So:
 * while a node is pinned, keep whatever this case had saved before instead of
 * its current (pin-imposed) geometry; fall back to current when there's
 * nothing saved yet (e.g. a node added and pinned in the same session).
 * Unpinned nodes always save their current geometry.
 */
export function geometryForSave(
  pinned: boolean,
  current: NodeGeometry,
  previouslySaved: NodeGeometry | undefined,
): NodeGeometry {
  if (pinned && previouslySaved) return previouslySaved
  return current
}

export function subscribePins(cb: () => void) {
  window.addEventListener(PINS_EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(PINS_EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}
