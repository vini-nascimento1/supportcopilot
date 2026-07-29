---
title: Tool Cards and Fadmin
tags: [canvas, fadmin, tools, kyc, payouts]
updated: 2026-07-29
---

# Tool Cards and Fadmin

Tool cards embed external admin tools directly into [[Canvas Workflow]] so an agent never has to leave the case view to look something up. The three standard tools are **Fadmin** (Fanvue's internal admin panel), **ONDATO** (KYC verification), and **MassPay** (payouts).

## Storage

Tools live in the `case_tools` table (migration 0022): `id, name, icon, url_template, group_name, sort_order, is_active`. A related `case_tool_tags` pivot table maps tags to tools (N:M) for the suggestion engine.

Server-side access goes through `lib/case-tools-db.ts`:

- `getCaseTools()` returns only active tools for the canvas, ordered by `sort_order`.
- `getAllCaseTools()` returns every tool (active and inactive) for the Settings CRUD screen.

If the database is unreachable or the query returns zero rows, `getCaseTools()` falls back to `FALLBACK_TOOLS`, a hardcoded list in `lib/canvas-tools.ts` covering Fadmin, ONDATO, and MassPay — so the canvas keeps working even if Supabase is down.

## URL templating

Each tool has a `url_template` that can contain `{{email}}`, `{{handle}}`, or `{{name}}` placeholders. `lib/canvas-tools.ts::resolveToolUrl()` resolves these client-side using the customer context pulled from the current Intercom conversation. If a required placeholder can't be filled (the context is missing that field), resolution returns `null` rather than guessing or building a broken URL.

## Tool suggestion engine

`suggestedTools(tools, tags, ticketText)` in `lib/canvas-tools.ts` decides which tool cards to surface for a case:

- A tool whose `group` is `"Fanvue"` (Fadmin) is always suggested — the agent needs it on virtually every case.
- Otherwise a tool is suggested if any of its tags matches an Intercom tag on the conversation (case-insensitive), or if a keyword for one of its tags is found in the ticket text (subject + customer messages).

The keyword sets (`TAG_KEYWORDS`) are:

- **kyc** → `kyc, verification, verify, verified, identity, id check, ondato, passport, selfie`
- **payout** → `payout, withdraw, payment, bank, crypto, masspay, triplea, earnings`
- **media** → `media, photo, video, upload, content, removed`

## Settings / CRUD

Agents manage the tool list via `components/case-tools-settings.tsx` (create/edit/activate/deactivate), backed by `app/api/case-tools/route.ts` (`GET` list including inactive tools, `POST` create/update) and `app/api/case-tools/[id]/route.ts` for per-tool operations. There is no realtime sync between agents — if one agent edits or adds a tool, others need to refresh their canvas to see the change.

## Known gap: customer context overrides aren't backed by Intercom

The customer email/name used to resolve `{{email}}`/`{{name}}` placeholders can be wrong — e.g. Intercom's profile is stale or ambiguous. To compensate, [[Canvas Workflow]]'s case-info card (`components/canvas/case-info-node.tsx`) has an inline override: a pencil icon that appears on hover next to the name/email, letting the agent type a correction (saved into the node's `overrides.customerName` / `overrides.customerEmail` fields on Enter/blur).

Two things to flag about this:

1. **The override doesn't write back to Intercom.** It only lives in the canvas layout state (which itself isn't persisted server-side — see [[Canvas Workflow]]), so it's a local, ephemeral fix for that agent's current session.
2. **The edit affordance is easy to miss** because the pencil icon only appears on hover — there's no persistent visual cue that an override is even possible, or (once set) that a tool URL was built from a corrected value rather than the raw Intercom data.

## Data flow

```
Case opened on canvas
        |
        v
Intercom conversation --> CustomerContext { email, handle, name }
        |                         ^
        |                         | (optional) case-info-node.tsx
        |                         |   pencil-icon override,
        |                         |   local to this canvas session
        v                         |
suggestedTools(tools, tags, ticketText)
        |
        v
For each suggested tool:
  resolveToolUrl(url_template, CustomerContext)
        |
        +--> all placeholders filled --> tool-node.tsx renders embedded window
        |
        +--> a placeholder missing --> null, card not resolvable
```

## Key files

- `lib/canvas-tools.ts` — `CanvasTool` type, `FALLBACK_TOOLS`, `resolveToolUrl()`, `suggestedTools()`, `TAG_KEYWORDS`
- `lib/case-tools-db.ts` — `getCaseTools()`, `getAllCaseTools()`, DB row mapping, fallback logic
- `components/canvas/tool-node.tsx` — the embedded-tool card
- `components/canvas/case-info-node.tsx` — customer email/name override fields
- `components/case-tools-settings.tsx` — Settings CRUD UI
- `app/api/case-tools/route.ts` — list/create/update tools
- `app/api/case-tools/[id]/route.ts` — per-tool operations
- Migration `0022` — `case_tools` + `case_tool_tags` tables

## See also

- [[Canvas Workflow]] — the board these tool cards render on, and the case-info node that owns the customer-context override
- [[Database Schema Reference]] — full schema detail for `case_tools` / `case_tool_tags`
- [[Settings and Profile]] — where tool CRUD fits among other agent-facing settings
