# 97: cert26's first focus assertion races the localhost dev server's hosted-store latency

Status: done

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

2026-11-21: **Done (1c8270257).** cert26's step 1 now polls
`activeInside()` for `label === CLOSE` through a new `waitForFocusInside`
helper — the same bounded shape as the cert's existing
`waitForWidgetFrame` poll (40 × 250 ms ≈ 10 s) — and throws
`cert 26 FAILED: <same message>` on timeout. The two original assert
lines run unchanged on the matched state, so every stdout line is
identical on the happy path and the failure message is byte-identical to
the pre-fix assertion. Acceptance evidence, against the recorded
localhost dev server (port 3000, hosted session-pooler store; env
mirrored per LOCALHOST.md's ticket-95 recipe):

- **AC1 (end-to-end):** `node scripts/cert26-widget-focus.mjs <outdir>
  3000` PASSED twice (exit 0, all ten `ok:` lines each; outdirs
  `.scratch/t97-cert26-run1` / `-run2`). The pre-fix cert failed
  deterministically at this same assertion on this same server (ticket
  95's evidence), so the poll closes the race.
- **AC2 (still fails on wrong focus):** probe harness
  `.scratch/t97-failpath.mjs` (untracked scratch, like ticket 95's stub
  evidence; the cert script isn't importable, so the poll is
  re-implemented inline in the same shape and bound) drove the real app
  through the resume path: gate passed once, page reloaded in the same
  tab so the stored session resumed (composer present before open), then
  a mouse open — the app's open handoff correctly focuses the composer
  when it is usable (`src/app/widget/frame/hooks/usePanelState.ts:66`),
  so the step-1 expectation cannot become true. The poll timed out after
  10795 ms (the bound truly bounded — no early match) and threw exactly
  `cert 26 FAILED: mouse open with the contact gate focuses the close
  button`; focus at timeout was the composer (`{"id":"sfcw-question"}`).
  The wait is not a blanket sleep.
- **AC3 (meanings unchanged):** the diff is the helper and the step-1
  wait only; no assertion line changed.
- **Sibling check (27/29/66/67):** checked statically — none has the
  shape. No sibling asserts widget-frame focus after `.sfcw-frame-in`:
  cert29's focus assertions target the dashboard document's skip link
  and chips, and 27/66/67 have no `activeElement` assertion in the
  widget frame at all, so the symptom cannot arise there. Untouched, per
  the demonstrate-only rule; they remain undriven end-to-end this
  session.
- Checks: hygiene 781 tracked files pass, `tsc --noEmit` clean, full
  vitest suite 585 passed / 7 skipped (69 files).
- Store writes: unlike ticket 95's runs (which died pre-gate), these
  runs passed the contact gate, so THREE fresh visitor conversations
  (Jane Doe × 2, Resume Probe × 1) reached the shared-with-production
  test store. Left in place — no destructive cleanup was attempted
  against the shared project; the owner can clear them from the
  dashboard if wanted. The ticket-97 dev server was stopped after
  verification (owner-request precedent from ticket 95) and LOCALHOST.md
  updated.

Two-axis review (standards + spec, parallel sub-agents) found no hard
violations and nothing implemented wrong. Judgement calls accepted
as-is: (a) the file now holds a third poll-loop copy — extracting a
shared `poll()` is a refactor no ticket asked for (AGENTS.md
smallest-change rule; future-ticket material); (b) `waitForFocusInside`'s
`match` predicate has one call site — kept for symmetry with the frame
poll and as the natural seam if another assertion later demonstrates the
race; (c) the retained step-1 `assert` is tautological after the poll
but preserves the cert's `ok:` checklist output. The spec axis also
noted the failure-path evidence exercises the poll by shape rather than
by import — unavoidable for a non-importable script and recorded here.

Reviewed through: 1c8270257
