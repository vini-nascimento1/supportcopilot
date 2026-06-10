"use client"

import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"

import { useEffect, useState, useCallback } from "react"
import { Responsive, WidthProvider } from "react-grid-layout/legacy"
import type { Layout, ResponsiveLayouts } from "react-grid-layout/legacy"

type Layouts = ResponsiveLayouts
type LayoutArray = Layout

const ResponsiveGridLayout = WidthProvider(Responsive)

// v2: Intercom queue (the work) anchors the grid at 8 cols; calendar + inboxes
// supporting context to its right. Bumping the version so users on the old
// default layout pick up the new arrangement without manual reset.
const STORAGE_KEY = "fv-dashboard-layout-v2"

const DEFAULT_LAYOUTS: Layouts = {
  lg: [
    { i: "intercom", x: 0, y: 0, w: 8, h: 8, minW: 4, minH: 5 },
    { i: "calendar", x: 8, y: 0, w: 4, h: 8, minW: 3, minH: 5 },
    { i: "gmail",    x: 0, y: 8, w: 4, h: 5, minW: 2, minH: 4 },
    { i: "slack",    x: 4, y: 8, w: 4, h: 5, minW: 2, minH: 4 },
    { i: "notion",   x: 8, y: 8, w: 4, h: 5, minW: 2, minH: 4 },
  ],
  md: [
    { i: "intercom", x: 0, y: 0, w: 7, h: 8, minW: 4, minH: 5 },
    { i: "calendar", x: 7, y: 0, w: 3, h: 8, minW: 3, minH: 5 },
    { i: "gmail",    x: 0, y: 8, w: 4, h: 5, minW: 2, minH: 4 },
    { i: "slack",    x: 4, y: 8, w: 3, h: 5, minW: 2, minH: 4 },
    { i: "notion",   x: 7, y: 8, w: 3, h: 5, minW: 2, minH: 4 },
  ],
  sm: [
    { i: "intercom", x: 0, y: 0, w: 6, h: 8, minW: 3, minH: 4 },
    { i: "calendar", x: 0, y: 8, w: 6, h: 6, minW: 3, minH: 5 },
    { i: "gmail",    x: 0, y: 14, w: 3, h: 5, minW: 2, minH: 4 },
    { i: "slack",    x: 3, y: 14, w: 3, h: 5, minW: 2, minH: 4 },
    { i: "notion",   x: 0, y: 19, w: 6, h: 4, minW: 2, minH: 4 },
  ],
}

interface DashboardGridProps {
  calendarCard: React.ReactNode
  intercomCard: React.ReactNode
  gmailCard: React.ReactNode
  slackCard: React.ReactNode
  notionCard: React.ReactNode
}

export function DashboardGrid({
  calendarCard,
  intercomCard,
  gmailCard,
  slackCard,
  notionCard,
}: DashboardGridProps) {
  const [layouts, setLayouts] = useState<Layouts>(() => {
    // Lazy initializer: avoids setState-in-effect lint error while reading
    // localStorage synchronously on the client. SSR always gets the default.
    if (typeof window === "undefined") return DEFAULT_LAYOUTS
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? (JSON.parse(saved) as Layouts) : DEFAULT_LAYOUTS
    } catch {
      return DEFAULT_LAYOUTS
    }
  })
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // One-time: marks the component as hydrated so react-grid-layout can
    // render its browser-only layout (SSR gets the loading fallback).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  // Listen for external reset-layout requests (e.g. from the command palette).
  useEffect(() => {
    function handleReset() {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch { /* ignore */ }
      setLayouts(DEFAULT_LAYOUTS)
    }
    window.addEventListener("reset-dashboard-layout", handleReset)
    return () => window.removeEventListener("reset-dashboard-layout", handleReset)
  }, [])

  const onLayoutChange = useCallback((_: LayoutArray, all: Layouts) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    } catch {
      // ignore storage errors
    }
    setLayouts(all)
  }, [])

  const cards = [
    { key: "calendar", node: calendarCard },
    { key: "intercom", node: intercomCard },
    { key: "gmail",    node: gmailCard },
    { key: "slack",    node: slackCard },
    { key: "notion",   node: notionCard },
  ]

  if (!mounted) {
    // SSR / hydration fallback — static layout, no flash
    return (
      <div className="grid grid-cols-1 gap-4 p-4 lg:p-6 xl:grid-cols-12" style={{ minHeight: "60vh" }}>
        <div className="xl:col-span-8" style={{ minHeight: 400 }}>{intercomCard}</div>
        <div className="xl:col-span-4" style={{ minHeight: 400 }}>{calendarCard}</div>
        <div className="xl:col-span-4" style={{ minHeight: 300 }}>{gmailCard}</div>
        <div className="xl:col-span-4" style={{ minHeight: 300 }}>{slackCard}</div>
        <div className="xl:col-span-4" style={{ minHeight: 300 }}>{notionCard}</div>
      </div>
    )
  }

  return (
    <ResponsiveGridLayout
      className="layout"
      layouts={layouts}
      breakpoints={{ lg: 1200, md: 768, sm: 480 }}
      cols={{ lg: 12, md: 10, sm: 6 }}
      rowHeight={64}
      margin={[12, 12]}
      containerPadding={[16, 16]}
      onLayoutChange={onLayoutChange}
      draggableHandle=".drag-handle"
      resizeHandles={["se"]}
      isDraggable
      isResizable
      useCSSTransforms
    >
      {cards.map(({ key, node }) => (
        <div key={key} className="overflow-hidden rounded-xl">
          {node}
        </div>
      ))}
    </ResponsiveGridLayout>
  )
}
