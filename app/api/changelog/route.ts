import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

export type ChangelogEntry = {
  id: string
  date: string
  title: string
  description: string
}

// Seed entries — used as fallback when the DB table hasn't been created yet.
// Keeps the feature working immediately. Once the migration is applied, DB
// data takes precedence and this is the source of truth for new entries.
const SEED_ENTRIES: ChangelogEntry[] = [
  {
    id: "seed-2026-07-09-a",
    date: "2026-07-09",
    title: "The app is noticeably faster — Canvas, Gmail, and page switching",
    description:
      "Fixed several things that were adding real delay: opening a case's Canvas no longer waits on an AI classification call before it can even render (the playbook match now loads in after), background Canvas tabs stopped silently re-polling Intercom every 15-30 seconds while hidden, every page navigation was doing duplicate sign-in checks, and the Sent Tracker was pulling every column (including the full email body) with no row limit. Canvas loading and page switching should feel noticeably snappier.",
  },
  {
    id: "seed-2026-07-08-a",
    date: "2026-07-08",
    title: "Stuck \"Drafting…\" cards now recover instead of hanging",
    description:
      "AI draft generation could hang indefinitely if the AI router was rate-limited or slow, leaving the Queue's \"Drafting…\" placeholder stuck for up to 20 minutes. Generation now has proper timeouts, retries, and a shared throttle so a bulk \"Generate AI replies\" run no longer floods the router. A manual draft that still doesn't land within 4 minutes now flips to a \"Couldn't draft\" card with Retry / Dismiss instead of hanging.",
  },
  {
    id: "seed-2026-07-08-b",
    date: "2026-07-08",
    title: "AI drafts never use the customer's real name or a personal sign-off",
    description:
      "Draft replies now withhold the customer's real legal name/email (their Intercom contact record, not their Fanvue alias) from every AI prompt, and the model is blocked from signing off with any personal name — fixes occasional replies that leaked the wrong agent's name.",
  },
  {
    id: "seed-2026-07-07-a",
    date: "2026-07-07",
    title: "Bulk delete in the Sent Tracker",
    description:
      "Select multiple sent emails with checkboxes (or select-all) and delete them in one action, alongside the existing single-row remove. Only your own tracker rows are selectable — shared entries from teammates stay visible but aren't yours to delete. The Gmail messages themselves are never touched.",
  },
  {
    id: "seed-2026-07-07-b",
    date: "2026-07-07",
    title: "Payout cases needing a manual step now lock the draft until it's done",
    description:
      "When a matched playbook needs a real system action first (e.g. resending the Triple-A payout email), the AI's suggested reply is now automatically locked (\"needs check\") with a note explaining what to do — so it can't be sent before the manual step actually happens.",
  },
  {
    id: "seed-2026-07-07-c",
    date: "2026-07-07",
    title: "New automation action: stage a fixed macro as a draft, no AI call",
    description:
      "Automation rules can now pre-stage an exact macro (e.g. \"Quick Acknowledgement\") as a review-ready draft instantly, with no AI generation involved — complements the existing AI-generated draft action. Still draft-only: nothing sends without a human clicking Send.",
  },
  {
    id: "seed-2026-07-07-d",
    date: "2026-07-07",
    title: "Automation rules can target First Response Time precisely",
    description:
      "Two new condition-builder fields — admin_replied (has a human actually replied yet, Fin/bot replies excluded) and human_assigned (is a real person on this case, not just Fin) — so SLA rules can target true First Response Time breaches instead of also catching already-answered tickets that are just nearing their close-time SLA.",
  },
  {
    id: "seed-2026-06-22-a",
    date: "2026-06-22",
    title: "Inbox redesign: checkboxes + one bulk-action bar",
    description:
      "The Inbox card list was decluttered down to who + when + a one-line snippet. Select cases with checkboxes (or the master checkbox) and a single contextual bar appears — \"Generate AI replies\" in your Mine box, \"Assign to me\" in the Unassigned/teammate boxes.",
  },
  {
    id: "seed-2026-06-22-b",
    date: "2026-06-22",
    title: "Bulk Close + shift-click range select in the Inbox",
    description:
      "Close multiple cases at once from the Inbox's bulk-action bar, behind a confirm (this is a real Intercom write). Shift-click a checkbox to select the whole range from your last click, same as Gmail or Finder.",
  },
  {
    id: "seed-2026-06-22-c",
    date: "2026-06-22",
    title: "Generate an AI reply on demand for any ticket in your Inbox",
    description:
      "The reply queue only auto-drafted tickets that hadn't been read yet — an already-answered ticket never got a draft unless you opened it and clicked Generate. Now you can request one straight from the Inbox: a per-card Generate button, or a bulk \"Generate AI replies for all N\" bar for your Mine box. These drafts show up in the Queue under a distinct \"On request\" section.",
  },
  {
    id: "seed-2026-06-21-a",
    date: "2026-06-21",
    title: "Work your Intercom inbox without leaving the Canvas",
    description:
      "The Canvas left sidebar now has an Inbox tab alongside the existing AI Queue tab — a live view of Mine / Unassigned / any teammate's open conversations, with one-click \"Assign to me\" and \"open in Canvas\". No more keeping Intercom open in a separate window just to triage.",
  },
  {
    id: "seed-2026-06-21-b",
    date: "2026-06-21",
    title: "AI drafts can now see the images customers send",
    description:
      "When a customer attaches a screenshot or photo, the AI draft now actually looks at it with a vision-enabled model instead of drafting blind from text alone — useful for anything where the picture is the point, like payment errors, ID documents, or bug reports.",
  },
  {
    id: "seed-2026-06-21-c",
    date: "2026-06-21",
    title: "Conversation card redesign — thread, composer, and AI copilot in one place",
    description:
      "The old separate draft/AI/conversation cards on the Canvas are now one unified card: the live thread, the reply composer, the AI menu, and the Copilot panel together, with the same auto-refresh and queue-prefill behaviour as before.",
  },
  {
    id: "seed-2026-06-21-d",
    date: "2026-06-21",
    title: "\"Drafting…\" placeholder cards while the AI writes",
    description:
      "The Queue used to show nothing until a draft was fully generated. Now every ticket being drafted shows an animated \"Drafting a reply for {customer}…\" skeleton card, so you can see AI work in progress instead of wondering if it's stuck.",
  },
  {
    id: "seed-2026-06-19-a",
    date: "2026-06-19",
    title: "Drafts now read your live Notion — connect it in Settings",
    description:
      "Connect Notion in Settings → Integrations and AI reply drafts pull from your live Notion knowledge base (plus Slack, Drive and other connectors) — not just the matched playbook. Works on both playbook and non-playbook cases. Internal/connector content is firewalled out of the customer-facing text. Each agent connects once via 'Connect Notion → Allow' and reconnects roughly monthly.",
  },
  {
    id: "seed-2026-06-19-b",
    date: "2026-06-19",
    title: "Smarter playbook matching — no more wrong-playbook drafts",
    description:
      "The draft no longer force-matches every case onto a playbook. An AI classifier decides which playbook truly applies — or recognises that none does — so cases outside the playbooks stop getting confident-but-wrong drafts (those now fall back to live Notion knowledge). If the classifier is unavailable, it safely falls back to the old keyword matching.",
  },
  {
    id: "seed-2026-06-19-c",
    date: "2026-06-19",
    title: "Case copilot now answers from live Notion",
    description:
      "Ask the Case copilot things like “what’s our policy on X?” and it answers from your live Notion (KB + connectors), on top of the ticket and matched playbooks. Still draft-only — it never sends anything, and never quotes internal sources to a customer.",
  },
  {
    id: "seed-2026-06-19-d",
    date: "2026-06-19",
    title: "Adapt a macro to the case",
    description:
      "New ✨ Adapt button on each macro: instead of pasting the canned text as-is, it rewrites the macro to fit the specific conversation in Fanvue tone, keeping the macro's facts. Shown as a draft to review and copy — never auto-sent. The verbatim Send still works exactly as before.",
  },
  {
    id: "seed-2026-06-14-a",
    date: "2026-06-14",
    title: "Macros on the case canvas",
    description:
      "All Intercom macros are mirrored into the app — search them in the new Macros card, copy the text, or send one straight into the conversation as an admin reply (with a confirm step). Personal/team-specific macros are hidden, so you only see shared ones. Hit the sync button to refresh from Intercom.",
  },
  {
    id: "seed-2026-06-14-b",
    date: "2026-06-14",
    title: "Close a case from the canvas",
    description:
      "The case info card now has a 'Close case' button that closes the Intercom conversation directly (with a confirm). No more switching to Intercom just to wrap up.",
  },
  {
    id: "seed-2026-06-14-c",
    date: "2026-06-14",
    title: "Latest Slack threads on the case card",
    description:
      "The case info card now shows the latest Slack threads mentioning the customer — the same finder from the case sidebar, right where you need it on the canvas.",
  },
  {
    id: "seed-2026-06-14-d",
    date: "2026-06-14",
    title: "Find on page (Ctrl+F) in embedded tools — desktop app",
    description:
      "Press Ctrl/Cmd+F inside any embedded tool card (Fadmin, ONDATO, MassPay…) to search the page, with match counter and next/previous, just like Chrome. Requires the desktop app (v1.1.0+).",
  },
  {
    id: "seed-2026-06-14-e",
    date: "2026-06-14",
    title: "Right-click image → Google Lens — desktop app",
    description:
      "Right-click any image inside an embedded tool to reverse-search it with Google Lens — built for spotting stolen/stock images uploaded to Fanvue. Also copy image, copy address, and search selected text. Requires the desktop app (v1.1.0+).",
  },
  {
    id: "seed-2026-06-09-a",
    date: "2026-06-09",
    title: "Slack Thread Finder — auto-discover internal workflow threads",
    description:
      "When opening a case, the system automatically searches Slack for threads containing the customer's email. Fraud/moderation workflow results appear in a sidebar card with 60s polling. 'Generate draft' reads the full Slack thread and translates internal language into customer-facing wording — without exposing staff names, internal systems, or workflow references.",
  },
  {
    id: "seed-2026-06-09-b",
    date: "2026-06-09",
    title: "AI draft prompt overhaul — context hierarchy & conversation close",
    description:
      "Complete system prompt revision: clear context hierarchy (thread > articles > playbook), rules for closing conversations when the customer keeps insisting after being answered, and a firmer tone for policy and moderation decisions.",
  },
  {
    id: "seed-2026-06-08-b",
    date: "2026-06-08",
    title: "AI error handling overhaul",
    description:
      "All AI tool errors now show friendly messages. Timeout detection, input validation, and fallback summaries if the final response fails.",
  },
  {
    id: "seed-2026-06-08-d",
    date: "2026-06-08",
    title: "Per-agent KPI metrics dashboard",
    description:
      "New Metrics tab with per-agent KPIs: first response time, CSAT score, conversation volume, reassignment rate, and reopen rate. Data sourced from Intercom with 24h cache and nightly cron pre-population.",
  },
  {
    id: "seed-2026-06-08-e",
    date: "2026-06-08",
    title: "Settings page with working days configuration",
    description:
      "Unified settings form for configuring working days. Toggle individual days on/off so metrics divisor reflects actual working days. Cache invalidates automatically on save.",
  },
  {
    id: "seed-2026-06-08-a",
    date: "2026-06-08",
    title: "AI assistant with tool calling",
    description:
      "Floating AI chat for creating, editing, and testing automation rules in natural language. Multi-turn tool calling so the AI can list rules, then act on them.",
  },
  {
    id: "seed-2026-06-08-c",
    date: "2026-06-08",
    title: "Sidebar: avatar photo and New Features dialog",
    description:
      "Profile picture from Google account. Settings and changelog moved below workspace nav. New Features dialog with grouped entries.",
  },
  {
    id: "seed-2026-06-07-a",
    date: "2026-06-07",
    title: "Automation manual run now executes actions",
    description:
      "Run button on monitor rules now sends Slack DMs, in-app alerts, and case flags instead of just counting them. Loading spinner prevents double-clicks.",
  },
  {
    id: "seed-2026-06-07-b",
    date: "2026-06-07",
    title: "Global rules and teammate scoping",
    description:
      "Rules can target specific agents or apply globally across all queues. is_empty condition for unassigned conversations.",
  },
  {
    id: "seed-2026-06-07-c",
    date: "2026-06-07",
    title: "SLA countdown alerts",
    description:
      "first_response_minutes field with per-condition SLA threshold. Alerts before breach instead of after.",
  },
  {
    id: "seed-2026-06-07-d",
    date: "2026-06-07",
    title: "Automation tags split",
    description:
      "Separated Intercom tags from rule-set auto_tags to prevent rule self-loops. Tag picker in the condition builder.",
  },
  {
    id: "seed-2026-06-07-e",
    date: "2026-06-07",
    title: "Template placeholders in action text",
    description:
      "Use {{intercom_url}}, {{customer}}, {{subject}} and other placeholders in alert messages — resolved at execution time.",
  },
  {
    id: "seed-2026-06-07-f",
    date: "2026-06-07",
    title: "Gmail filter bar and bulk actions",
    description:
      "Filter threads by query, sort chronologically (persisted in localStorage). Select-all checkboxes, bulk mark-as-read, bulk trash.",
  },
  {
    id: "seed-2026-06-07-g",
    date: "2026-06-07",
    title: "Draft markdown preview",
    description:
      "AI-generated drafts now render as formatted markdown instead of raw text. Full conversation thread context in drafts.",
  },
  {
    id: "seed-2026-06-07-h",
    date: "2026-06-07",
    title: "Slack app improvements",
    description:
      "Reactions, reply buttons, conversation sorting, workflow message formatting, emoji support, unread count fix, private channel search.",
  },
  {
    id: "seed-2026-06-07-i",
    date: "2026-06-07",
    title: "Dynamic agent names",
    description:
      "Hardcoded 'Vinicius' replaced with database profile lookup across the app.",
  },
  {
    id: "seed-2026-06-07-j",
    date: "2026-06-07",
    title: "Automation engine — triggers & monitors",
    description:
      "Full automation system: monitors (time-swept) and triggers (event-based) with conditions tree, actions, and audit trail.",
  },
  {
    id: "seed-2026-06-06-a",
    date: "2026-06-06",
    title: "Intercom webhook integration",
    description:
      "Real-time case creation from Intercom events. Signature verification, auto-bootstrap owner from environment variable.",
  },
  {
    id: "seed-2026-06-06-b",
    date: "2026-06-06",
    title: "Intercom queue pagination fix",
    description:
      "Fixed 10-case cap — now loads full queue with pagination and live polling. Customer name/email displayed instead of 'Unknown'.",
  },
  {
    id: "seed-2026-06-05-a",
    date: "2026-06-05",
    title: "Slack bot DM landing zone",
    description:
      "Monitor alerts delivered via Slack DM. Troubleshooting guide for DMs landing in the Apps section.",
  },
  {
    id: "seed-2026-06-04-a",
    date: "2026-06-04",
    title: "Gmail compose with reply-to-self fix",
    description:
      "HTML compose form with proper reply-to headers. Fixed layout and reply-to-self issue where sent emails appeared in the wrong thread.",
  },
  {
    id: "seed-2026-06-01-a",
    date: "2026-06-01",
    title: "Multi-tenant audit",
    description:
      "Audited Intercom shared accounts, Google hd:fanvue.com restriction, and hardcoded agent names. Documented multi-tenant blockers.",
  },
]

const FALLBACK_ENTRIES = [...SEED_ENTRIES].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

export async function GET() {
  const db = getSupabaseAdminClient()

  if (!db) {
    // No DB at all — return seed data so the feature works offline / on first deploy.
    return NextResponse.json({ entries: FALLBACK_ENTRIES })
  }

  const { data, error } = await db
    .from("changelog")
    .select("id, date, title, description")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })

  // If table doesn't exist yet (PGRST301) or any other issue, fall back to seed.
  if (error) {
    return NextResponse.json({ entries: FALLBACK_ENTRIES })
  }

  // Merge: DB data + seed entries not yet in the DB, deduplicated by title.
  const dbTitles = new Set(data.map((e) => e.title))
  const merged = [
    ...(data as ChangelogEntry[]),
    ...SEED_ENTRIES.filter((s) => !dbTitles.has(s.title)),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

  return NextResponse.json({ entries: merged })
}
