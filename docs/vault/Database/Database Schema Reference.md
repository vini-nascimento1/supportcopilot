---
title: Database Schema Reference
tags: [database, supabase, reference]
updated: 2026-07-29
---

# Database Schema Reference

Supabase Postgres schema for the Fanvue Support Copilot app (project `fanvue-support-copilot`, ref `sarbmqumaadpozmpenyr`). There is no `supabase/migrations/` folder checked into this repo — the schema lives only in the remote Supabase project, applied through 26 migrations (`init` → `drop_agents_personal_ai_provider`, 2026-06-06 to 2026-08-03). This page was verified directly against the live schema (`list_tables`, `pg_indexes`) and the applied migration history, not against local SQL files, since none exist in-tree.

All tables below have Row Level Security enabled (`rls_enabled: true`). See [[Auth and Session]] for how agent identity maps into RLS policies.

## Agent / session

### `agents`

One row per support agent, created on first Supabase Auth login. Holds identity, OAuth tokens for connected integrations, and per-agent preferences (tone, triage settings). RLS restricts each agent to reading/writing only their own row. See [[Auth and Session]], [[Settings and Profile]] — cross-reference [[Tech Stack]] for the Supabase Auth setup.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK, default `gen_random_uuid()` |
| email | text | unique |
| name | text | nullable |
| intercom_admin_id | text | nullable — maps the agent to their Intercom admin/teammate id |
| timezone | text | nullable |
| created_at | timestamptz | default `now()` |
| google_token | text | nullable — Gmail/Calendar OAuth access token |
| google_refresh_token | text | nullable |
| slack_token | text | nullable |
| notion_token | text | nullable — legacy/simple Notion token (see also the MCP-specific columns below) |
| user_id | uuid | nullable, unique, FK → `auth.users.id` |
| avatar_url | text | nullable |
| working_days | integer[] | default `{1,2,3,4,5}` |
| notion_mcp_access_token | text | nullable — hosted Notion MCP OAuth access token, expires ~1h |
| notion_mcp_refresh_token | text | nullable — rotating refresh token, persist atomically on refresh |
| notion_mcp_token_expires_at | timestamptz | nullable — access token expiry (UTC) |
| notion_mcp_refresh_expires_at | timestamptz | nullable — absolute refresh-token expiry (~30 days), does not slide |
| triage_prefs | jsonb | nullable — per-agent triage keyword/filter prefs, see [[Triage System]] |
| tone_preset | text | nullable — `professional`/`warm`/`human`/`custom`, NULL = default generic warmth rule |
| tone_custom | text | nullable — free text, used only when `tone_preset = 'custom'`, capped 500 chars app-side |

**Dropped 2026-08-03** (migration `drop_agents_personal_ai_provider`): `personal_ai_key_enc`, `personal_ai_base_url`, `personal_ai_model`, `personal_ai_aux_model`, `personal_ai_enabled`. These backed the per-agent "Personal AI key" feature, removed when Fanvue provisioned a single org OpenAI key for the whole app — the model is now an env var, not a per-agent setting. See [[Draft Verify Pipeline]].

**Read/write:** `lib/auth.ts`, `lib/agent.ts`, `lib/agent-tone.ts`, `lib/drafts.ts`, `lib/automation/*.ts`, `lib/triage/store.ts`, `lib/notion-mcp-auth-server.ts`; API routes `app/api/agent/tone`, `app/api/agents`, `app/api/auth/callback`, `app/api/auth/slack/callback`, `app/api/auth/notion/callback`, `app/api/settings/update`, `app/api/cases`, `app/api/reply-queue*`, `app/api/playbook-dismissals`, `app/api/automation/alerts`, `app/api/cron/refresh-metrics`, `app/api/metrics`, `app/api/ai/chat`.

## AI reply pipeline

See [[Draft Verify Pipeline]] and [[System Prompt Architecture]] for how these tables feed the drafting/verification flow.

### `suggested_replies`

Precomputed AI reply suggestions for the autonomous non-read reply queue (migrations `suggested_replies` / `suggested_replies_meta` / `0027_suggested_replies_on_request`). Service-role writes come from the background pipeline; owner-scoped reads come from the queue API, which reconciles cached rows against the live Intercom non-read set. Strictly draft-only — nothing here is ever auto-sent or auto-assigned. A partial unique index, `suggested_replies_one_pending_per_conversation` (`WHERE status = 'pending'`), enforces at most one live pending row per conversation; superseding an old row and inserting the new one is done as an explicit two-step in `lib/reply-queue-store.ts`, not as a DB transaction.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| intercom_conversation_id | text | not unique alone (uniqueness is scoped to `status='pending'` via the partial index) |
| owner_id | uuid | nullable, FK → `agents.id`. NULL = unassigned shared pool (cheap precompute only: gate + risk band, no Notion) |
| body | text | default `''` |
| justification | text | default `''` |
| sources | jsonb | default `[]` |
| confidence | numeric | nullable |
| gate_reason | text | nullable |
| risk_band | text | default `'ready'`, check `ready \| needs_check \| low_confidence` — needs_check = capability gap (payout/KYC/media/ban), send locked; low_confidence = weak gate+Notion, review carefully but not locked |
| status | text | default `'pending'`, check `pending \| approved \| superseded \| stale` |
| supersedes | uuid | nullable, FK → self (`suggested_replies.id`) |
| created_at | timestamptz | default `now()` |
| updated_at | timestamptz | default `now()` |
| customer_name | text | nullable — display name at compute time |
| subject | text | nullable — conversation subject/first-message snippet at compute time |
| on_request | boolean | default `false` — true when the agent triggered generation on demand (Inbox "Generate"/"Generate all"); on-request rows are durable and never staled by non-read reconciliation |
| playbook_id | uuid | nullable, FK → `playbooks.id` |

**Read/write:** `lib/reply-queue-store.ts` (all reads/writes), `lib/reply-queue-pipeline.ts`, `lib/reply-queue.ts`, `lib/on-request-drafts.ts`; `app/api/reply-queue/route.ts`, `app/api/reply-queue/for-conversation/route.ts`.

### `reply_queue_attempts`

Dedup marker written at the very start of the drafting pipeline, before the (multi-second) LLM call, so the backfill guard can skip conversations that are in-flight or that keep failing — not just ones that already produced a `suggested_replies` row. This closes the "regenerated dozens of times" bug (see [[Reply-queue over-generation fix]] / project notes). **Correction vs. the original briefing:** this table has only two columns, no `id` or `attempt_id`; the primary key is the conversation id itself.

| Column | Type | Notes |
|---|---|---|
| intercom_conversation_id | text | PK |
| attempted_at | timestamptz | default `now()`, upserted on conflict |

**Read/write:** `lib/reply-queue-store.ts` (`recordSuggestionAttempts`, `getRecentlyTouchedConversationIds`) only.

### `reply_queue_events`

Audit log of human decisions on reply-queue suggestions (migration `reply_queue_events`, extended by `reply_queue_events_feedback_bodies`). One row per approve/edit/reject/assign action. Used for approval/edit/reject metrics; the AI never writes customer-visible actions from this table — it's a downstream record only.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| suggestion_id | uuid | nullable, FK → `suggested_replies.id` |
| intercom_conversation_id | text | not null |
| agent_id | uuid | nullable, FK → `agents.id` |
| action | text | check `approve \| edit \| reject \| assign` |
| risk_band | text | nullable, check `ready \| needs_check \| low_confidence` — band at decision time |
| gate_reason | text | nullable |
| body_changed | boolean | default `false` |
| created_at | timestamptz | default `now()` |
| suggested_body | text | nullable — added by `reply_queue_events_feedback_bodies` |
| final_body | text | nullable — only populated for `approve`/`edit` |
| confidence | numeric | nullable |
| playbook_id | uuid | nullable, FK → `playbooks.id` |

**Read/write:** `lib/reply-queue-store.ts` (`getReplyQueueMetrics`, `logReplyQueueEvent`) only.

### `cases`

**Correction vs. the original briefing:** this is not legacy or speculative — it is an actively-used, per-Intercom-conversation metadata row keyed by `intercom_conversation_id` (unique). It has two live producers: (1) `lib/drafts.ts::persistDraft()`, the manual "save draft" path, which upserts a `cases` row and then versions a `drafts` row under it; and (2) the automation engine (`lib/automation/actions.ts`, `context.ts`, `runner.ts`, `webhook.ts`, `prestage.ts`, `rules.ts`), which upserts/reads a `cases` row per conversation to store rule-set state — `auto_tags` (tags written by our own rule actions, distinct from Intercom's native tags) and `priority_hint` (distinct from Intercom's native `priority`). `needs_attention_at` is set by a rule action that schedules a future check.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| intercom_conversation_id | text | nullable, unique |
| customer_name | text | nullable |
| playbook_id | uuid | nullable, FK → `playbooks.id` |
| owner_id | uuid | nullable, FK → `agents.id`, indexed (`cases_owner`) |
| outcome | text | nullable, check `good \| bad` |
| embedding | vector | nullable — pgvector column, not currently read by any grepped lib/API code (TODO: verify producer/consumer) |
| resolved_at | timestamptz | nullable |
| created_at | timestamptz | default `now()` |
| priority_hint | text | nullable, check `urgent \| normal \| low` — our automation engine's priority, not Intercom's |
| auto_tags | text[] | default `{}` — tags added by our own automation rule actions |
| needs_attention_at | timestamptz | nullable — set by a rule action, read to resurface a case later |

**Read/write:** `lib/drafts.ts`, `lib/automation/actions.ts`, `lib/automation/context.ts`, `lib/automation/runner.ts`, `lib/automation/webhook.ts`, `lib/automation/prestage.ts`, `lib/automation/rules.ts`; `app/api/playbook-dismissals/route.ts`, `app/api/automation/rules/[id]/run/route.ts`. (`app/api/cases/route.ts` itself does not query the `cases` table — it serves the open-cases queue straight from Intercom via `lib/intercom.ts`.)

### `drafts`

**Correction vs. the original briefing:** not legacy — this is the current storage for the explicit "Save Draft" feature (as opposed to the always-on `suggested_replies` queue). Each save creates a new version row scoped to a `cases` row; `(case_id, version)` is unique. Surfaced on the Drafts/history page (`app/drafts`) via `getSavedDrafts()`.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| case_id | uuid | FK → `cases.id`, unique together with `version` |
| version | integer | default `1` |
| reply_body | text | not null |
| next_steps | text | nullable |
| sources | text | nullable — plain text here (unlike `suggested_replies.sources`, which is jsonb) |
| created_at | timestamptz | default `now()` |

**Read/write:** `lib/drafts.ts` (`persistDraft`, `getDraftForConversation`, `getSavedDrafts`); `lib/automation/prestage.ts` reads it for prestaged context.

### `playbooks`

Support case response templates / decision trees that ground AI drafts and populate the Playbooks page. See [[Playbook decision-tree format]] and [[Draft Verify Pipeline]]. Fetched via `lib/playbooks.ts::getPlaybooksDashboardData()`.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| case_type | text | unique |
| aliases | text[] | default `{}` |
| status | text | default `'draft'`, check `draft \| reviewed` |
| last_validated | date | nullable |
| source | text | nullable |
| recognize | text | nullable |
| checks | text | nullable |
| resolution | text | nullable |
| dos_donts | text | nullable |
| embedding | vector | nullable — pgvector column for similarity search (not in the original briefing) |
| created_at | timestamptz | default `now()` |
| updated_at | timestamptz | default `now()` |
| requires_manual_action | boolean | default `false` — added by `add_requires_manual_action_to_playbooks`; forces a matched suggestion to `needs_check` (send locked) because a manual system step is required first, e.g. a Triple-A resend. See [[Payout transition playbooks]] notes. |

**Read/write:** `lib/playbooks.ts` (`getPlaybooksDashboardData`); consumed by the draft/verify prompt builders — see [[System Prompt Architecture]].

### `responses`

Example response templates per playbook, injected into the draft prompt as style references.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| title | text | not null |
| body | text | not null |
| language | text | default `'en'` — **not in the original briefing** |
| playbook_id | uuid | nullable, FK → `playbooks.id` |
| created_at | timestamptz | default `now()` |

**Read/write:** `lib/playbooks.ts` only (grepped `from("responses")`).

## Canvas / tools

See [[Canvas Workflow]] and [[Tool Cards and Fadmin]].

### `case_tools`

Canvas tool card definitions (link-out cards to Fadmin, Ondato, etc). Migration `canvas_tools`.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| icon | text | nullable |
| url_template | text | not null — supports placeholder substitution, see [[Tool Cards and Fadmin]] |
| group_name | text | nullable |
| sort_order | integer | default `0` |
| is_active | boolean | default `true` |
| created_at | timestamptz | default `now()` |

**Read/write:** `lib/case-tools-db.ts`; `app/api/case-tools/route.ts`, `app/api/case-tools/[id]/route.ts`.

### `case_tool_tags`

Pivot table tagging tool cards (e.g. by conversation topic) for filtering/matching.

| Column | Type | Notes |
|---|---|---|
| tool_id | uuid | part of composite PK, FK → `case_tools.id` |
| tag | text | part of composite PK |

**Read/write:** `app/api/case-tools/route.ts`, `app/api/case-tools/[id]/route.ts`.

## Automation

See [[Automation Rules Engine]] and [[Notifications]].

### `automation_rules`

User-defined trigger/monitor rules (migration `0007_automation`, extended by `0008_automation_case_fields`).

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| owner_id | uuid | FK → `agents.id` |
| name | text | not null |
| description | text | nullable |
| kind | text | check `trigger \| monitor` |
| enabled | boolean | default `false` |
| priority | integer | default `100` |
| conditions | jsonb | default `{"match":"any","groups":[]}` — condition tree |
| actions | jsonb | default `[]` — action list |
| sweep_every_mins | integer | nullable — poll interval for `monitor` rules |
| on_events | text[] | nullable — webhook event names for `trigger` rules |
| created_at | timestamptz | default `now()` |
| updated_at | timestamptz | default `now()` |

**Read/write:** `lib/automation/webhook.ts`, `lib/automation/runner.ts`, `lib/automation/rules.ts`; `app/api/automation/rules/[id]/run/route.ts`.

### `automation_alerts`

Pending in-app + Slack alerts raised by rule actions. **Correction vs. the original briefing:** there is no `owner_id`, `conversation_id`, `action_kind`, or boolean `read` column — the actual columns are `case_id` (not a raw conversation id), `kind` (not `action_kind`), and `read_at` (a nullable timestamp, not a boolean). A `(rule_id, case_id, kind)` upsert with `ignoreDuplicates: false` avoids duplicate alerts for the same rule/case/kind.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| rule_id | uuid | FK → `automation_rules.id` |
| case_id | uuid | nullable, FK → `cases.id` |
| kind | text | check `alert.in_app \| alert.slack` |
| body | text | not null — rendered from a rule-action template |
| read_at | timestamptz | nullable — set when the agent dismisses/reads the alert |
| created_at | timestamptz | default `now()` |

**Read/write:** `lib/automation/actions.ts`; `app/api/automation/alerts/route.ts`.

### `automation_runs`

Audit log of rule executions (sweep or manual). **Correction vs. the original briefing:** there is no `triggered_at`, `case_count`, or `errors` column — the actual shape records one row per rule-per-conversation evaluation, not one row per sweep.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| rule_id | uuid | FK → `automation_rules.id` |
| case_id | uuid | nullable, FK → `cases.id` |
| intercom_conversation_id | text | nullable |
| matched | boolean | not null — whether the rule's conditions matched this conversation |
| actions_taken | jsonb | default `[]` |
| context | jsonb | nullable |
| ran_at | timestamptz | default `now()` |
| source | text | default `'sweep'`, check `sweep \| manual` |

**Read/write:** `lib/automation/webhook.ts`, `lib/automation/runner.ts`; `app/api/automation/rules/[id]/run/route.ts`. `runner.ts` also reads `(rule_id, ran_at)` filtered to `source='sweep'` to throttle interval-based monitor rules.

### `triage_items`

Unassigned-conversation pool, replaced wholesale on each sweep (`replaceTriagePool()` in `lib/triage/store.ts`; `prune=true` on a full sweep, `false` on a partial one). Migration `triage_items_and_prefs`. See [[Triage System]]. **Correction vs. the original briefing:** the primary key is `intercom_conversation_id` itself — there is no separate `id` column.

| Column | Type | Notes |
|---|---|---|
| intercom_conversation_id | text | PK |
| subject | text | nullable |
| customer_name | text | nullable |
| snippet | text | nullable |
| tags | text[] | default `{}` |
| priority | boolean | default `false` |
| sla_status | text | nullable |
| waiting_since | timestamptz | nullable |
| conversation_created_at | timestamptz | nullable |
| admin_assignee_id | text | nullable |
| matched_playbook_id | uuid | nullable, FK → `playbooks.id` |
| matched_playbook_name | text | nullable — denormalized copy of the playbook name at match time |
| match_score | numeric | nullable |
| capability_gap | boolean | default `false` |
| swept_at | timestamptz | default `now()` |

**Read/write:** `lib/triage/store.ts` only.

## Misc

### `settings`

Global key/value store, RLS-protected. Confirmed keys currently present include `desktop_download_url`, `drive_model_folder_convention`, `intercom_admin_id`, `intercom_app_id`, `kb_conflicts`, `missed_threshold_minutes`, `notion_kb_roots`, `notion_mcp_client`, `slack_channels` (array of Slack channel IDs to monitor — see [[Slack Integration]]), `supabase_project_id`, `timezone`, `triage_sweep_status`.

| Column | Type | Notes |
|---|---|---|
| key | text | PK |
| value | jsonb | not null |
| updated_at | timestamptz | default `now()` |

**Read/write:** `lib/triage/store.ts`, `lib/desktop-download.ts`, `lib/slack.ts`, `lib/notion-mcp-client-store.ts`; `app/api/settings/update/route.ts`.

## Other tables present in the database but outside the original briefing's scope

These exist in the live schema but weren't part of the 14-table survey this page was built from. Listed here for completeness, not documented in full detail (TODO: verify column types and callers if this page needs to cover them):

- **improvements** — `id, playbook_id, case_id, what_changed, why, created_at`. Currently empty (0 rows). Looks like a planned playbook-improvement changelog tied to `cases`/`playbooks`.
- **metrics_cache** — `id, agent_id, start_date, end_date, data (jsonb), created_at`. FK to `agents`; used by `app/api/cron/refresh-metrics` and `app/api/metrics` (per the `agents` grep results above) to cache computed metrics per agent/date-range.
- **playbook_dismissals** — `id, case_id, playbook_id, reason, created_at`. Read/written by `app/api/playbook-dismissals/route.ts` — lets an agent dismiss a suggested playbook match for a case.
- **gmail_templates** — `id, name, recipient, subject, body, created_at, updated_at, cc, access_emails`. See [[Gmail Integration]].
- **gmail_sent_emails** — `id, template_id (FK), template_name, recipient, user_email, subject, body, gmail_message_id, gmail_thread_id, sent_by, created_at, cc, visibility`. See [[Gmail Integration]].
- **intercom_macros** — `id, intercom_id (unique), name, body, body_text, visibility, intercom_updated_at, raw (jsonb), created_at, updated_at`. Migration `intercom_macros`; a local cache/mirror of Intercom's macro library. See [[Intercom Integration]].

## Related pages

[[Tech Stack]] · [[Auth and Session]] · [[Draft Verify Pipeline]] · [[System Prompt Architecture]] · [[Triage System]] · [[Automation Rules Engine]] · [[Notifications]] · [[Canvas Workflow]] · [[Tool Cards and Fadmin]] · [[Intercom Integration]] · [[Gmail Integration]] · [[Slack Integration]] · [[Notion MCP Integration]] · [[Settings and Profile]]
