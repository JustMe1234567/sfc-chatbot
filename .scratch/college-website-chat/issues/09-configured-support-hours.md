# 09: Display configured support hours

**What to build:** The owner can set support hours, and the visitor sees accurate handoff wording based on those hours. When hours are not configured, the widget gives a general follow-up message without promising a deadline.

**Blocked by:** 02: Unknown question reaches the shared inbox.

**Status:** resolved

- [x] An owner can set and change support hours and their time zone in the dashboard.
- [x] The widget shows the configured hours and appropriate handoff wording inside and outside those hours.
- [x] With no configured hours, the widget shows a general follow-up message and no specific response-time promise.
- [x] The behavior is verified across a day boundary and the configured time zone.

## Comments

Implemented 2026-10-24 (ticket 09). Tests in `tests/support-hours.test.ts`. Support hours live in the `settings` table as `{timeZone, days[0–6], startMinute, endMinute}` behind owner-only `GET/PUT /api/staff/settings/support-hours` (`hours: null` clears); the dashboard form (time zone, day checkboxes, open/close times) sits on the notifications page for owners with a read-only summary for staff. Membership is computed in the configured IANA zone (`domain/hours.ts`, `Intl` with hourCycle h23); the escalation bot message is composed per handoff by `handoffReply(hours | null)` — unconfigured keeps the exact ticket-02 general message, inside hours says staff are on duty until the closing time, outside lists the schedule. Pure functions are unit-tested at exact start/end/day edges with fixed-offset zones (Etc/GMT-2, Etc/GMT-12) and fixed Dates, including the same instant flipping local day across zones. Verified against a production build: Europe/London weekday hours saved via the API, and a live escalation on a Sunday morning (London) correctly produced the "when the desk is open" schedule wording.

Judgment calls:

- No overnight windows: `endMinute` is exclusive and must exceed `startMinute` (a helpdesk closing at midnight is unrealistic; overnight membership adds day-pair logic for nothing).
- Outside-hours wording ends "…or leave an email for a way back", pointing at ticket 07's flow — accurate, though the ticket only asked for handoff wording.
- Schedule rendering joins contiguous days ("Monday to Friday") including wrap-around runs ("Friday to Sunday") and falls back to a comma list for scattered days.
- Reads apply the same validation predicate as writes: a corrupt or hand-edited settings row reads as unconfigured (general message) instead of reaching the visitor path with a bogus or throwing time zone.
- A closing time of midnight (endMinute 1440) is legal via the API; the edit form displays it as 23:59 (no valid `type="time"` spelling for 24:00), so re-saving narrows the window by one minute.

**2026-10-24 — accepted as complete (batch).** Accepted together with tickets 08–10 in one batch ahead of the end-of-project review; the implementation, automated suites, production checks, and recorded judgment calls stand as implemented.
