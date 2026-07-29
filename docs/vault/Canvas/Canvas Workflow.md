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

`components/canvas/canvas-left-sidebar.tsx` is a collapsible rail with three tabs, switched via `components/canvas/canvas-tabs.tsx`:

- **Inbox** — the agent's assigned + open Intercom conversations.
- **Queue** — pending suggested replies awaiting approval/send.
- **Triage** — the unassigned pool, filtered by the agent's keyword/audience preferences (see [[Triage System]]).

Tab selection and sidebar collapse state persist across the app via `lib/canvas-tabs-store.ts`, which combines `localStorage` with `window` custom events so multiple panes stay in sync.

## Core libraries

- `lib/canvas-hotkeys.ts` — keyboard shortcuts shared across all three sidebar tabs: Ctrl/Cmd+A toggles select-all, Ctrl/Cmd+Enter fires the active tab's primary bulk action (Inbox: Generate/Assign, Queue: Approve & send, Triage: Assign+draft). Suppressed while the focus is inside a text input.
- `lib/canvas-tabs-store.ts` — tab + collapse state, `localStorage`-backed, cross-pane sync via custom events.
- `lib/canvas-bounds.ts` — positioning logic for pinned cards so they stay fixed on screen instead of moving with the React Flow pan/zoom transform.
- `lib/canvas-pins.ts` — persistence for which cards are pinned.

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
