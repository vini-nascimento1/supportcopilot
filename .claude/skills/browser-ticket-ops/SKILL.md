# Browser Ticket Ops — driving Fadmin/Intercom/Slack directly to handle live tickets

Use this skill whenever Vincenzo asks you to actually work his Intercom queue live and end-to-end
using a browser-connected agent (Claude in Chrome, or a ChatGPT browser extension) that is signed
into his real accounts — not just draft replies from API data. Triggers: "use my claude in chrome
and work for me", "read my queue and respond", "can you manage these tickets", "check fadmin and
enable payouts", or any request where you need to actually click around Fadmin, send real Intercom
replies, or cross-reference an internal Slack moderation thread.

This is the operational companion to **support-response-batch** (voice, macros index, playbooks,
draft standards, hard rules — all of that still applies). This skill covers the *mechanics* of
driving the browser and Fadmin to gather real facts and actually send things, which
support-response-batch assumes you can't do ("no reliable Intercom write access from this session").
Read both; this one is about **how**, that one is about **what to say**.

This whole workflow was built out live with Vincenzo on 2026-08-01 (first real end-to-end run) — it
will keep evolving as he tests it more. Current state: one ticket at a time, sequentially. The
stated direction of travel is toward handling several tickets concurrently — nothing special to do
about that yet, just don't assume the one-at-a-time approach here is the ceiling.

## 0. Setup

- Fadmin URL: `https://fadmin.fanvue.com` (found in `lib/canvas-tools.ts`, `FALLBACK_TOOLS`).
- Intercom conversation URL pattern: `https://app.intercom.com/a/inbox/yzo8ff0f/inbox/conversation/<id>`
  (workspace id `yzo8ff0f`). You can also open `.../inbox/admin/<admin_id>/conversation/<id>?view=List`
  — same conversation, just via a specific admin's view, useful when Vincenzo pastes that exact URL.
- Vincenzo's Intercom admin_id: `10325350`.
- Load the Chrome tools once per session in a single batched `ToolSearch` call (see the
  claude-in-chrome MCP server instructions) rather than one at a time.
- For reading the queue and full conversation contents, prefer the Intercom MCP tools
  (`search_conversations`, `get_conversation`) over clicking through the UI — much faster, and you
  already have this access. Reserve the browser for things the MCP can't do: Fadmin, actually
  sending replies, viewing images/attachments, checking Slack.

## 1. Sweeping the queue

Same as support-response-batch §1–3: `search_conversations` with `admin_assignee_id: 10325350,
open: true, per_page: 150`. Output is large and gets saved to a file — parse it with PowerShell
`ConvertFrom-Json`, not by reading the raw file. Compute `needsReply = last_contact_reply_at >
last_admin_reply_at` per conversation as a first-pass filter, then pull full `get_conversation`
detail for anything ambiguous — remember the auto-greeting counts as an admin reply, so a ticket
where the last "admin" content was just the assignment template still needs a real answer.

**The queue is live and moves fast.** Other agents (human or otherwise) may be replying to tickets
in the same queue while you work — re-sweep before assuming a ticket is still in the state you last
saw it, especially in a long session. Don't be surprised if the total count changes by dozens
between sweeps.

## 2. Payout-enablement tickets (creator says payouts disabled / pending / can't withdraw)

This is the most common concrete action in this skill: checking whether payouts should actually be
turned on for a creator, and doing it.

1. **Find the account.** Fadmin → Creators → search box. This box matches by **handle/username
   substring**, not by full email — see §5 below for the whole "finding the right account" problem,
   which comes up constantly.
2. Open the Creator Data tab. Check:
   - **Active Balance** vs the payout minimum (~$20, region-dependent — some regions/Vincenzo's own
     number was $50). If Active Balance is below the minimum, that alone is the honest blocker —
     say so, don't enable anything, don't guess a number you haven't seen.
   - **Images/Videos count** — need 5+ total, almost never actually the blocker in practice.
   - **Payouts Enabled** field (under Subscriptions & Earnings) — this is what you're checking/toggling.
3. **Check User Warnings tab.** House rule from Vincenzo (2026-08-01): if there's any warning or
   admin note from the **past 14 days**, or anything KYC-mismatch related, **stop and investigate
   before touching payouts** — don't enable on autopilot just because the balance/media numbers look
   fine. An old (>14 days) resolved warning (e.g. off-platform activity) doesn't block enabling by
   itself, but check it hasn't recurred first (next point).
4. If there's an old off-platform-activity type warning: go to the creator's **Messages** tab, use
   the "Text includes..." filter, and search recurrence keywords (`telegram`, `whatsapp`, the
   specific domain/site named in the original warning). Zero matches on 2–3 keywords is enough
   diligence — don't grind on a query that times out (a 504 on a very specific/long substring search
   is a backend limit, not a real signal; two clean keyword misses plus Vincenzo's own media check is
   sufficient per his explicit instruction). **Content/media compliance itself is reviewed by
   Vincenzo personally** — you check messages for recurrence, he checks media.
5. If clear: go to the creator's **Edit** page (not the read-only Show page) → **Payouts** section →
   toggle **"Payouts enabled"** on → **Save**. Confirm the "Creator updated" toast.
6. Go back to **Admin Notes** tab. Click into the existing note textarea, move to the end
   (`ctrl+End`), and **append a new line** — never overwrite existing notes. Format:
   `YYYY-MM-DD <initials>: account review completed, enabling payouts;` — Vincenzo's initials are
   **VN**. Save.
7. Reply to the customer using the **"Payouts approved/enabled" Intercom macro** (search `#enabled`
   or `#pending` in the composer) — see §4, always search for the macro first rather than writing
   the explanation freehand.
8. If balance is short of threshold, or a recent relevant warning exists: do **not** enable. Reply
   explaining the real, honest blocker instead (e.g. "your available balance is $X, short of the
   $Y minimum") and leave the warning/compliance call to Vincenzo.

## 3. KYC verification failures (duplicate doc / bad doc / country block)

Per support-response-batch §4g, never guess which of the three applies — check Fadmin. Concretely:

- Fadmin → **KYC Records** page has its own top-level `User` search filter, separate from the
  Creators page search. It's the more reliable one — it matches by **email substring** and surfaces
  multiple near-match accounts with their emails shown next to each, so you can eyeball which one is
  the actual customer even with a fuzzy query.
- Each row shows `Document Country`, `Failed at`, and **`Failed reason`** — e.g.
  `ProhibitedCountryOrState`. If the same document number fails the same way across the customer's
  multiple signup attempts (they often try 2+ emails), that's a clean, confirmed country-block case,
  not a document-quality issue.
- Once confirmed, use the **"Prohibited country" Intercom macro** (search `#country` or
  `#prohibited`) rather than writing your own explanation — see §4. Tell them plainly it's not a
  document issue and resubmitting won't change the outcome, per the macro's own wording.

## 4. Always search for the macro first

Before writing any substantive policy explanation freehand, type `#` + a keyword guess in the
Intercom composer (`#pending`, `#enabled`, `#country`, `#refund`...) and see what surfaces. Use the
matched macro's exact wording (adapt only the greeting/specifics) instead of composing similar text
from scratch.

**Why this matters, not just style:** macros can carry side effects you don't get by freehanding —
e.g. the "Prohibited country" macro auto-applies the `EXCL CSAT` tag on insert. Corrected live by
Vincenzo on 2026-08-01 after freehand-writing a country-block explanation instead of using the macro
that already existed for it.

## 5. Finding the right account when the Intercom email doesn't match the real Fanvue account

Comes up constantly — the Intercom contact email is often not the account's actual email or handle.
In rough order of effort:

1. Try the Fadmin Creators search box with the display name, or an obvious handle guess.
2. Check any **screenshot the customer has sent** of their own account — the account menu (name +
   `@handle`) is often visible in a support screenshot sent for an unrelated reason. This is usually
   the fastest path.
3. If there's an associated **internal Slack moderation thread** (see §7), its parent message
   usually has a `User ID` field with the actual account email used internally — use that in the
   Fadmin search instead of the Intercom contact email.
4. Fall back to the **KYC Records page's `User` search** (§3) — it matches by email substring more
   reliably than the Creators page search does.
5. If none of that resolves it: check whether the Intercom contact is a `Lead` (no linked `User`,
   shown in the right-hand Details panel as `Type: Lead`) vs a real identified `User`. Multiple
   `Lead` entries with the same email but different internal user IDs and no linked User at all
   means there may genuinely be no findable Fanvue account yet — at that point, stop guessing and
   ask the customer directly for their account username/tag (there's a ready macro for exactly this:
   "I couldn't find an account linked to the email you provided...").

General Fadmin UI quirks worth knowing: typed text into these search comboboxes sometimes looks
empty/unregistered in the very next screenshot — wait ~1.5–2s before concluding the field didn't
register anything. After clicking a search result, the table below the search box often doesn't
visually refresh even though the URL's `filter` param picked up the right internal id — just
navigate straight to `#/creatorResource/<id>/show` (or `/show/<tabIndex>` for a specific tab) using
that id instead of trusting the inline list.

## 6. Compliance/moderation disputes — check Slack before answering

When a ticket touches an active moderation call (KYC-mismatch dispute, stolen-content warning,
account-warning pushback), there is very often an internal Slack thread where the actual decision
was made — Vincenzo will sometimes paste you the thread URL directly. Use `slack_read_thread` (not
`slack_search_public`, unless you don't have the exact link) with the channel id and message
timestamp from the URL (`.../archives/<channel_id>/p<ts_without_decimal>` → insert the decimal 6
digits from the end: `p1785625159261359` → `channel_id=...`, `message_ts=1785625159.261359`).

**Re-read the thread before sending anything** if Vincenzo says a decision has changed ("we
reverted", "I removed the warning") — the thread is the source of truth for what actually happened
and why, and it can update between when you first read it and when you're about to reply.

**When relaying an internal decision to the customer:**
- State the *outcome* plainly (warning removed / content approved / matter closed).
- Do **not** disclose internal specifics: don't name the moderator, don't repeat internal policy
  debate, don't explain the precise reasoning chain that led to a reversal. If Vincenzo says "explain
  being kinda vague, don't disclose much internal stuff, just apologize" — that's the default
  posture for any reversal, not a one-off instruction.
- If a decision was reversed because of an internal error, a short, genuine apology is appropriate;
  don't over-explain why the mistake happened.
- Never promise a warning will be removed *by request* going forward — see
  [[feedback_permanent_warnings_policy]]; a reversal because the underlying call was wrong is
  different from removing a warning because the customer is unhappy about it.

## 7. Locating specific flagged media (e.g. a stolen-content warning)

- The **User Warnings** tab's `Notes` column often contains the exact media IDs and any source URLs
  (e.g. a Reddit/Instagram link) the moderator recorded when issuing the warning.
- Take those IDs to the **Media** tab → `Media UUIDs & IDs` filter (comma-separated) → Enter. Each
  row has an eye icon that opens a full-size preview, plus a `Link` column with a direct (signed,
  expiring) URL to the asset.
- **Right-click → copy image → paste into the Intercom composer does not work reliably through
  browser automation** — the native OS context menu isn't something the automation layer can drive.
  Don't burn time on it.
- **Don't paste Fadmin's internal signed `media.fanvue.com/private/...` URLs into a customer-facing
  message** — they're meant for internal viewing, expire, and expose internal bucket structure.
  Prefer sharing the **public source link** (the Reddit/Instagram post the moderator already
  recorded) so the customer can compare for themselves — that's the actually-useful proof anyway,
  since it shows *where the content was copied from*, not just a copy of what they already had.
  Describing the flagged piece by content/date/caption is a fine substitute when there's no public
  source link to share.

## 8. Sending — same rules as everywhere else

- [[feedback_vincenzo_greeting_rule]] still applies: prepend his exact greeting if he hasn't
  personally posted in the thread yet — check the transcript for a real (non-template) message from
  admin id 10325350 before deciding.
- [[feedback_respond_in_english]] — drafts are always English, even mid-session when Vincenzo writes
  to *you* in Portuguese; that's about what you say to the customer, not what he says to you.
- [[feedback_approval_before_send]], including the **batch-approval nuance**: once Vincenzo has seen
  one fully-worked example and says "do it" / "manage all those tickets, ask if you have questions,"
  that's standing approval for the rest of the described batch — you don't need to paste every draft
  back for a fresh yes, but still stop and ask the moment something doesn't fit the pattern (no
  account found, a recent warning, balance short of threshold, anything genuinely ambiguous).
- Before clicking Send, actually re-read what's in the composer via a screenshot — composer state can
  get clobbered by scrolling/clicking elsewhere in the thread, and Intercom's Copilot sometimes
  auto-populates a suggested draft into the composer that you did not write and should not send
  as-is.
- After sending, report back what actually went out per ticket, rather than asking for permission
  before each one (given batch approval already granted).
