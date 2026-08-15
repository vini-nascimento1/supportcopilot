---
title: Canvas Workflow
tags: [canvas, react-flow, ui, workflow]
updated: 2026-07-29
---

# Canvas Workflow

The Canvas is the core workspace where a support agent manages a single case. It's a visual, node-based workflow builder built on React Flow (`@xyflow/react`) that puts the conversation, AI-suggested drafts, and embedded external tool windows (Fadmin, KYC systems, payout processors — see [[Tool Cards and Fadmin]]) all on one board, so the agent never has to tab-switch away from the case.

## Layout

`components/canvas/canvas-workspace.tsx` is the root layout: a left sidebar, the canvas grid in the middle, and a right copilot panel. The canvas grid itself is rendered by `components/canvas/case-canvas.tsx` (~984 lines), which is the React Flow graph: it lays out conversation nodes, AI-suggestion nodes, and tool nodes, and connects them with dashed "wire" edges (e.g. "case → tool (opened)") using connection handles defined in `components/canvas/card-handles.tsx`.

Each case's central card is `components/canvas/case-info-node.tsx` — it shows the customer conversation summary and the AI draft queue for that case, and also owns an inline, editable override for the customer's email/name (see [[Tool Cards and Fadmin]] for why this matters). Replies are staged and edited in `components/canvas/conversation-reply-node.tsx` before send, with `components/canvas/composer-bar.tsx` providing inline reply composition. Tool windows are embedded via `components/canvas/tool-node.tsx`, a resizable card. `components/canvas/pin-button.tsx` lets an agent pin a card to a fixed screen position so it stays put during pan/zoom instead of moving with the rest of the graph.

## Left sidebar

`components/canvas/canvas-left-sidebar.tsx` is a collapsible rail with three tabs, switched via `components/canvas/canvas-tabs.tsx`. The case Canvas and standalone Canvas headers both expose the shared workspace sidebar trigger so agents can reopen or collapse navigation without leaving the board:

- **Inbox** — the agent's assigned + open Intercom conversations.
- **Queue** — pending suggested replies awaiting approval/send.
- **Triage** — the unassigned pool, filtered by the agent's keyword/audience preferences (see [[Triage System]]).

Tab selection and sidebar collapse state persist across the app via `lib/canvas-tabs-store.ts`, which combines `localStorage` with `window` custom events so multiple panes stay in sync.

## Core libraries

- `lib/canvas-hotkeys.ts` — keyboard shortcuts shared across all three sidebar tabs: Ctrl/Cmd+A toggles select-all, Ctrl/Cmd+Enter fires the active tab's primary bulk action (Inbox: Generate/Assign, Queue: Approve & send, Triage: Assign+draft). Suppressed while the focus is inside a text input.
- `lib/canvas-tabs-store.ts` — tab + collapse state, `localStorage`-backed, cross-pane sync via custom events. Capped at `MAX_TABS` (12): registration goes through `registerTab()`, a pure append/prepend-with-eviction helper that always evicts the **oldest** tab, never the one just registered (2026-08-15 fix — the workspace used to append then truncate, so the 13th tab was activated and immediately dropped, blanking the whole canvas area). Both the keep-alive workspace (`canvas-workspace.tsx`, which also prunes an evicted tab's hidden pane from its `mounted` set) and the legacy strip (`canvas-tabs.tsx`) share it so eviction semantics can't drift.
- `lib/canvas-bounds.ts` — positioning logic for pinned cards so they stay fixed on screen instead of moving with the React Flow pan/zoom transform. Also `clampPinnedScreenRect()`: a pinned card's screen rect is captured once and replayed on every canvas (pins are global by design, see below), so it can be stale relative to the CURRENT window/sidebar state — this clamps it to the live pane size every render. Without it, a native tool view positioned at an oversized/offset rect paints over the whole app, since native `WebContentsView`s are an OS-level layer that ignores CSS/z-index entirely (2026-07-29 incident: a stale Fadmin pin rendered full-bleed over the app chrome). `clipToolBounds()` searches `[data-canvas-chrome]` **document-wide** (2026-08-15), not just inside the pane — the AI Assistant panel and its launcher FAB (`components/ai-chat.tsx`, rendered in the app layout) are marked as right-docked chrome so tool views clip around them instead of painting over the assistant.
- **Pin capture is zoom-normalized** (2026-08-15 fix): the in-flow card sits inside React Flow's zoom transform, so a naive `getBoundingClientRect()` at pin time captures the rect scaled by the canvas zoom — and `fitView` routinely lands above 1 on a sparse canvas, so a lone pinned Fadmin card was stored pane-sized and, after clamping, rendered full-screen forever. `ToolNode`'s capture effect now divides the measured size by the current zoom (anchored cards render their content at 1:1), clamps the rect to the pane before storing it, and skips measuring inside hidden keep-alive panes (which report 0×0 rects). The `NodeResizer` is also hidden while a card is anchored — its world-space resize math doesn't map to the frozen screen rect.
- `lib/canvas-pins.ts` — persistence for which cards are pinned. Deliberately **global**, keyed by the tool's stable id (`tool:<uuid>`) — pinning Fadmin on one case pins it on every case. Storage key is `fv-canvas-pins-v2`; a lazy one-time migration from v1 keeps each pin's world geometry but drops its stored screen rect (v1 rects were zoom-poisoned, see above) so pinned cards re-capture a correct rect on their next render with no user action. `getPinScreen()` treats degenerate rects (zero/NaN size) as absent for the same self-healing reason. `clearAllPins()` is the escape hatch, wired to an "Unpin all tool cards" button in the canvas toolbox — needed because `resetLayout()` only clears a case's own layout, not the global pins registry, so a bad pin used to have no reliable way to undo short of clearing `localStorage` by hand.
- **Pins no longer overwrite per-case layouts** (2026-08-15 fix): `applyPins` still imposes the global geometry on the *live* nodes at mount, but the debounced save in `case-canvas.tsx` now runs pinned nodes through `geometryForSave()` (`lib/canvas-pins.ts`) — persisting the geometry this case had **previously saved** instead of the pin-imposed values, so a pin passing through no longer destroys where each case had placed the card. Unpinning restores the card to this case's saved spot via `SavedLayoutProvider` (`pin-button.tsx`), and both pin/unpin now preserve unrelated `className` tokens instead of stomping them. Layouts already clobbered before the fix can't be recovered (the original geometry is gone from storage).
- **Tool-card URLs are reconciled on restore** (2026-08-15 fix): a layout loaded from storage used to keep last session's resolved `data.url` forever (the live email/name reconciler deliberately skips its first run). `loadLayout` now passes every restored tool node through `reconcileRestoredToolUrl()` (`lib/canvas-tools.ts`) using the saved case-info overrides plus fresh props: ghost cards get the corrected `url` outright, loaded cards get `pendingUrl` and the existing one-click Refresh banner.
- **Minimize really hides the native view** (2026-08-15 fix): `ToolNode`'s rAF tick used to bail out when the card body was unmounted, so minimizing collapsed the card but left the `WebContentsView` painted at its last bounds over the app. "No body element" is now just another hidden state — null bounds → `setToolVisible(false)` — alongside blocking overlays and full occlusion.

## Data flow

1. Agent opens a case from the Inbox tab.
2. `/api/canvas/conversation` fetches the full Intercom thread plus any pending suggested reply from the `suggested_replies` table.
3. Canvas renders the case: a conversation node plus auto-suggested tool cards (matched via Intercom tags/keywords — see [[Tool Cards and Fadmin]]), connected by dashed wire edges.
4. Sidebar Inbox polls `/api/cases` (agent's assigned + open Intercom conversations) every 10-30s.
5. Sidebar Queue polls `/api/reply-queue` (rows from `suggested_replies`) every 5-30s.
6. Sidebar Triage polls `/api/triage` (unassigned pool, swept every 5 min) filtered by the agent's keyword/audience prefs — see [[Triage System]].

```
Agent opens case (Inbox tab)
        |
        v
GET /api/canvas/conversation  --> Intercom thread + suggested_replies row
        |
        v
case-canvas.tsx renders:
  conversation node -- wire --> tool node(s) (auto-suggested by tag/keyword)
        |
        v
Sidebar polling (paused when hidden/collapsed/inactive):
  Inbox  -> GET /api/cases        (10-30s)
  Queue  -> GET /api/reply-queue  (5-30s)
  Triage -> GET /api/triage       (5 min sweep cadence)
```

## Persistence

Canvas layouts are **not** stored server-side — an agent rebuilds the board each time they open a case. The only thing that persists is sidebar tab selection and collapse state, kept in `localStorage`. As a bandwidth optimization, all sidebar polling pauses when the pane isn't visible, the sidebar is collapsed, or the relevant tab isn't the active one.

## Key files

- `components/canvas/canvas-workspace.tsx`
- `components/canvas/case-canvas.tsx`
- `components/canvas/case-info-node.tsx`
- `components/canvas/conversation-reply-node.tsx`
- `components/canvas/canvas-left-sidebar.tsx`
- `components/canvas/canvas-tabs.tsx`
- `components/canvas/composer-bar.tsx`
- `components/canvas/tool-node.tsx`
- `components/canvas/card-handles.tsx`
- `components/canvas/pin-button.tsx`
- `lib/canvas-hotkeys.ts`
- `lib/canvas-tabs-store.ts`
- `lib/canvas-bounds.ts`
- `lib/canvas-pins.ts`

## See also

- [[Tool Cards and Fadmin]] — the embedded tool cards suggested on the canvas
- [[Triage System]] — the unassigned pool backing the Triage tab
- [[Tech Stack]] — React Flow / `@xyflow/react` and the rest of the frontend stack
