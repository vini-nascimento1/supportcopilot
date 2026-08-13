import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import {
  getPins,
  isPinned,
  setPin,
  setPinScreen,
  getPinScreen,
  removePin,
  clearAllPins,
  subscribePins,
} from "./canvas-pins"
import type { PinnedGeometry } from "./canvas-pins"

const PINS_KEY = "fv-canvas-pins-v1"

// vitest's default node environment has no real localStorage/window; stand in
// with an in-memory store and a plain EventTarget so write()'s
// dispatchEvent/addEventListener calls have something to talk to.
function makeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
  }
}

const geom = (over: Partial<PinnedGeometry> = {}): PinnedGeometry => ({
  position: { x: 0, y: 0 },
  ...over,
})

beforeEach(() => {
  vi.stubGlobal("localStorage", makeLocalStorage())
  vi.stubGlobal("window", new EventTarget())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("getPins", () => {
  it("returns {} when nothing has been pinned", () => {
    expect(getPins()).toEqual({})
  })

  it("returns {} on corrupt JSON instead of throwing", () => {
    localStorage.setItem(PINS_KEY, "{not json")
    expect(getPins()).toEqual({})
  })

  it("returns {} when the stored value parses but isn't an object", () => {
    localStorage.setItem(PINS_KEY, "42")
    expect(getPins()).toEqual({})
  })
})

describe("setPin / isPinned / removePin", () => {
  it("isPinned is false for an id that was never pinned", () => {
    expect(isPinned("case-info")).toBe(false)
  })

  it("setPin adds a pin retrievable via getPins/isPinned", () => {
    setPin("ai", geom({ position: { x: 10, y: 20 } }))
    expect(isPinned("ai")).toBe(true)
    expect(getPins().ai).toEqual(geom({ position: { x: 10, y: 20 } }))
  })

  it("setPin overwrites an existing pin for the same id", () => {
    setPin("ai", geom({ position: { x: 1, y: 1 } }))
    setPin("ai", geom({ position: { x: 99, y: 99 } }))
    expect(getPins().ai.position).toEqual({ x: 99, y: 99 })
  })

  it("setPin on one id doesn't disturb another", () => {
    setPin("ai", geom())
    setPin("case-info", geom({ position: { x: 5, y: 5 } }))
    expect(Object.keys(getPins()).sort()).toEqual(["ai", "case-info"])
  })

  it("removePin removes only the targeted id", () => {
    setPin("ai", geom())
    setPin("case-info", geom())
    removePin("ai")
    expect(isPinned("ai")).toBe(false)
    expect(isPinned("case-info")).toBe(true)
  })

  it("removePin on an id that isn't pinned is a no-op", () => {
    setPin("ai", geom())
    removePin("nonexistent")
    expect(getPins()).toEqual({ ai: geom() })
  })
})

describe("setPinScreen / getPinScreen", () => {
  const rect = { left: 1, top: 2, width: 3, height: 4 }

  it("is a no-op when the node isn't pinned", () => {
    setPinScreen("tool:1", rect)
    expect(getPins()["tool:1"]).toBeUndefined()
  })

  it("merges the screen rect into an existing pin without touching position/size", () => {
    setPin("tool:1", geom({ position: { x: 7, y: 7 }, width: 100, height: 200 }))
    setPinScreen("tool:1", rect)
    const pin = getPins()["tool:1"]
    expect(pin.screen).toEqual(rect)
    expect(pin.position).toEqual({ x: 7, y: 7 })
    expect(pin.width).toBe(100)
    expect(pin.height).toBe(200)
  })

  it("getPinScreen returns null for a pinned id with no screen rect", () => {
    setPin("tool:2", geom())
    expect(getPinScreen("tool:2")).toBeNull()
  })

  it("getPinScreen returns null for an id that was never pinned", () => {
    expect(getPinScreen("nope")).toBeNull()
  })

  it("returns the same object reference when the rect is unchanged (stable-reference cache for useSyncExternalStore)", () => {
    setPin("tool:3", geom())
    setPinScreen("tool:3", rect)
    const first = getPinScreen("tool:3")
    const second = getPinScreen("tool:3")
    expect(first).toBe(second)
  })

  it("returns a new reference once the rect actually changes", () => {
    setPin("tool:4", geom())
    setPinScreen("tool:4", rect)
    const first = getPinScreen("tool:4")
    setPinScreen("tool:4", { ...rect, left: 999 })
    const second = getPinScreen("tool:4")
    expect(second).not.toBe(first)
    expect(second?.left).toBe(999)
  })
})

describe("clearAllPins", () => {
  it("empties the whole registry", () => {
    setPin("ai", geom())
    setPin("case-info", geom())
    clearAllPins()
    expect(getPins()).toEqual({})
  })
})

describe("subscribePins", () => {
  it("invokes the callback on every write (setPin/removePin/clearAllPins)", () => {
    const cb = vi.fn()
    const unsubscribe = subscribePins(cb)
    setPin("ai", geom())
    expect(cb).toHaveBeenCalledTimes(1)
    removePin("ai")
    expect(cb).toHaveBeenCalledTimes(2)
    clearAllPins()
    expect(cb).toHaveBeenCalledTimes(3)
    unsubscribe()
  })

  it("stops firing after unsubscribe", () => {
    const cb = vi.fn()
    const unsubscribe = subscribePins(cb)
    unsubscribe()
    setPin("ai", geom())
    expect(cb).not.toHaveBeenCalled()
  })

  it("also reacts to a native 'storage' event (cross-tab sync)", () => {
    const cb = vi.fn()
    const unsubscribe = subscribePins(cb)
    window.dispatchEvent(new Event("storage"))
    expect(cb).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
