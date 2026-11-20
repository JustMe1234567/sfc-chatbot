# 95: Cert scripts import the shared embed-eligibility guard instead of inlining it

Status: ready-for-agent

Filed from ticket 94's human decision session (2026-11-21, item 3,
fix approved). Scope is the corrected five-script scope — ticket 94's
triage note narrowed the item to cert26/27 claiming cert29/66/67
import the lib export; direct verification disproved that: **no cert
script imports `assertDemoOriginEmbeddable`** (cert29/66/67 import
only `signIn`), and all five inline the probe.

## What to build

`scripts/lib/shot-driver.mjs:29` exports `assertDemoOriginEmbeddable`,
the canonical ticket-78 embed-eligibility probe: it checks
`response.ok` before `.json()` and fails with the clear
run-`next dev`-with-CHATBOT_BASE_URL instruction. Five cert scripts
paste their own inline copy, each one missing the `response.ok` check
(a non-2xx with a non-JSON body dies as an opaque `SyntaxError`) and
carrying drifted error text.

Replace each inline probe block with a call to the lib export, adding
one import line per script — the exact pattern
`scripts/analytics-shots.mjs`, `scripts/motion-shots.mjs`, and
`scripts/topics-shots.mjs` already use:

- `scripts/cert26-widget-focus.mjs` (inline block ~lines 36-45)
- `scripts/cert27-touch-targets.mjs` (inline block ~lines 36-44)
- `scripts/cert29-a11y-polish.mjs` (inline block ~lines 41-49)
- `scripts/cert66-widget-gate.mjs` (inline block ~lines 40-48)
- `scripts/cert67-handoff-options.mjs` (inline block ~lines 48-56)

Behavioral delta, which is the point of the fix: the five scripts
gain the `response.ok` handling and adopt the lib's canonical error
text. Nothing else changes — the surrounding comments (e.g. the
"Ticket 78 guard" note) stay, adjusted only where they describe the
probe they sit above.

## Acceptance criteria

- `grep -rn "embed-eligibility" scripts/` shows the fetch only inside
  `scripts/lib/shot-driver.mjs` (plus any non-cert caller that
  legitimately fetches it for other purposes — cert66's conversation
  start and claim fetches are unrelated endpoints and stay untouched).
- cert26, the representative affected cert, runs end-to-end against
  the local dev server (`node scripts/cert26-widget-focus.mjs
  <outdir> [port]`) and behaves as before on the happy path.
- The failure path is the lib's: a probe that receives a non-2xx
  response reports `the embed eligibility probe failed: <status>`
  rather than a JSON parse error.
- No cert script's output text, screenshot set, or assertion set
  changes beyond the probe's error path.

## Comments

2026-11-21: Filed from ticket 94's decision session (item 3, fix
approved with corrected five-script scope). Nothing was implemented
in ticket 94 itself, per its acceptance criteria.
