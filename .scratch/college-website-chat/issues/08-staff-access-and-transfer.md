# 08: Manage staff access and conversation ownership

**What to build:** The owner can invite and disable named staff accounts. Staff can release or transfer a claimed conversation so another authorized person can continue helping the visitor without losing history.

**Blocked by:** 04: Staff claim and live reply.

**Status:** resolved

- [x] The owner can invite a named staff member and disable an account; a disabled account immediately loses dashboard, API, and polling access, including existing sessions.
- [x] Authorized staff can release a claim or transfer it to another active staff member; the shared inbox and visitor chat reflect the new state.
- [x] Only the current owner or an authorized owner role can send a staff reply or change assignment.
- [x] The dashboard records who claimed, transferred, released, and replied in each conversation.
- [x] Automated flows cover competing assignments, release, transfer, disabled-account access, and preserved conversation history.

## Comments

Implemented 2026-10-24 (ticket 08). API flows in `tests/staff-management.test.ts` (14 tests). Owner invite via `POST /api/staff/members` (owner-only, staff/editor roles only): the server generates a strong initial password returned exactly once; the invitee's first sign-in forces TOTP enrollment like everyone else. Disable via `POST /api/staff/members/[id]/disable` (owner-only): ban flag in trusted server context (the provisioning precedent), all session rows deleted so live access dies immediately, and the member's claims are released back to the shared inbox with the sweep audited. Release/transfer at `.../release` and `.../transfer`: claimer-or-owner authorization, conditional-UPDATE atomicity, transfer targets must be active+verified+2FA-enrolled inbox members (an owner overriding may take a conversation over by transferring to themselves). The audit trail (`audit_log`, migration 0008) records claim/release/transfer/reply per conversation, create/revise/publish/unpublish per answer rule (closing ticket 05's attribution deferral), and invite/disable; it renders on the conversation page and each rule's edit page. Dashboard: `/dashboard/staff` roster + invite form + disable buttons; conversation page gains Release/Transfer controls and the Activity trail. Verified against a production build: the full HTTP loop (invite → enroll → claim → reply → transfer → release → disable with live-session cutoff) and the rendered staff/conversation/inbox pages.

Judgment calls:

- Owner accounts come only from the bootstrap script; the invite API refuses to create or disable owners (and the acting owner).
- Disable sweeps the member's claims to the inbox rather than leaving them stranded-but-invisible; each swept release is audited with the disabled account's email in the detail.
- The reply route keeps the claimed-state requirement for everyone; the owner override applies only to the claimer check.
- Disable writes the ban flag directly in trusted server context instead of `auth.api.banUser` (which needs an admin session); requireStaff checks the flag per request, matching the provisioning precedent in `src/auth/provision.ts`.
- Audit writes are best-effort after the action (no wrapping transaction): a failed insert fails the request loudly rather than silently unauditing.
- Conversation closure remains un-audited (the spec's accountability list names claims, transfers, replies, and content publishing); add `conversation_closed` later if the college wants it.

**2026-10-24 — accepted as complete (batch).** Accepted together with tickets 08–10 in one batch ahead of the end-of-project review; the implementation, automated suites, production checks, and recorded judgment calls stand as implemented.
