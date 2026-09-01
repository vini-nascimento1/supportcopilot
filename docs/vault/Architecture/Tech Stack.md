---
title: Tech Stack
tags: [architecture, tech-stack]
updated: 2026-09-01
---

# Tech Stack

Support Copilot is a Next.js 16 application (App Router) that pairs a Supabase-backed Postgres/Auth layer with a set of external integrations (Intercom, Gmail, Slack, Notion) to power an AI-assisted support agent workspace.

## Core stack

- **Framework**: Next.js `16.2.6`, using the App Router with a mix of server and client components. `next dev` runs with `--webpack` (not Turbopack).
- **Language**: TypeScript `^5`, strict App Router conventions throughout `app/`.
- **UI**: `radix-ui` (`^1.5.0`) as the headless primitive layer, styled with Tailwind CSS `^4` (via `@tailwindcss/postcss`) and shadcn-style components layered on top. `class-variance-authority` and `tailwind-merge` handle variant styling and class merging; `tw-animate-css` supplies animation utilities.
- **State**: React `19.2.4` — no Redux or other global state library. Client-side state lives in React context and plain component state, with `window` custom events used for cross-component signaling where a shared store would otherwise be needed (notably around canvas and reply-queue updates — see [[Canvas Workflow]]).
- **Data**: Supabase (Postgres) is the system of record. `@supabase/supabase-js` (`^2.107.0`) plus `@supabase/ssr` (`^0.10.3`) provide the browser/server clients and cookie-based SSR session handling; a separate admin (service-role) client is used for privileged server-side reads/writes. See [[Database Schema Reference]] and [[Auth and Session]].
- **Analytics**: `@vercel/speed-insights` (`^2.0.0`) for Core Web Vitals collection.

## Notable dependencies

| Package | Version | Purpose |
|---|---|---|
| `@supabase/supabase-js` | `^2.107.0` | Postgres + Auth client |
| `@supabase/ssr` | `^0.10.3` | Cookie-based SSR session handling |
| `@xyflow/react` | `^12.11.0` | React Flow — renders the canvas workflow graph (see [[Canvas Workflow]]) |
| `sonner` | `^2.0.7` | Toast notifications |
| `lucide-react` | `^1.17.0` | Icon set |
| `class-variance-authority` | `^0.7.1` | Variant-driven component styling |
| `tailwind-merge` | `^3.6.0` | Safe Tailwind class merging |
| `radix-ui` | `^1.5.0` | Headless UI primitives underlying shadcn/ui components |
| `react-markdown` | `^10.1.0` | Rendering AI-generated markdown (drafts, macros) |
| `next-themes` | `^0.4.6` | Light/dark theme switching |

Testing runs on `vitest` (`^4.1.8`), with `npm test` / `npm run test:watch`. Linting is ESLint `^9` with `eslint-config-next`; formatting is Prettier `^3.8.3` with `prettier-plugin-tailwindcss`.

## Directory structure

- **`app/`** — Next.js App Router pages and API routes: authentication (`app/api/auth/**`), third-party integrations, the AI draft/verify pipeline, and webhook receivers. See [[System Prompt Architecture]], [[Draft Verify Pipeline]], and [[Intercom Integration]].
- **`components/`** — React UI: the canvas (React Flow graph), tool cards ([[Tool Cards and Fadmin]]), settings screens ([[Settings and Profile]]), the automation rule builder ([[Automation Rules Engine]]), and `components/home/` — the Home briefing that renders `app/page.tsx` (see below).
- **`lib/`** — Shared utilities, integration clients, type definitions, and pure logic. Deliberately free of page-level state; this is where `auth.ts`, Supabase clients, and integration wrappers (Gmail, Slack, Notion, Intercom) live.
- **`hooks/`** — Custom React hooks: `use-mobile.ts` (viewport breakpoint) and `use-platform.ts` (desktop-app / mobile-viewport / canvas-availability facts — see "Platform layer and mobile navigation" below).
- **`public/`** — Static assets, including the build-generated `version.json`.
- **`scripts/`** — Build-time utilities, notably `generate-version.mjs`.
- **`docs/`** — Documentation, including this Obsidian vault (`docs/vault/`).

## Home (the `/` route)

`app/page.tsx` renders **Home**, the copilot briefing that replaced the old draggable dashboard grid (`components/dashboard-grid.tsx` + `components/cards/*` + the `react-grid-layout` dependency, all removed on 2026-09-01). It is a server component: it loads the agent profile, then a single `Briefing` object (contract: `lib/briefing/types.ts`) which is awaited inside per-section `<Suspense>` boundaries so the header badge, the left column (greeting, hero, "Needs you now") and the right column (today, Slack, email) each show their own skeleton. All rendering components live in `components/home/`; the only interactive parts are the hero tiles, the expandable rows and the prepared-reply actions, which call the existing human-gated endpoints (`/api/draft/send` + `/api/reply-queue/resolve`, `/api/slack/send`). Locked (`needs_check`) drafts never send from Home. See [[Home Briefing]] for the data layer.

## Build, versioning, and deployment

Both `npm run dev` and `npm run build` first run `node scripts/generate-version.mjs`, then start the dev server or run `next build` respectively. `npm run build` also type-checks via `tsc --noEmit` (`npm run typecheck` runs this standalone).

`scripts/generate-version.mjs` writes `public/version.json` (and mirrors it into `.next/public/` for the build output) containing a commit `sha` and an ISO `timestamp`. It prefers Vercel's injected `VERCEL_GIT_COMMIT_SHA` env var (Vercel's build sandbox doesn't reliably expose a working `.git` checkout, so `git rev-parse` there used to silently fail and every deploy fell back to the literal string `"unknown"` — which meant the update banner never fired since it only flips on when the sha *changes*). Locally, it falls back to `git rev-parse --short HEAD`.

The client polls `version.json` and compares the served `sha` against the one it loaded with; when they differ, `components/update-banner.tsx` prompts the user to refresh to pick up the new deployed build.

## Routing/session note

Session refresh and route protection are implemented in `proxy.ts` at the repo root (Next.js's evolution of the classic `middleware.ts` convention) rather than a `components`- or `app`-level file — see [[Auth and Session]] for what it does.

## Key files

- `package.json` — dependency manifest
- `next.config.ts` — Next.js configuration
- `proxy.ts` — request-level session refresh + route protection (see [[Auth and Session]])
- `scripts/generate-version.mjs` — writes `public/version.json` at build/dev time
- `components/update-banner.tsx` — polls `version.json` and prompts for refresh
- `vitest.config.ts` — test runner configuration
- `tsconfig.json` — TypeScript configuration
- `app/` — pages and API routes
- `app/page.tsx` — Home, the briefing route (see [[Home Briefing]])
- `components/home/` — Home briefing UI (hero, attention list, prepared cards, digests)
- `components/` — UI components
- `lib/` — shared utilities and integration clients
- `hooks/use-mobile.ts` — viewport breakpoint hook
- `hooks/use-platform.ts` — desktop-app / mobile-viewport / canvas-availability facts
- `components/mobile-nav.tsx` — bottom tab bar shown below 768px

## Data flow

```
npm run dev / npm run build
        │
        ▼
scripts/generate-version.mjs
        │  writes {sha, timestamp}
        ▼
public/version.json  ──(polled by client)──▶ components/update-banner.tsx ──▶ "Refresh to update" prompt
```

## Platform layer and mobile navigation

`hooks/use-platform.ts` exposes `usePlatform() → { isDesktopApp, isMobileViewport, canvasAvailable }`,
built on `lib/canvas-host.ts::getCanvasHost()` (presence of `window.canvasHost`, injected by the
Electron desktop shell's preload script — see [[Canvas Workflow]] and ADR-0009) and
`hooks/use-mobile.ts::useIsMobile()` (768px breakpoint, `useSyncExternalStore`-backed). It is
SSR-safe: `isDesktopApp` is gated behind the same mounted-guard pattern as
`components/canvas/case-canvas.tsx`'s `useMounted()` (false during SSR/hydration, resolved after
mount), and `isMobileViewport` inherits `useIsMobile()`'s own SSR-safe `useSyncExternalStore`
snapshot — so neither field can cause a hydration mismatch.

**Desktop-only rule.** Canvas (`/canvas`) needs real screen space and, for its full embedded-tool
experience, the desktop shell's native `WebContentsView` layers — both are unavailable on a phone.
Canvas on mobile is out of scope (see the plan). Two call sites act on this:

- `components/workspace-sidebar.tsx` drops the Canvas item from the sidebar entirely when
  `isMobileViewport` is true, and — on plain web (`!isDesktopApp`, desktop-width) — wraps it in a
  tooltip ("Full experience in the desktop app") instead of hiding it, since `CaseCanvas` already
  has its own download-gate fallback for browsers without the shell.
- `components/workspace-layout.tsx` renders `components/mobile-nav.tsx`, a bottom tab bar (Home,
  Cases, Queue, More) shown only below 768px via a CSS `md:hidden` class (not a JS conditional —
  avoids any render flash). Canvas is deliberately absent from it. "Queue" links to `/cases` until
  a later workstream lifts `components/canvas/queue-panel.tsx` out of its Canvas coupling for a
  standalone `/queue` route. "More" opens a `components/ui/sheet.tsx` bottom sheet listing the
  remaining workspace destinations (Gmail, Slack, Playbooks, Automation, Metrics when the agent is
  a manager, New Features, Settings). `WorkspaceLayout` also adds `pb-14 md:pb-0` to `SidebarInset`
  so page content never sits under the fixed nav, and the nav is marked
  `data-canvas-chrome="bottom"` for consistency with the app's other fixed overlays (see
  `lib/canvas-bounds.ts`) even though that dock value isn't clipped against today — moot in
  practice since Canvas never renders on a mobile viewport.

Both the sidebar item removal and the mobile nav read `usePlatform()`; nothing else in the app
currently depends on it.

See also: [[Canvas Workflow]], [[Auth and Session]], [[Database Schema Reference]], [[Tool Cards and Fadmin]].
