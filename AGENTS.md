<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Support Copilot — Orchestrator

Fanvue's internal tool for support agents: a Next.js app that turns Intercom ticket handling into a
single visual workspace (the **Canvas**), with an AI draft/verify pipeline, embedded admin tools
(Fadmin, ONDATO, MassPay), and integrations into Gmail, Slack, and Notion.

## Where the real documentation lives

Full subsystem documentation is an Obsidian vault at **[`docs/vault/`](docs/vault/00-Index.md)** —
start at `docs/vault/00-Index.md`. Open `docs/vault/` directly as an Obsidian vault for wikilink
navigation and graph view. Each page has YAML frontmatter, a "Key files" section with exact
repo-relative paths, and a data-flow diagram where relevant.

Quick map (see the index for the full list):

| Area | Vault page | Code lives in |
|---|---|---|
| Tech stack, dirs, build | `Architecture/Tech Stack.md` | `app/`, `components/`, `lib/` |
| Auth / SSO | `Architecture/Auth and Session.md` | `lib/auth.ts`, `proxy.ts`, `app/api/auth/` |
| Canvas workflow | `Canvas/Canvas Workflow.md` | `components/canvas/`, `lib/canvas-*.ts` |
| Tool cards / Fadmin | `Canvas/Tool Cards and Fadmin.md` | `lib/canvas-tools.ts`, `lib/case-tools-db.ts` |
| AI draft/verify pipeline | `AI Pipeline/Draft Verify Pipeline.md` | `lib/draft-ai.ts`, `lib/reply-queue*.ts` |
| System prompt design | `AI Pipeline/System Prompt Architecture.md` | `lib/draft-ai.ts`, `lib/tone-presets.ts` |
| Intercom | `Integrations/Intercom Integration.md` | `lib/intercom.ts`, `app/api/webhooks/intercom/` |
| Triage sweep | `Integrations/Triage System.md` | `lib/triage/` |
| Gmail | `Integrations/Gmail Integration.md` | `lib/gmail-client.ts`, `app/api/gmail/` |
| Slack | `Integrations/Slack Integration.md` | `lib/slack.ts`, `app/api/slack/` |
| Notion (MCP) | `Integrations/Notion MCP Integration.md` | `lib/notion-mcp-client.ts`, `lib/notion-retrieval*.ts` |
| Database schema | `Database/Database Schema Reference.md` | Supabase (remote project, no local migrations folder) |
| Settings page | `Settings/Settings and Profile.md` | `app/settings/`, `components/*-settings.tsx` |
| Automation rules | `Automation/Automation Rules Engine.md` | `lib/automation/` |
| AI Chat assistant | `Automation/AI Chat Assistant.md` | `components/ai-chat.tsx`, `app/api/ai/chat/route.ts` |
| Notifications | `Automation/Notifications.md` | `lib/notifications-store.ts`, `components/notifications/` |

Other docs outside the vault: `docs/intercom-admins.md` (Fanvue staff Intercom admin-ID roster —
internal, not customer data) and `docs/plans/` (point-in-time feature plans).

## Documentation policy — keep the vault current

This is a documentation-driven repo: when you ship a new subsystem, or materially change an
existing one, **update or add its page in `docs/vault/`** before considering the task done, not
just the code. Follow the existing vault conventions (YAML frontmatter, `[[wikilinks]]` between
pages, a "Key files" section, English prose). Don't leave a page that describes behavior you just
changed — a stale doc is worse than no doc, so correct it in the same pass.

## Standing policy — log every shipped feature in "New Features"

Whenever you ship a user-facing feature or fix a bug a user would actually notice, add an entry to
`SEED_ENTRIES` in `app/api/changelog/route.ts` — this feeds the in-app "New Features" dialog
(bell/megaphone icon in the sidebar). Do this **without being asked** every time; it's a standing
requirement, not a one-off. Rules:

- Match the existing tone: plain, benefit-oriented, no file paths or code jargon. Write for the
  support agent using the app, not for another engineer.
- One entry per distinct user-visible change — don't bundle unrelated fixes into one title.
- Skip anything purely internal (refactors, dev docs, CI, this vault) — the changelog is for things
  an agent using the app would notice or care about.
- `id`: `"seed-YYYY-MM-DD-<letter>"` matching the entry's ship date; `date`: same date, `"YYYY-MM-DD"`.
- Add new entries near the top of `SEED_ENTRIES` (the array is re-sorted by date at request time,
  so exact position doesn't matter, but keep it readable).
- This is a fallback data source — if the `changelog` Supabase table is live and takes precedence
  (see the comment at the top of the file), prefer inserting there instead; check before assuming
  the seed array is still authoritative.

## Handling real user/financial data

This app reaches real Fanvue customer and creator data through its integrations (Intercom
conversations, Fadmin, Gmail, Slack, Notion) and, transitively, payout/financial systems. Treat
names, emails, and financial figures accordingly — least detail necessary, no PII in logs you add,
no widening visibility beyond what a task actually needs. Sign-in is deliberately Google Workspace
SSO only (`@fanvue.com`, see `Auth and Session.md`) — never add a bypass or alternate login path,
even for local dev convenience.
