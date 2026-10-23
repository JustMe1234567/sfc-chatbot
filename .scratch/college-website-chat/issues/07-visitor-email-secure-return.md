# 07: Visitor email and secure return

**What to build:** At handoff, a visitor may provide an email address for follow-up. If staff reply after the visitor leaves, the visitor receives a secure link and can resume the same conversation. A visitor who declines email can still use live chat while present.

**Blocked by:** 03: One reliable escalation email; 04: Staff claim and live reply.

**Status:** ready-for-human

- [x] Email is requested only at escalation and is optional; declining it keeps live chat available with a clear explanation of the follow-up limit.
- [x] When staff reply to a visitor who has left and provided email, one visitor notification contains a short-lived, revocable return link and no full transcript.
- [x] A valid link restores only its own conversation and history; expired, revoked, and other-conversation links cannot read messages.
- [x] A visitor still on the page receives the staff reply in the widget without an unnecessary return email.
- [x] Automated API and email flows cover the optional address, return, expiry, access isolation, and notification deduplication.

## Comments

Implemented 2026-10-23 (ticket 07). API/email flows in `tests/visitor-email-return.test.ts` and `tests/visitor-return-retry.test.ts`. Presence = `visitor_last_seen_at` touched on every authorized visitor request; a staff reply to a visitor stale beyond 60s (env-tunable) sends the email, a reply to a present visitor never does. Return tokens: 32-byte random, only SHA-256 stored, 24h TTL, single-use; redemption burns the token and mints a fresh 24h visitor session in one transaction. Verified in a browser against a production build: escalation shows the optional-email prompt, a departed visitor's reply produces exactly one email with a working one-time link and no transcript, the link lands in `/return` and restores the full history in the widget, and replaying it is refused with a friendly page.

Judgment calls:

- Nothing link-shaped is persisted: each delivery (first send and every staff retry) mints a fresh token, so a retried email can never carry a stale link; the notification slot is claimed before minting, so racing replies cannot produce a second link (an unused token row from a lost race simply expires).
- Presence is last-seen based (polling every 3s vs a 60s window), not socket/push based — simple, honest, and matches the polling refresh decision in the spec.
- The widget's email prompt reappears after a reload while awaiting staff (decided state is client-side); re-submitting overwrites the stored address. The decline path is client-only and shows the story-15 warning.
- Return links stay valid after staff close the conversation: the returning visitor reads history and their next question starts a fresh conversation.
- New `CHATBOT_MAIL_TRANSPORT=outbox` test-transport mode supports local production-build browser checks without weakening the production sender guard.
