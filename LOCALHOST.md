# Shared localhost state

This file is the shared localhost handoff for Codex, Zcode, and other repository agents. Treat the recorded state as a hint and verify it before use because a process can stop without updating this file.

## Current state

- Ticket-95 dev server: RUNNING 2026-11-21 — `npm run dev` (dev runtime, Turbopack) on port 3000 from the worktree `C:\Users\antlo\.zcode\worktrees\b0bf\sfc chatbot` (branch `codex/ticket-95-cert-embed-guard`), launched by the ticket-95 ZCode session. Log `.scratch/t95-server.log`. Its untracked worktree `.env.local` mirrors the recorded localhost environment: `DATABASE_URL` = the shared hosted Supabase project's SESSION pooler :5432 (copied verbatim from the main repo's `.env.local`), Supabase auth trio, `PG_POOL_MAX=5`, `CHATBOT_BASE_URL=http://localhost:3000` — the store therefore is the shared-with-production test project (ticket 92's note); a fully-local store is not currently possible (the Supabase auth provider requires a same-project `DATABASE_URL`, `src/auth/supabase-provider.ts:62`). Verified 2026-11-21: `/api/healthz` `{"ok":true}` and DEV-mode posture (`/api/v1/embed-eligibility` → `{"allowed":true}` for the loopback origin). cert26 runs against it died at their first focus assertion BEFORE the contact gate — zero conversation writes reached the store (see ticket 95's record; the race is ticket 97).
- Stale-record note: the previously recorded port-3000 listener (PID 27132, ticket-76/78 era) was GONE when the ticket-95 session checked 2026-11-21 ~03:00 +08:00 — nothing was listening; that record was stale.
- Ticket-90 cert server: STOPPED 2026-11-20 — ran a local PRODUCTION runtime (`next start`) on port 4388 against the hosted Supabase test project via the SESSION pooler :5432 (launcher `.scratch/cert89-server.mjs`, log `.scratch/t90-cert-server.log`, `PG_POOL_MAX=5`, app on postgres.js 4.1.1 + query/queue timeouts per ticket 90). **cert70 PASSED** (exit 0, zero bounded rejections, settings restored byte-identically by the cert's own finally — see ticket 90's record). Disposable `cert-recon` owner fully cleaned up: auth user `60f613c4…` (`1717507f…@staff.invalid`) deleted via admin API, staff row + its 1 login_event deleted by SQL, staff_members back to only the real `owner`. Port 4388 released, nothing left listening. Port 3000's unrelated dev server (below) untouched by this session.
- Ticket-89 cert server: STOPPED 2026-11-20 — ran a local PRODUCTION runtime (`next start`) on port 4388 against the hosted Supabase test project only (launcher `.scratch/cert89-server.mjs`, log `.scratch/cert89-server.log`, `PG_POOL_MAX=5`); cert70 did NOT pass (see ticket 89's record — the pool wedges on bursty load; the disposable `cert-recon` owner was fully cleaned up: auth user deleted via admin API, staff row + its 5 login_events deleted, settings rows restored byte-identically by cert70's own finally and verified), port released, nothing left listening on 4388. Port 3000's unrelated dev server (below) untouched by this session.
- Status: running (ticket-95 session's dev server — see the Ticket-95 entry above)
- Base URL: http://localhost:3000
- Chatbot demo: http://localhost:3000/demo/wordpress-test-page.html
- Admin dashboard: http://localhost:3000/dashboard
- Started with: `npm run dev` in the b0bf worktree (see Ticket-95 entry; `SFCChatbotLocalhost-Codex` scheduled task NOT used)
- Verified: 2026-11-21 (ticket-95 session) — healthz + eligibility checked over HTTP
- Ticket-79 cert server: STOPPED — ran `next start` on port 4391 against scratch Postgres `sfc_cert79` (dropped) for the needs-human-bell certification, driven by `.scratch/cert79-run/server.ps1` + `cert.ps1` (Supabase trio from .env.local; store username `postgres.bmlwasuvujkfchnbklls` matching the auth project ref; role `postgres.bmlwasuvujkfchnbklls` left in place on the 5433 cluster); the cert's Supabase auth user (cert79owner) was deleted by the script's cleanup after every attempt; orphans on 4390/4391 checked — nothing left listening
- Ticket-78 cert server: STOPPED — ran `next start` on port 4390 against scratch Postgres `sfc_cert78` (dropped) for the fail-fast verification; orphans on 4390 checked, nothing left listening; scratch db and the stub role `postgres.cert78stub` were created and the db dropped again (role left in place on the scratch cluster)
- Ticket-76 cert server: STOPPED again — ran `next start` on port 4376 against scratch Postgres `sfc_cert76` (dropped) for the embed-allowlist certification; orphans on 4376 killed, nothing left listening there
- Local 5433 scratch Postgres cluster: DOWN — last startup attempt 2026-11-20 16:59 +08:00 failed (startup process terminated by exception 0xC000026B, per `.scratch/local-postgres/pg.log`); the Windows service `postgresql-x64-17` runs on 5432 (password auth — trust hba belongs to the 5433 scratch cluster, not the service). Ticket-95 session verified both ports by probe.
- Last checked: 2026-11-21 ~03:40 +08:00 (Asia/Singapore)

## Check before visiting or starting

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
```

If port 3000 is listening, visit the URLs above instead of starting a duplicate server. If it is not listening, run `npm run dev`, wait for Next.js to report that it is ready, and update **Current state**. In Codex sessions where child processes are cleaned up after a tool call, use the recorded `SFCChatbotLocalhost-Codex` scheduled-task launcher instead.

When stopping the server, stop and unregister the exact `SFCChatbotLocalhost-Codex` task, set `Status` to `stopped`, and refresh `Last checked`.
