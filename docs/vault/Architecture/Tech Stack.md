---
title: Tech Stack
tags: [architecture, tech-stack]
updated: 2026-07-29
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
| `react-grid-layout` | `^2.2.3` | Draggable/resizable dashboard grid |
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
- **`components/`** — React UI: the canvas (React Flow graph), tool cards ([[Tool Cards and Fadmin]]), settings screens ([[Settings and Profile]]), and the automation rule builder ([[Automation Rules Engine]]).
- **`lib/`** — Shared utilities, integration clients, type definitions, and pure logic. Deliberately free of page-level state; this is where `auth.ts`, Supabase clients, and integration wrappers (Gmail, Slack, Notion, Intercom) live.
- **`hooks/`** — Custom React hooks. Currently just `use-mobile.ts`.
- **`public/`** — Static assets, including the build-generated `version.json`.
- **`scripts/`** — Build-time utilities, notably `generate-version.mjs`.
- **`docs/`** — Documentation, including this Obsidian vault (`docs/vault/`).

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
- `components/` — UI components
- `lib/` — shared utilities and integration clients
- `hooks/use-mobile.ts` — only custom hook today

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

See also: [[Canvas Workflow]], [[Auth and Session]], [[Database Schema Reference]], [[Tool Cards and Fadmin]].
