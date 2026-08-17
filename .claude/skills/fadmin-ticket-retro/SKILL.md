# Fadmin Ticket Retro — learn something new from every live ticket

Run this skill as the **last step** of any session where Claude in Chrome drove Fadmin/Intercom/Slack
to investigate or handle a real ticket (via **browser-ticket-ops** or any ad hoc live investigation —
payout checks, refund disputes, KYC lookups, warning reviews, anything that involved clicking around
Fadmin for a real customer). Run it automatically, without being asked, every time such a session wraps
up — don't wait for the user to say "what did you learn."

**The standard: if you finish a ticket and don't add or sharpen something in
`browser-ticket-ops/SKILL.md` (or the memory files it links to), you failed this skill.** "Nothing new
happened" is a red flag, not a clean pass — most live tickets touch at least one page, control, or edge
case that behaves slightly differently than what's already written down. Scrutinize the session again
before concluding there's really nothing.

## What to do

1. **Reconstruct what actually happened, mechanically.** Which Fadmin pages/resources did you open?
   Which UI controls worked first try vs needed retries or workarounds? Which shortcut (a direct URL, a
   global resource search, a specific tab) turned out faster than the obvious path? Any misclicks or
   wasted tool calls, and why did they happen — stale coordinates, a filter that renders with a delay,
   a control that's just broken? Any policy/decision-tree edge case that the existing macros/playbooks
   didn't cleanly cover?
2. **Compare against `browser-ticket-ops/SKILL.md` and its linked memory files.** Is this already
   written down? If yes — did today's session confirm it, or contradict/refine it (a documented quirk
   turned out to have a workaround now, a shortcut that used to work no longer does, a tab index
   changed)? Stale documentation is worse than none — fix it in place rather than leaving it wrong.
3. **Write the update immediately, in the same turn — don't defer it to "later" or to a TODO.**
   - New UI quirk, shortcut, or gotcha (which control is flaky, which resource has real search, which
     click pattern avoids stale refs) → edit `browser-ticket-ops/SKILL.md` directly.
   - New policy/refund/payout edge case, or a corrected macro/threshold → add or refine a memory file
     (feedback or project type, per the auto-memory system) and link it from the skill with a
     `[[wikilink]]` if it's durable across future tickets, not a one-off.
   - Something already in the skill turned out to be wrong or stale → correct it in place; don't just
     append a note that contradicts an earlier line and leave both standing.
4. **If you genuinely find nothing new**, say so explicitly in your response and give the specific
   reason (e.g. "identical flow to the payout-enable case already documented in §2, no new page or
   control touched"). A silent "nothing to add" with no justification counts as failing this skill.
5. **Merge, don't just append.** Fold a new observation into the existing relevant section of
   `browser-ticket-ops/SKILL.md` rather than always bolting on a new numbered subsection at the bottom.
   Only add a new top-level section when the observation genuinely doesn't fit any existing one.

## Where things go

- **Mechanical/UI facts** (which Fadmin control is flaky, which resource has better search, which click
  pattern avoids stale coordinates, which tab index maps to which page) → `browser-ticket-ops/SKILL.md`
  directly — that's the living reference for *how* to drive Fadmin.
- **Policy/refund/payout decision facts** (a new leaf case, a corrected macro, a KYC nuance, a changed
  threshold) → a memory file, linked from the skill.
- **One-off ticket specifics** (this fan's name, this invoice number, this creator's handle) → nowhere.
  Don't pollute the skill or memory with per-ticket specifics; only the generalizable lesson survives.

## Trigger phrases

"that resolves it", "thanks, done", the user moving on to a new topic right after a live Fadmin
investigation, or an explicit "what would you do differently" / "what did you learn" ask — any of these
at the end of a browser-ticket-ops session should fire this skill before the turn ends.
