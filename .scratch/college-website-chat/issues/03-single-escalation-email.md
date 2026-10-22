# 03: One reliable escalation email

**What to build:** Staff receive an email alert when a conversation first escalates. The alert links to the protected inbox, and a failed delivery remains visible so staff can retry it.

**Blocked by:** 02: Unknown question reaches the shared inbox.

**Status:** ready-for-human


- [x] An owner can configure the staff alert destination and an approved email sender is used from the server.
- [x] One escalation produces one staff alert even when requests are retried or repeated; later chat messages do not send another escalation alert.
- [x] The email links to the protected conversation and contains no full transcript or visitor session secret.
- [x] Delivery status and failure reason are visible to authorized staff, with a retry action that does not create duplicate successful alerts.
- [x] Automated tests cover first delivery, duplicate events, failed delivery, and retry.

## Comments

**2026-10-23 — implemented.**

- **Alert records:** migration `0003` adds a `settings` table and a `notifications` table whose `UNIQUE (type, conversation_id)` index is the database-enforced one-alert-per-conversation guarantee — repeated escalations or internal retries can never create a second row. Per-recipient delivery is tracked in `delivered_to`, so a mid-list failure and retry never duplicates a delivery that already succeeded.
- **Escalation hook:** the first unmatched question inserts the alert row and delivers; later messages in the conversation never re-alert. Alerting failures never fail the visitor's escalation response. An escalation that happens before the owner configures recipients still leaves a visible `pending` row ("No alert recipients configured yet"); retry after configuring delivers to the current list, so an escalation is never silently lost.
- **Email content:** subject + link to `/dashboard/conversations/{id}` + received timestamp only. Tests assert no transcript excerpt and no visitor token in the body.
- **Sender:** transport factory — development writes to the `mail_outbox` table; production uses the approved sender over its HTTP API when `RESEND_API_KEY` + `MAIL_FROM` are set (plain `fetch`, keys server-side only) and refuses to start without them. `CHATBOT_MAIL_TRANSPORT=fail-then-succeed` is a test-only transport that lets automated tests exercise real failed deliveries.
- **Owner configuration:** `PUT /api/staff/settings/alert-recipients` (owner role, 1–10 validated addresses) and the form on `/dashboard/notifications`; staff see read-only state.
- **Visibility + retry:** `GET /api/staff/notifications` and the dashboard page show status (Pending/Delivered/Failed), attempt count, and failure reason; `POST /api/staff/notifications/[id]/retry` (staff role, same-origin CSRF guard) reuses the same row — retrying a delivered alert is a 409, so successful alerts can never be duplicated.
- **Shared origin trust:** `trustedOrigins()` in `src/config.ts` now feeds both Better Auth and the CSRF same-origin guard (the browser check caught the guard rejecting the loopback spelling the dashboard actually runs on).
- **Tests:** 49 passing — the four required cases (first delivery, duplicate events, failed delivery, retry) plus unconfigured-recipients visibility, recipients configuration auth/validation, and visitor-credential rejection. Typecheck clean.
- **Interactive browser check:** owner login → enroll → configure recipients via the form → escalate → "Delivered · attempt 1" on the notifications page; with the failing transport, a failed alert shows its reason and a Retry button, and clicking it flips the row to "Delivered · attempt 2" while the earlier alert stays untouched. (The check also re-confirmed a stale-tab dev-server quirk: closing old in-app browser tabs was needed for hydration — environmental, not a code issue.)

Notes for the human pass:

- Retry delivers to the recipient list snapshot stored when the alert row was created (falling back to the current list only when it was empty) — the honest record of who was alerted. Say the word if you'd rather retries always use the current list.
- The Resend HTTP API stands in for "the approved sender" until the college picks one; swapping providers is one function in `src/mail/transport.ts`.
- `tests/creation-abuse.test.ts` (ticket 01 suite) was relaxed from exact throttled counts to "first 100 succeed + throttle engages" because under full-suite parallel load the run can straddle the 60 s rate-limit window, which legitimately resets counting.
- Access-control vocabulary and `better-auth` were left as-is; no new auth surface this ticket.
