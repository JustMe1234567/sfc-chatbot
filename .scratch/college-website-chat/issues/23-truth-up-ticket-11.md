# 23: Truth up ticket 11's recorded claims

**Status:** ready-for-human
**Priority:** P2 — tracker correctness, blocker for ticket 11's human pass
**Found by:** pre-testing audit 2026-10-30 (spec pass; verified directly)

**What to fix:** Ticket 11's file currently overstates what was delivered. Three corrections so the tracker matches the code:

- [x] Criterion 5 is ticked `[x]` including "A Vercel preview verifies WordPress embedding and browser flows on desktop and mobile" (issues/11 line 13), but the ticket's own comment says the preview "remains the one human step." Untick criterion 5 (or split the preview clause out) until a real preview has been exercised; the audit note stands: conversation continuity across a Vercel function recycle on Supabase is currently proven nowhere, so the preview check should explicitly cover a mid-conversation function recycle.
- [x] The comment claims "origin checks + rate limits on public POSTs with no IP persisted." Only `/api/v1/presence` calls `sameOriginGuard`; the other public POSTs have rate limits only. Reword to match (bearer-token endpoints; origin-check posture is tracked separately in issue 30).
- [x] Reference issue 20 from the ticket so the parked XFF item is visibly claimed rather than dropped.

## Comments

2026-10-30: Filed from the audit. Verified: `issues/11-migrate-to-supabase-and-vercel.md` line 13 checkbox and comment text; `grep -r sameOriginGuard src/app/api` shows presence only among `v1` routes.

2026-11-11: Implemented (tracker-only pass; no code changes, no test surface). All three boxes ticked above. (1) Criterion 5 split — the flow-suite clause keeps its tick, the Vercel-preview clause moved to a new unticked checkbox (the filing comment's "line 13" is now line 14 after the split) that explicitly requires a mid-conversation function recycle (the audit's proven-nowhere note quoted in the checkbox itself); (2) the security-review paragraph reworded to the verified posture — `sameOriginGuard` covers only `/api/v1/presence` among `v1` routes (re-run the audit's grep today to confirm it still holds), the rest are bearer-token endpoints or rate-limited public ones (`conversations` create, `return` redeem) without an origin check, with issue 30 named as the posture's tracker; (3) issue 20 is referenced from ticket 11's security-review paragraph, complementing the concurrent session's 2026-11-11 comment there that records ticket 20 as the XFF item's landing place (ticket 20 was committed as `e5b67fe` while this pass ran). Ticket 11 remains `ready-for-human` with the preview checkbox now honestly open.
