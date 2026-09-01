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
    id: "seed-2026-09-01-i",
    date: "2026-09-01",
    title: "Home clears itself when you read things elsewhere",
    description:
      "If you already read a Slack mention in Slack, or opened an email in Gmail, Home notices and takes it off your list on the next load. No more dismissing things you have plainly seen. Only mentions you could have seen in the channel count; a reply buried in a thread stays until you deal with it.",
  },
  {
    id: "seed-2026-09-01-j",
    date: "2026-09-01",
    title: "Snooze anything on Home",
    description:
      "Not now, but not never. Hover a row and hit the clock (or open the row on your phone and tap Snooze) to push it to later today, tomorrow morning or next Monday. It disappears until then and comes back on its own. Undo is in the toast, same as dismiss.",
  },
  {
    id: "seed-2026-09-01-k",
    date: "2026-09-01",
    title: "Needs you now is sorted by what you have to do",
    description:
      "The list is now split into Reply (customers waiting on a ticket reply), Answer (colleagues asking you something in Slack) and Decide (emails and workflow posts that need a call from you), so you can clear one kind of work at a time.",
  },
  {
    id: "seed-2026-09-01-l",
    date: "2026-09-01",
    title: "Only real asks reach Needs you now",
    description:
      "A Slack mention gets into Needs you now only when the message actually asks you something; a cc for visibility goes to the Slack digest instead. Emails count only when they come from a payout or KYC partner or clearly ask for an action or approval; newsletters and automated notifications stay out of the way in the email digest.",
  },
  {
    id: "seed-2026-09-01-h",
    date: "2026-09-01",
    title: "Dismiss what you have already handled on Home",
    description:
      "Home now remembers what you are done with. Swipe a row left on your phone, or hover it on a laptop and hit the X, and it goes — with an Undo in the corner for a few seconds if you change your mind. Clear all empties the whole \"Needs you now\" list in one go. Acting on something clears it too: send or reject a draft, send a Slack answer, or open the ticket, thread or email at the source, and Home takes it off your list. The counts at the top update as you go. Home also looks back further now — up to a week — so after a weekend or a few days off you get everything you missed in one read instead of just yesterday.",
  },
  {
    id: "seed-2026-09-01-g",
    date: "2026-09-01",
    title: "Calmer status labels on Home and in the Queue",
    description:
      "The coloured text pills (green, amber, red) are gone. Every label is now a quiet grey tag with a small dot only where colour actually means something: green for a draft that is ready, amber for one that is locked until a fadmin check, red only when a source is down. Kinds like Email or Mention show a small icon instead of a coloured word, and unread Slack or email rows get a plain dot rather than a badge.",
  },
  {
    id: "seed-2026-09-01-e",
    date: "2026-09-01",
    title: "The reply queue works on your phone",
    description:
      "Reviewing drafts used to mean opening Canvas on a desktop. There is now a Queue page in the sidebar and in the bottom bar on a phone, with the same drafts split into Ready to send, Needs your check and On request. Tap one to read it, edit it if you want, and approve it with a confirmation step before anything reaches the customer. Drafts that need a fadmin check are marked Locked and explain why; you can still send them from your phone once you have done the check, through a stricter confirmation that asks you to say so. fadmin and the Canvas are the only parts that still need the desktop app. Unassigned tickets show an Assign to me button first, same as in Canvas.",
  },
  {
    id: "seed-2026-09-01-d",
    date: "2026-09-01",
    title: "Bottom navigation on phones",
    description:
      "On a phone the sidebar is replaced by a bottom bar with Home, Cases, Queue and More. Canvas is desktop-only, so it stays out of the way on small screens, and page headers no longer overflow sideways.",
  },
  {
    id: "seed-2026-09-01-c",
    date: "2026-09-01",
    title: "Home replaces the Dashboard",
    description:
      "The dashboard showed you five cards of counts and left the reading to you. Home opens with what actually needs you — tickets past the first-reply target, a colleague's question in Slack, an email waiting on a decision — as one short read at the top, then the same items as a list you open one at a time. Each one already carries the work: the drafted reply for a ticket, a researched answer for a Slack question with the sources it came from, a plain summary for anything about money. You approve, edit or dismiss it right there, and a draft that needs a fadmin check stays locked exactly like it does in the Queue. Nothing is sent without your tap. Down the right you get the rest of your day: today's meetings, the Slack you missed (only mentions, DMs and threads you're in), and the few emails worth your time. The draggable card grid is gone.",
  },
  {
    id: "seed-2026-09-01-a",
    date: "2026-09-01",
    title: "Your agent name is now separate from your Google name",
    description:
      "Replies, greetings, and quick-send emails used to greet customers with your Google account name, even if that's not what you go by, and it would quietly overwrite anything different you'd typed in Settings. There's now a separate \"Agent name (customers see this)\" field on Settings > Profile with a live preview of the greeting, so you control exactly what customers see. Your Google name stays internal, for the sidebar and teammates only. If you haven't set one yet, you'll be asked to pick a name once before your next reply goes out.",
  },
  {
    id: "seed-2026-08-30-c",
    date: "2026-08-30",
    title: "Drafts answer the question instead of listing what they can't check",
    description:
      "When a draft couldn't look something up in Fadmin, it would sometimes reply with the lookup it couldn't do — \"I'm unable to verify your account classification, eligibility flags or rollout status\" — and hand the ticket to \"the technical team\", even when the real explanation was sitting in the playbook or knowledge base. That's the most robotic thing a reply can say, and the customer can't act on any of it. Drafts now lead with what we actually know: how the feature works, what really gates it, which assumption is wrong, and what won't fix it. A genuine gap gets one short clause, not the whole message. Drafts also stop repeating a customer's own questions back as a list of things that \"need verifying\".",
  },
  {
    id: "seed-2026-08-30-a",
    date: "2026-08-30",
    title: "Pages that lean on playbooks open faster",
    description:
      "Every draft, every playbook match on the canvas and every page load was re-downloading the whole playbook library from scratch — the same unchanged content, thousands of times a day. It's now held for a few minutes at a time and reused, so those screens open quicker. One thing to know if you edit a playbook directly in the database: your change can take up to five minutes to show up in the app instead of appearing instantly.",
  },
  {
    id: "seed-2026-08-22-c",
    date: "2026-08-22",
    title: "The queue clears out drafts for tickets you've already handled",
    description:
      "Drafts for conversations you'd already answered or closed were only cleared while you had the Queue tab open, so they piled up in the background — thousands of them. Because the queue only tracks your most recent 200 drafts, a big enough pile could push a real, still-waiting draft out of view and cause the same ticket to be drafted twice. The background sweep now retires those finished drafts on its own, whether or not the tab is open. Drafts you generated yourself from the Inbox stay put, as before.",
  },
  {
    id: "seed-2026-08-22-a",
    date: "2026-08-22",
    title: "Refund drafts give the answer instead of promising a review",
    description:
      "A fan asking for their money back with no problem attached used to get \"I'll review your refund request and update you here\" — a review nobody was ever going to run, leaving them waiting for a reversal that wasn't coming. Drafts now give the no warmly and up front, add the cancellation steps when that's what they also asked for, and never suggest which reasons might have qualified. If they do arrive with a real problem and evidence for it, the playbook still applies as before.",
  },
  {
    id: "seed-2026-08-18-b",
    date: "2026-08-18",
    title: "Drafts are shorter and stop padding",
    description:
      "Looking at a month of your edits, 85% of the time you shortened the draft before sending, usually by cutting an unnecessary \"could you confirm...\", a screenshot request, or a hedge. The draft rules now say plainly that a two-line reply is finished work, and that a rule about formatting is never a reason to add an extra question or step. Drafts should arrive closer to what you'd actually send.",
  },
  {
    id: "seed-2026-08-18-a",
    date: "2026-08-18",
    title: "Drafts confirm the answer instead of arguing with it",
    description:
      "When a customer asked to confirm something they'd already been told (\"so I just wait and the money comes back, right?\"), the draft would contradict the agent who answered, decide the case needed checking after all, and ask for card digits or dates it didn't need. Drafts now lead with the direct answer, confirm it in a line or two, and close the conversation — and they never overturn an answer you already gave in the thread.",
  },
  {
    id: "seed-2026-08-15-r",
    date: "2026-08-15",
    title: "You can see at a glance which drafts are locked",
    description:
      "Drafts waiting on a fadmin check are skipped by bulk send, but nothing marked them unless you opened the row — so selecting 6 and being offered \"Approve & send 3\" looked like a glitch. Locked drafts now carry a \"needs check\" badge in the list, and the selection bar shows how many of your selected drafts are locked.",
  },
  {
    id: "seed-2026-08-15-p",
    date: "2026-08-15",
    title: "Embedded tools keep your place when you switch tabs",
    description:
      "Switching workspace tabs and coming back used to reset an embedded tool (Fadmin, ONDATO…) to its starting page, losing wherever you'd navigated — while the address bar still showed the old deep link. Tools now reopen exactly where you left them, and pinned cards also adapt correctly when you resize the window instead of drifting off-screen.",
  },
  {
    id: "seed-2026-08-15-k",
    date: "2026-08-15",
    title: "Bulk assign asks before grabbing tickets",
    description:
      "Ctrl+Enter in the Inbox used to instantly assign (or draft for) everything selected — one stray keystroke after a select-all could claim every unassigned ticket in the workspace. It now arms a confirm first, exactly like the Queue's bulk send: press again (or click) to run it.",
  },
  {
    id: "seed-2026-08-12-f",
    date: "2026-08-12",
    title: "Drafts hold firm when a customer just repeats the same demand",
    description:
      "When a customer had already been given a final answer (e.g. a refund decline) and pushed back with the same demand again, just louder, drafts could treat an incidental detail in that message as a new fact worth reinvestigating and reopen the case instead of closing it. Drafts now recognise a restated demand for what it is and hold the decision unless the customer actually provides something new.",
  },
  {
    id: "seed-2026-08-03-f",
    date: "2026-08-03",
    title: "Ask the AI Assistant how the app itself works",
    description:
      "It now knows Support Copilot end to end — why canvas layouts don't save, why a pinned Fadmin card follows you between cases, what the risk badge on a Queue card means, why a draft is worded the way it is, what you need to connect for knowledge search to work. Ask it instead of hunting for someone who knows.",
  },
  {
    id: "seed-2026-08-03-d",
    date: "2026-08-03",
    title: "Dismiss all your notifications in one click",
    description:
      "The notification bell now has a \"Dismiss all\" button at the top. It empties the list and clears any toasts still floating on screen, and anything that came from an automation rule is marked read so it won't come back.",
  },
  {
    id: "seed-2026-08-03-c",
    date: "2026-08-03",
    title: "Automation alerts now ring the notification bell",
    description:
      "When one of your rules matches — an SLA breach, a ticket sitting too long — you get a real notification: the bell badge lights up and a toast pops, wherever you are in the app. Click it to jump straight to the conversation. Unread alerts stick around until you actually read them, even after a refresh.",
  },
  {
    id: "seed-2026-08-03-b",
    date: "2026-08-03",
    title: "The Automation \"Alerts\" tab is gone",
    description:
      "It was a page you had to remember to visit, which defeated the point of an alert. Everything it showed now arrives in the notification bell instead. The Automation page is just your rules now.",
  },
  {
    id: "seed-2026-08-03-a",
    date: "2026-08-03",
    title: "Every AI draft now runs on a newer, sharper model",
    description:
      "Drafts, the Case copilot, the AI Assistant, screenshot reading and the playbook matcher all moved onto the latest GPT-5.6 Luna model. Expect better reasoning on tricky tickets and fewer garbled screenshot readings.",
  },
  {
    id: "seed-2026-07-29-n",
    date: "2026-07-29",
    title: "Ask the AI Assistant a knowledge question without a ticket",
    description:
      "Previously the only way to search your Notion/knowledge base through the AI Assistant was to attach a specific Intercom ticket. Now you can just ask — \"what does our W-8BEN article say?\" — with no ticket needed.",
  },
  {
    id: "seed-2026-07-29-l",
    date: "2026-07-29",
    title: "Clearer error when the AI Assistant can't reach Notion",
    description:
      "If a ticket research or draft request can't search your knowledge base, the AI Assistant now says specifically why (not connected, connection expired, or the search itself failed) instead of a generic \"couldn't reach it.\"",
  },
  {
    id: "seed-2026-07-29-k",
    date: "2026-07-29",
    title: "Start a new AI Assistant conversation",
    description:
      "New icon in the AI Assistant's header clears the current conversation so you can start fresh — also doubles as a cancel button if a research reply is taking too long.",
  },
  {
    id: "seed-2026-07-29-j",
    date: "2026-07-29",
    title: "AI Assistant shows what it actually checked",
    description:
      "Replies from the AI Assistant now end with a short \"Checked:\" line listing what it actually looked at (playbooks, your open cases, a ticket + knowledge base, etc.) — so you know it's grounded, not just prose.",
  },
  {
    id: "seed-2026-07-29-g",
    date: "2026-07-29",
    title: "AI Assistant can now draft the customer reply too",
    description:
      "After looking into a ticket, ask it to draft the reply — it runs through the same generation and fact-checking pipeline as the rest of the app, so it's grounded and safe to review. It never sends anything on its own; you still copy it in and send it yourself.",
  },
  {
    id: "seed-2026-07-29-f",
    date: "2026-07-29",
    title: "AI Assistant can now research a specific ticket for you",
    description:
      "Paste an Intercom ticket into the AI Assistant and ask it to look into something — it reads the full thread and searches your connected Notion, Slack, Linear, and Drive for anything relevant, citing what it finds. This is deliberately slower than its other answers, since it's doing real research instead of a quick lookup.",
  },
  {
    id: "seed-2026-07-29-e",
    date: "2026-07-29",
    title: "AI Assistant can now look up playbooks and your open cases",
    description:
      "Beyond building automation rules, ask it things like \"what playbook covers a stuck KYC?\" or \"how many of my open cases are missing SLA?\". It also now asks for a plain Yes/No confirmation before it actually creates, edits, or deletes a rule — nothing writes without you approving it first.",
  },
  {
    id: "seed-2026-07-29-a",
    date: "2026-07-29",
    title: "Google sign-in now only asks for permission once",
    description:
      "Every login used to re-show Google's full permissions screen, even after you'd already approved it. Now that only happens the first time you sign in on a device — after that, signing back in skips straight past it.",
  },
  {
    id: "seed-2026-07-29-b",
    date: "2026-07-29",
    title: "A real notification bell, not just fading toasts",
    description:
      "New bell icon in the top-right corner of every page. New notifications pop up briefly and fade on their own, but nothing's lost — click the bell any time to see recent history, dismiss one, or clear them all.",
  },
  {
    id: "seed-2026-07-29-c",
    date: "2026-07-29",
    title: "Settings reorganized into tabs",
    description:
      "Settings was one long scroll. It's now split into four tabs — Profile, Canvas, AI & Drafting, and Integrations — so it's easier to find the one setting you actually came to change.",
  },
  {
    id: "seed-2026-07-09-a",
    date: "2026-07-09",
    title: "The app is noticeably faster — Canvas, Gmail, and page switching",
    description:
      "Fixed several things that were adding real delay: opening a case's Canvas no longer waits on an AI classification call before it can even render (the playbook match now loads in after), background Canvas tabs stopped silently re-polling Intercom every 15-30 seconds while hidden, every page navigation was doing duplicate sign-in checks, and the Sent Tracker was pulling every column (including the full email body) with no row limit. Canvas loading and page switching should feel noticeably snappier.",
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
    id: "seed-2026-06-05-a",
    date: "2026-06-05",
    title: "Slack bot DM landing zone",
    description:
      "Monitor alerts delivered via Slack DM. Troubleshooting guide for DMs landing in the Apps section.",
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
