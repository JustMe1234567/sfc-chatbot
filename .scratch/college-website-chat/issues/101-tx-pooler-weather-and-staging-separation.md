# 101: Transaction-pooler weather is chronic — record the 5432 rollback and the declined environment decisions

Status: ready-for-human

## Context (no code to build — a record and a decision)

Ticket 99 cut production over to the shared transaction pooler (6543);
ticket 100 made the auth path resilient to its stalls. Production
evidence from 2026-11-22 then showed the weather is not occasional but
**chronic**: `QUERY_TIMEOUT` errors every 1–3 minutes during owner use
(digest `3350715011`, deployment logs 02:20–03:09), while the same
database through the **session pooler (5432)** — localhost, `.env.local`
— ran flawlessly all session. The owner rolled production back to 5432
on 2026-11-22 (CLI env set from `.env.local` after three paste failures:
quote-wrapped value, then a wrong password; verified — eligibility 4/4
200, dashboard guard healthy). **Lesson: never hand-copy connection
values from `.env.local` — its lines are dotenv single-quote-wrapped,
and the quotes ride along into pasted values; set Vercel envs via the
CLI from the file instead.** PR #13's ceiling 4 + nav-prefetch-off are
live, so the session-pooler fan-out risk that caused the morning's
`EMAXCONNSESSION` outage is materially reduced (staff-scale traffic
stays well clear of 15 clients in a way pool-8 + prefetch bursts did
not).

## Decisions needed (owner)

1. ~~**Environment separation**~~ — **DECLINED 2026-11-22 (owner):** stay
   on the single shared project. Rationale recorded: the database is
   healthy, production is on the stable session pooler, and the
   ceiling-4 + prefetch-off fixes keep staff-scale traffic far from the
   15-client cap. Revisit only if the cap ever bites at real scale
   (then: NEW project for staging — never clear the production store;
   `config:export/import` excludes staff + Auth users, so staging
   bootstraps its own owner).
2. ~~**Weather-free production pooler (plan decision)**~~ — **DECLINED
   2026-11-22 (owner):** production stays on the session pooler (5432),
   which has no stall weather. The dedicated pooler (Pro) / IPv4 add-on
   + direct remain recorded here as the known path if 6543 is ever
   re-attempted.
3. **Leftover ops items:** Vercel `PG_POOL_MAX` — **set to 4 on 2026-11-22
   via CLI** (redeploy sfc-chatbot-6kilbnnum applied it; the value is
   stored as a Vercel Secret, so dashboard reads stay hidden); Vercel
   Preview environment still carries a stale `DATABASE_URL` (the CLI/API
   token cannot write it — set it via the dashboard when convenient;
   until then, future PR previews will 500 while production is
   unaffected).

## Acceptance criteria

- ~~The owner decides 1 and 2~~ — decided: both declined with rationale
  recorded above.
- ~~Ops item 3: PG_POOL_MAX~~ — closed (set to 4, deployed).
- Preview `DATABASE_URL` remains the one open ops item (owner dashboard
  step).

## Comments

2026-11-22: Filed from the post-cutover incident response (ticket 100
follow-up). Full evidence chain in the ticket 99/100 records here.
Ticket 100's retry stays deployed — dormant on
5432 (nothing stalls to trigger it) and insurance if 6543 is ever
re-attempted.
