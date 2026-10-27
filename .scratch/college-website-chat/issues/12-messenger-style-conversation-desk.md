# 12: Messenger-style staff conversation desk with one-day inactivity

**Status:** ready-for-human

**What to build:** Replace the staff dashboard's waiting-only inbox view with a two-pane conversation desk. The selected transcript and reply controls occupy the main pane; a compact conversation list sits on the left on desktop, following the supplied dashboard reference. A conversation remains active for 24 hours after its last meaningful message, then moves to a history view. Keep its transcript.

**Blocked by:** 04: Staff claim and live reply; 10: Transcript retention. Both are resolved.

- [x] The left-side list shows every active conversation that staff may inspect, including bot-active, waiting, and claimed conversations. Organize it into clear Incoming (waiting for staff) and Active sections, with History separately accessible. Do not add Groups or Direct Messages. Claiming a conversation does not remove it from the list. Each entry shows a useful preview, time of last message, and state; newest activity appears first.
- [x] A newly escalated chat and a new visitor message in an active chat produce a visible in-dashboard notification and updated attention count for authorized staff. The notification identifies the conversation, links to it, and clears its attention state when appropriately viewed or handled. Do not create a duplicate alert on each poll, expose transcript text in browser/system notifications, or require an IP address to show the alert.
- [x] Selecting an entry opens its transcript and existing claim, reply, release, transfer, and close actions in the main pane. New messages and state changes appear without a manual page reload. The selected entry remains identifiable, and deep links to a conversation still work.
- [x] On narrow screens, the list and transcript remain usable without horizontal scrolling; staff can switch between them with accessible controls. Keyboard focus, labels, status, and touch targets remain usable.
- [x] A conversation becomes inactive exactly 24 hours after its latest visitor or staff message (or creation if it has no messages). Background polling, page views, and presence updates do not reset this clock. A new meaningful message before expiry resets it.
- [x] Inactive and manually closed conversations leave the Active list and remain available in History with their transcripts. A visitor attempting to continue an inactive conversation starts a new conversation. Staff cannot reply to an inactive conversation until a defined reopening action exists; this ticket does not add reopening.
- [x] The existing visitor credential's fixed 24-hour expiry from creation is reconciled with the inactivity rule, so an active exchange can continue for a full day after its latest meaningful message. Expired credentials do not grant access to old transcripts. Return links and staff authentication retain their own expiry rules.
- [x] The existing configurable transcript retention policy still governs deletion of closed/history records. Moving a chat to History does not itself delete messages, visitor email, notification records, or audit history.
- [x] Tests cover waiting-to-claimed visibility, ordering, the exact 24-hour boundary, polling that does not extend activity, new messages that do, visitor expiry/new-chat behavior, and history access.

## Context

The current `/dashboard/inbox` lists only `awaiting_staff`, so a claimed chat disappears even while the visitor is still talking. The current visitor session expires 24 hours after creation, regardless of later messages. The user wants all conversations visible in the staff desk and chose **hide from active lists while keeping history** after one day of inactivity. The later supplied dashboard screenshot supersedes the earlier right-side placement request: place the list on the left.

## Comments

2026-10-26: Captured from the user's request. No implementation requested in this turn.

2026-10-26: Updated for the supplied Tawk-style references: left conversation list, Incoming/Active sections, and an in-dashboard chat attention notification. No Groups or Direct Messages.

Implemented 2026-10-27 (ticket 12). Tests in `tests/conversation-desk.test.ts`. Migration 0011 adds `conversations.last_activity_at` (the inactivity clock, backfilled from the latest visitor/staff message) and `conversations.attention_at` (the alert flag). The desk lives at `/dashboard/inbox` (list left: Incoming = awaiting staff, Active = bot-active + claimed; History tab), with `/dashboard/inbox/[id]` opening a conversation in the main pane and `/dashboard/conversations/[id]` redirecting there so alert-email deep links keep working. Inactivity is computed at read time by `domain/activity.ts` (`isConversationActive`), and each meaningful message calls `touchConversationActivity`, which in one transaction moves the clock and slides the conversation's visitor-session expiries — so the credential lives exactly as long as the exchange does, and a lapsed credential still answers the shared 404 shape. Staff claim/reply refuse inactive conversations with 409 `conversation_inactive`; the visitor API answers the same code, which the widget already handles by carrying the question into a fresh chat. Attention is set on escalation and on visitor messages (a `WHERE attention_at IS NULL` guard keeps a burst one alert) and clears when staff view the transcript, reply, or claim. Verified against a production build: owner TOTP sign-in, escalation appearing in Incoming with the count, two-pane render with the selected entry, claim → reply → Active with attention cleared, the visitor polling the staff reply, the History tab, and the deep-link redirect.

Judgment calls:

- The boundary reads "strictly past": a conversation stays active *at* exactly 24 hours of quiet and goes inactive one millisecond later, matching the retention boundary accepted in ticket 10.
- Attention clears on viewing (the detail GET), replying, or claiming; release and transfer keep it, since the next reader still has something new to see.
- The alert surface is entirely in-dashboard (tab count, per-entry badges): no browser/system notifications, so there is also no transcript text to leak in one.
- The history view renders the archive without scanning the live desk (the lists are disjoint), but every desk render does load each listed conversation's transcript for its preview and count — fine at helpdesk scale, worth revisiting with a store-level preview query if volume grows (ticket 17's analytics may want the same).
- The widget clears the visible transcript when a lapsed credential forces a restart, mirroring the existing closed-conversation carry-over: mixing two conversations' messages in one view would misrepresent both. Ticket 14 builds the explicit visitor-facing clear on top.
- The 24-hour visitor-session slide updates every session row of the conversation on each meaningful message; return links and staff sessions keep their own expiry rules untouched.
- `vitest.config.ts` now sets `hookTimeout` 60s and `testTimeout` 20s: the provisioning-heavy `beforeAll` hooks and the multi-step authenticated flow tests legitimately exceed vitest's 10s/5s defaults when this machine is under load (OneDrive sync churn); correctness was never at stake, only budget.
