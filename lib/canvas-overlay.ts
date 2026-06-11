// Native WebContentsViews render ABOVE the whole page, including dialogs and
// the command palette. Tool nodes call this every rAF tick and hide their view
// while any blocking overlay is open, so modals stay usable on the canvas.
const OVERLAY_SELECTOR =
  '[role="dialog"][data-state="open"], [data-canvas-overlay]'

export function hasBlockingOverlay(): boolean {
  if (typeof document === "undefined") return false
  return document.querySelector(OVERLAY_SELECTOR) !== null
}
