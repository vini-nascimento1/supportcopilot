import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import {
  readTabsRaw,
  readTabs,
  writeTabs,
  registerTab,
  subscribeTabs,
  isAdhoc,
  MAX_TABS,
  type CanvasTab,
} from "./canvas-tabs-store"

const KEY = "fv-canvas-tabs-v1"

// vitest's default node environment has no real localStorage/window; stand in
// with an in-memory store and a plain EventTarget so writeTabs()'s
// setItem/dispatchEvent calls have something to talk to.
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

const tab = (id: string, title?: string): CanvasTab => ({ id, title: title ?? id })

function makeTabs(count: number): CanvasTab[] {
  return Array.from({ length: count }, (_, i) => tab(`t${i}`))
}

describe("registerTab (pure)", () => {
  it("appends a new tab under the cap, at the end by default", () => {
    const current = makeTabs(3)
    const next = registerTab(current, tab("new"))
    expect(next.map((t) => t.id)).toEqual(["t0", "t1", "t2", "new"])
  })

  it("prepends a new tab under the cap when position is 'start'", () => {
    const current = makeTabs(3)
    const next = registerTab(current, tab("new"), "start")
    expect(next.map((t) => t.id)).toEqual(["new", "t0", "t1", "t2"])
  })

  it("evicts the oldest tab (not the one just registered) once at the cap", () => {
    const current = makeTabs(MAX_TABS)
    const next = registerTab(current, tab("new"))
    expect(next).toHaveLength(MAX_TABS)
    // oldest (t0) is gone, everything else shifts down, new tab survives at the end
    expect(next.map((t) => t.id)).toEqual([
      ...current.slice(1).map((t) => t.id),
      "new",
    ])
  })

  it("evicts the oldest tab from the opposite end when prepending at the cap", () => {
    const current = makeTabs(MAX_TABS)
    const next = registerTab(current, tab("new"), "start")
    expect(next).toHaveLength(MAX_TABS)
    // oldest is still whatever was last (t(MAX_TABS-1)) since new tabs enter at the front
    expect(next[0].id).toBe("new")
    expect(next.map((t) => t.id)).not.toContain(current[current.length - 1].id)
  })

  it("re-registering an existing id doesn't duplicate it or evict anything", () => {
    const current = makeTabs(MAX_TABS)
    const next = registerTab(current, tab("t5", "renamed"))
    expect(next).toHaveLength(MAX_TABS)
    expect(next.filter((t) => t.id === "t5")).toHaveLength(1)
    expect(next.find((t) => t.id === "t5")?.title).toBe("renamed")
    // every original id survives — nothing evicted, just re-positioned
    expect(new Set(next.map((t) => t.id))).toEqual(new Set(current.map((t) => t.id)))
  })

  it("the tab being registered always survives, even at the cap", () => {
    const current = makeTabs(MAX_TABS)
    const next = registerTab(current, tab("brand-new"))
    expect(next.some((t) => t.id === "brand-new")).toBe(true)
    expect(next).toHaveLength(MAX_TABS)
  })

  it("never grows past MAX_TABS no matter how far current already overshoots it", () => {
    const current = makeTabs(MAX_TABS + 5)
    const next = registerTab(current, tab("new"))
    expect(next.length).toBeLessThanOrEqual(MAX_TABS)
    expect(next.some((t) => t.id === "new")).toBe(true)
  })
})

describe("readTabs / writeTabs / readTabsRaw", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage())
    vi.stubGlobal("window", new EventTarget())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("readTabs returns [] when nothing has been written", () => {
    expect(readTabs()).toEqual([])
    expect(readTabsRaw()).toBe("[]")
  })

  it("readTabs returns [] on corrupt JSON instead of throwing", () => {
    localStorage.setItem(KEY, "{not json")
    expect(readTabs()).toEqual([])
  })

  it("readTabs returns [] when the stored value parses but isn't an array", () => {
    localStorage.setItem(KEY, "42")
    expect(readTabs()).toEqual([])
  })

  it("writeTabs persists tabs retrievable via readTabs", () => {
    writeTabs([tab("a"), tab("b")])
    expect(readTabs()).toEqual([tab("a"), tab("b")])
  })

  it("writeTabs enforces MAX_TABS as a backstop even if the caller forgets to", () => {
    writeTabs(makeTabs(MAX_TABS + 5))
    expect(readTabs()).toHaveLength(MAX_TABS)
  })

  it("subscribeTabs fires on writeTabs and on a native storage event", () => {
    const cb = vi.fn()
    const unsubscribe = subscribeTabs(cb)
    writeTabs([tab("a")])
    expect(cb).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event("storage"))
    expect(cb).toHaveBeenCalledTimes(2)
    unsubscribe()
    writeTabs([tab("b")])
    expect(cb).toHaveBeenCalledTimes(2)
  })
})

describe("isAdhoc", () => {
  it("is true for adhoc-prefixed ids", () => {
    expect(isAdhoc("adhoc:xyz")).toBe(true)
  })

  it("is false for conversation ids", () => {
    expect(isAdhoc("12345")).toBe(false)
  })
})
