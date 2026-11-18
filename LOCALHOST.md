# Shared localhost state

This file is the shared localhost handoff for Codex, Zcode, and other repository agents. Treat the recorded state as a hint and verify it before use because a process can stop without updating this file.

## Current state

- Status: running
- Base URL: http://localhost:3000
- Chatbot demo: http://localhost:3000/demo/wordpress-test-page.html
- Admin dashboard: http://localhost:3000/dashboard
- Started with: scheduled task `SFCChatbotLocalhost-Codex` running `next dev`
- Persistent launcher: Windows scheduled task; prior diagnostic stdout/stderr remain in `.scratch/localhost-dev.out.log` and `.scratch/localhost-dev.err.log`
- Process ID: 30060 (Next.js listener)
- Verified: port 3000 is listening after loading the database-backed session validation fix
- Last checked: 2026-11-18 22:46:46 +08:00 (Asia/Singapore)

## Check before visiting or starting

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
```

If port 3000 is listening, visit the URLs above instead of starting a duplicate server. If it is not listening, run `npm run dev`, wait for Next.js to report that it is ready, and update **Current state**. In Codex sessions where child processes are cleaned up after a tool call, use the recorded `SFCChatbotLocalhost-Codex` scheduled-task launcher instead.

When stopping the server, stop and unregister the exact `SFCChatbotLocalhost-Codex` task, set `Status` to `stopped`, and refresh `Last checked`.
