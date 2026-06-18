// One canvas refresh button should update everything live on screen at once —
// the conversation card and any open queue cards. The queue cards live in
// separate React subtrees (and React Flow nodes), so we coordinate them with a
// tiny window event instead of prop drilling. Only used in client components.
export const CANVAS_REFRESH_EVENT = "fv-canvas-refresh"

export function broadcastCanvasRefresh() {
  try {
    window.dispatchEvent(new Event(CANVAS_REFRESH_EVENT))
  } catch {
    // SSR / no window — nothing to refresh
  }
}

/** Subscribe a live card to manual refreshes. Returns an unsubscribe fn. */
export function onCanvasRefresh(cb: () => void): () => void {
  window.addEventListener(CANVAS_REFRESH_EVENT, cb)
  return () => window.removeEventListener(CANVAS_REFRESH_EVENT, cb)
}
