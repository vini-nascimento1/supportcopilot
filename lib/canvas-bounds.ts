import type { ToolBounds } from "./canvas-host"

// Native tool views (WebContentsView, desktop shell) are OS-level layers that
// paint ABOVE the whole page and ignore CSS z-index — so we can't raise the
// canvas chrome (app sidebar, case-queue sidebar, toolbox) above them. Instead
// we clip the bounds handed to the host down to the "safe" canvas area before a
// view is ever shown, so a card slid under the chrome reveals only what isn't
// occluded. The chrome stays web-rendered, on top, and clickable.
//
// The safe area is the pane rect, inset past any edge-docked chrome the card
// overlaps. Edge-docked chrome (left rail/queue, right toolbox) spans a full
// vertical strip, so the result stays a single rectangle — which is all a
// native view can be. Returns null when nothing meaningful is left (card fully
// behind chrome or off the pane); the caller then hides the view.

// Match the existing "too small to bother showing" threshold in ToolNode.
const MIN_VISIBLE = 60

export function clipToolBounds(
  rect: DOMRect,
  pane: Element | null,
): ToolBounds | null {
  let { left, top, right, bottom } = rect

  if (pane) {
    const p = pane.getBoundingClientRect()
    // Clip to the pane. This alone keeps views off the app sidebar (left of the
    // pane) and the canvas header (above it).
    left = Math.max(left, p.left)
    top = Math.max(top, p.top)
    right = Math.min(right, p.right)
    bottom = Math.min(bottom, p.bottom)

    // Inset past edge-docked chrome the card vertically overlaps — so a card
    // sitting entirely below the (short) toolbox keeps its full width.
    // Searched document-wide, not just inside the pane: some chrome (the AI
    // Assistant panel + its launcher button) is a fixed overlay rendered in
    // the app layout, outside the pane, and a native view would otherwise
    // paint straight over it. Chrome in hidden keep-alive panes measures 0×0
    // and is skipped below. (Pane-scoped fallback exists only for the node
    // test environment, which has no document.)
    const chromeEls =
      typeof document !== "undefined"
        ? document.querySelectorAll("[data-canvas-chrome]")
        : pane.querySelectorAll("[data-canvas-chrome]")
    chromeEls.forEach((el) => {
      const c = el.getBoundingClientRect()
      if (c.width === 0 || c.height === 0) return
      if (bottom <= c.top || top >= c.bottom) return // no vertical overlap
      const dock = el.getAttribute("data-canvas-chrome")
      if (dock === "left") left = Math.max(left, c.right)
      else if (dock === "right") right = Math.min(right, c.left)
    })
  }

  const width = right - left
  const height = bottom - top
  if (width < MIN_VISIBLE || height < MIN_VISIBLE) return null
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  }
}

// Pinned cards replay a screen rect captured once, on whatever window/pane
// size existed at pin time (see lib/canvas-pins.ts — it's deliberately
// global, the same pin follows the agent to every case). If that geometry
// no longer fits the CURRENT pane (a smaller window, a sidebar that's now
// expanded, a stale rect from weeks ago), a native view rendered at it paints
// over everything — it's an OS-level layer that ignores CSS entirely, so an
// oversized/offset rect isn't just visually wrong, it can cover chrome that
// should be on top. Clamp every time it's applied rather than trusting it.
export function clampPinnedScreenRect(
  screen: { left: number; top: number; width: number; height: number },
  paneWidth: number,
  paneHeight: number,
): { left: number; top: number; width: number; height: number } {
  const width = Math.max(MIN_VISIBLE, Math.min(screen.width, paneWidth))
  const height = Math.max(MIN_VISIBLE, Math.min(screen.height, paneHeight))
  const left = Math.min(Math.max(screen.left, 0), Math.max(paneWidth - width, 0))
  const top = Math.min(Math.max(screen.top, 0), Math.max(paneHeight - height, 0))
  return { left, top, width, height }
}
