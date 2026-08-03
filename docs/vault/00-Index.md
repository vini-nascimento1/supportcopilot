---
title: Index
tags: [moc, index]
updated: 2026-07-29
---

# Support Copilot — Vault Index

Map of content for the Support Copilot documentation vault. Open this folder (`docs/vault/`) as an Obsidian vault to get wikilink navigation, graph view, and backlinks between the pages below.

This vault documents **how the app works**, not what to do on any given ticket — for support playbooks and macros, see the app's own Playbooks page and Supabase `playbooks`/`responses` tables (see [[Database Schema Reference]]).

## Architecture

- [[Tech Stack]] — framework, dependencies, directory layout, build/deploy
- [[Auth and Session]] — Supabase Auth, Google Workspace SSO, session refresh

## Canvas (the core case workspace)

- [[Canvas Workflow]] — React Flow board, sidebar tabs (Inbox/Queue/Triage), hotkeys, pinned cards
- [[Tool Cards and Fadmin]] — embedded external tools (Fadmin, ONDATO, MassPay), URL templating, suggestion engine

## AI Pipeline

- [[Draft Verify Pipeline]] — the three drafting paths, verifier flow, models/routing, reliability
- [[System Prompt Architecture]] — why the prompt is layered the way it is, tone presets

## Integrations

- [[Intercom Integration]] — the central data source: conversations, webhooks, reply sending
- [[Triage System]] — the unassigned-conversation sweep and ranking
- [[Gmail Integration]] — quick send, templates, unread summaries
- [[Slack Integration]] — agent notifications, channel feed, automation posting
- [[Notion MCP Integration]] — knowledge base retrieval via hosted MCP

## Database

- [[Database Schema Reference]] — every table, verified against live Supabase, with readers/writers per table

## Settings & Automation

- [[Settings and Profile]] — the agent-facing settings page (Profile / Canvas / AI & Drafting columns)
- [[Automation Rules Engine]] — user-defined trigger/monitor rules, condition trees, actions
- [[Notifications]] — the global notification bell (now the single home for automation alerts too) vs. sonner toasts

## Other docs in this repo (not part of the Obsidian vault)

- `docs/intercom-admins.md` — roster of Fanvue support agents' Intercom admin IDs + ticket-count query recipes (internal staff data, kept out of the vault deliberately)
- `docs/plans/` — point-in-time planning docs for past features

## Keeping this vault current

When you ship a new subsystem or materially change an existing one, add or update its page here rather than letting the vault drift from the code. See `/AGENTS.md` or `/CLAUDE.md` at the repo root for the full documentation policy.
