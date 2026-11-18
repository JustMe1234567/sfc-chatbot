# 45: Rename “Claim chat” to “Take over”

**Status:** ready-for-human

**What to build:** Change staff-facing conversation wording from **Claim chat/conversation** to the clearer action label **Take over**.

- [ ] The primary action for an unassigned human-request chat reads **Take over**.
- [ ] Pending feedback reads **Taking over…**, following ticket 42's shared loading pattern.
- [ ] Success, conflict, empty-state, helper, and validation copy use natural takeover language where staff see it. For example, “Waiting for a staff member to take over” and “Another staff member took over this chat.”
- [ ] Preserve existing assignment behavior, permissions, atomic conflict handling, attention clearing, audit attribution, release, and transfer behavior.
- [ ] Keep internal domain names, API paths, database fields, state values, and audit action identifiers such as `claim`, `claimed`, and `conversation_claimed` unchanged unless a code-local rename is clearly safe and valuable. This is primarily a product-copy change, not a data migration.
- [ ] Existing historical audit entries remain readable; their display label may say **took over this conversation** without rewriting stored audit data.
- [ ] Update focused UI assertions and snapshots for the new copy. Existing claim/takeover race tests must continue to pass unchanged semantically.

## Context

The current implementation calls the human assignment action “Claim conversation.” The user prefers “Take over,” which better describes the staff member replacing the bot as the live responder. Release and Transfer retain their current names.

## Comments

2026-11-04: Filed from the user's request: "change claim chat to take over."

2026-11-05: Implemented (`Status:` → ready-for-human). Pure product-copy change; behavior untouched.

- **Changed**: the pane's primary button reads **Take over** with pending **Taking over…** (ticket-42 pattern) and fallback error "Take over failed."; claim-conflict copy when the claimer's name is unknown reads "Another staff member took over this chat." (the named branch "…is already helping in this conversation." was already natural and stays); reply + close validation now say "Take over the conversation before replying/closing it."; the desk hint reads "Waiting for a staff member to take over this conversation." (matching the widget's ticket-43 line); the empty state says chats are "waiting for a staff member to take over"; the audit display label for `conversation_claimed` renders "took over this conversation".
- **Deliberately unchanged**: state values, API paths, store/domain names, audit action ids (`claim`, `claimed`, `already_claimed`, `conversation_claimed`), and the release/transfer routes' state-descriptive 409s ("Only a claimed conversation can be released/transferred.", "This conversation is no longer claimed.") — those describe the internal state (as "closed" would), not the takeover action, and renaming them risks inaccuracy under races. Historical audit rows remain readable with the new display label; no stored data rewritten.
- GLOSSARY gained a "Take over" entry pinning the label↔domain-term split.
- Tests: new `tests/takeover-copy.test.ts` (4 pins: button/pending verbs, desk helper/empty-state/audit copy with the stored id preserved, conflict + reply/close validation, internal vocabulary unchanged); `loading-feedback.test.ts` verb inventory updated. Suite 224 passed; typecheck + production build clean.
