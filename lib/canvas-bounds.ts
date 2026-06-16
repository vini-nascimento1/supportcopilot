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
    pane.querySelectorAll("[data-canvas-chrome]").forEach((el) => {
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
