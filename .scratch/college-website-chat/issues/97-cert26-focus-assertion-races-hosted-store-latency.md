# 97: cert26's first focus assertion races the localhost dev server's hosted-store latency

Status: ready-for-agent

Filed from ticket 95's session (2026-11-21): ticket 95 changed nothing
in cert26's UI assertions, but its end-to-end AC forced the race into
the open, and ticket 95's own criteria forbid touching the assertion —
so the finding gets its own ticket.

## What to build

cert26-widget-focus.mjs asserts focus immediately after
`waitForSelector(".sfcw-frame-in")` + `waitForWidgetFrame()`. The
widget frame's close button only holds focus once the widget app has
hydrated and focused it; on the recorded localhost dev server (port
3000, hosted Supabase store — every Postgres roundtrip costs an
ap-northeast-1 RTT) that lands after the cert's assertion, so step 1
("mouse open with the contact gate focuses the close button") fails
deterministically. Evidence, 2026-11-21:

- A probe harness with a ~2.5 s settle between open and the first
  assertion shows the focus state the cert expects: active element is
  the close button, gate visible, same-origin frame.
- The cert itself fails deterministically at that assertion on this
  server; cert26's earlier passing runs were against a local SQLite
  store. The pre-change cert (ticket 95's baseline) fails identically,
  so this is a substrate/timing issue, not a regression from any
  committed change.

Make the step-1 assertion wait for the expected focus state instead of
polling nothing: e.g. poll `activeInside()` for `label === CLOSE` with
a bounded timeout (the cert already polls for the widget frame the
same way), so a slow-but-correct server passes and a genuinely wrong
focus target still fails. Keep the failure message identical.

Check the sibling certs for the same shape only where they show the
same symptom; do not refactor assertion plumbing across the fleet
beyond what a failing run demonstrates.

## Acceptance criteria

- `node scripts/cert26-widget-focus.mjs <outdir> [port]` passes
  end-to-end against the recorded localhost dev server (port 3000).
- The cert still fails when focus genuinely lands elsewhere (not a
  blanket sleep that masks real failures).
- No assertion's meaning changes; only the wait around it.

## Comments

2026-11-21: Filed from ticket 95's cert26 end-to-end evidence. The
sibling certs (27/29/66/67) were not driven this session — treat them
as unverified suspects, not confirmed cases.
