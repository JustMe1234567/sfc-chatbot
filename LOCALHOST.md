# Shared localhost state

This file is the shared localhost handoff for Codex, Zcode, and other repository agents. Treat the recorded state as a hint and verify it before use because a process can stop without updating this file.

## Current state

- Cert-recon server (tickets 70/81/82 reconciliation): STOPPED 2026-11-20 — ran a local PRODUCTION runtime (`next start`) on port 4388 against the hosted Supabase test project only (launcher `.scratch/cert-recon-server.mjs`, log `.scratch/cert-recon-server.log`); all three certs passed, all disposable records cleaned up (cert auth user deleted via admin API, staff row + login events + IP block + analytics rows deleted, settings rows restored by cert70's own finally), port released, nothing left listening on 4388. Run note: the app's Postgres pool must have headroom for the settings page's 8 concurrent reads — the run needed `PG_POOL_MAX=20` (see ticket 89). Port 3000's unrelated dev server (below) untouched by this session.
- Status: running (listener confirmed on port 3000, owner unknown — not started by the ticket-76 session)
- Base URL: http://localhost:3000
- Chatbot demo: http://localhost:3000/demo/wordpress-test-page.html
- Admin dashboard: http://localhost:3000/dashboard
- Started with: unknown (pre-existing listener, PID 27132 at time of check — possibly the `SFCChatbotLocalhost-Codex` scheduled task or a concurrent session's `npm run dev`)
- Process ID: 27132 (Next.js listener on 3000)
- Verified: 2026-11-19 02:06 +08:00, listener only — no HTTP checks by this session (it runs with its own environment; do not assume the scratch cert database)
- 2026-11-19 02:4x +08:00 healthz + eligibility checked by the ticket-78 session: port 3000 answers `{"ok":true}` and serves the DEV-mode posture (`/api/v1/embed-eligibility` returns `allowed:true` for the loopback origin) — treat it as a dev server with its own environment
- Ticket-79 cert server: STOPPED — ran `next start` on port 4391 against scratch Postgres `sfc_cert79` (dropped) for the needs-human-bell certification, driven by `.scratch/cert79-run/server.ps1` + `cert.ps1` (Supabase trio from .env.local; store username `postgres.bmlwasuvujkfchnbklls` matching the auth project ref; role `postgres.bmlwasuvujkfchnbklls` left in place on the 5433 cluster); the cert's Supabase auth user (cert79owner) was deleted by the script's cleanup after every attempt; orphans on 4390/4391 checked — nothing left listening
- Ticket-78 cert server: STOPPED — ran `next start` on port 4390 against scratch Postgres `sfc_cert78` (dropped) for the fail-fast verification; orphans on 4390 checked, nothing left listening; scratch db and the stub role `postgres.cert78stub` were created and the db dropped again (role left in place on the scratch cluster)
- Ticket-76 cert server: STOPPED again — ran `next start` on port 4376 against scratch Postgres `sfc_cert76` (dropped) for the embed-allowlist certification; orphans on 4376 killed, nothing left listening there
- Last checked: 2026-11-19 05:25 +08:00 (Asia/Singapore)

## Check before visiting or starting

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
```

If port 3000 is listening, visit the URLs above instead of starting a duplicate server. If it is not listening, run `npm run dev`, wait for Next.js to report that it is ready, and update **Current state**. In Codex sessions where child processes are cleaned up after a tool call, use the recorded `SFCChatbotLocalhost-Codex` scheduled-task launcher instead.

When stopping the server, stop and unregister the exact `SFCChatbotLocalhost-Codex` task, set `Status` to `stopped`, and refresh `Last checked`.
