# 95: Cert scripts import the shared embed-eligibility guard instead of inlining it

Status: done

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

2026-11-21: **Done (1b6104db2).** All five inline probe blocks replaced
with `import { assertDemoOriginEmbeddable } from "./lib/shot-driver.mjs"`
(cert29/66/67 extend their existing `signIn` import line, the exact
combined-line shape `analytics-shots.mjs` uses; cert26/27 gain a new
import line). Each block body is now `await assertDemoOriginEmbeddable(BASE);`
under the retained "Ticket 78 guard" comment; nothing else in the five
scripts changed (5 files, +10/−58; `scripts/lib/shot-driver.mjs` itself
untouched). Acceptance evidence:

- **AC1 (grep):** `grep -rn "embed-eligibility" scripts/` now shows the
  fetch in `scripts/lib/shot-driver.mjs:30` plus two pre-existing
  fetchers outside the five-script build scope — `cert70-branding.mjs:146`
  (probes an HTTPS cert-host origin it just allowlisted) and
  `cert76-embed-allowlist.mjs:90` (tests the eligibility endpoint itself
  via `response.text()`). Both legitimately fetch for other purposes, so
  the criterion's intent holds; note the AC's carve-out says "non-cert
  caller" while both remaining fetchers are cert scripts — read as
  covering the five inlined probe copies only (the build scope), not a
  code change. cert66's conversation-start and claim fetches are
  different endpoints and were untouched, as the AC requires.
- **AC3 (failure path is the lib's):** verified against a stub server
  (healthz 200, embed-eligibility 500 with a deliberately non-JSON
  plain-text body). The new cert26 exits with
  `the embed eligibility probe failed: 500` — no parse error. The
  pre-change cert, run for contrast from `HEAD~`'s version, dies on the
  same response with `SyntaxError: Unexpected token 'I', "Internal S"...
  is not valid JSON` — exactly the opaque death this ticket filed to
  remove. Both variants confirmed on the unmodified wiring.
- **AC2 (cert26 happy path):** run three times end-to-end against the
  localhost dev server (port 3000, dev posture, eligibility probe
  passing with `{"allowed":true}` on the run's first line of work).
  Every run got past the guard into Chromium and failed at cert26's own
  first UI assertion, "mouse open with the contact gate focuses the
  close button". Diagnosis: not this ticket's change — the pre-change
  cert (byte-identical apart from the probe block, run via stash)
  fails at the same assertion, and a probe harness shows focus DOES
  land on the close button given ~2.5 s settle time; the cert's fixed
  assertion window races this dev server's hosted-store latency (the
  recorded port-3000 environment), where cert26's earlier passing runs
  had a local SQLite store. No cert assertion was touched (AC4 forbids
  it); the race is a substrate finding for the fleet owner to
  disposition — filed as ticket 97, not fixed here.
- **AC4:** diff is the probe block and import lines only; output text,
  screenshots, and assertions beyond the error path are unchanged.
- Checks: hygiene 779 files pass, `tsc --noEmit` clean, full vitest
  suite 577 passed / 7 skipped (66 files). Two-axis code review
  (standards + spec, parallel sub-agents) found no hard violations and
  no scope creep; its one note — AC1's "non-cert caller" wording vs the
  two remaining cert fetchers — is recorded above. Zero conversation
  writes reached the shared store: every cert26 run stopped at the first
  focus assertion, before the contact gate submits.

Reviewed through: 1b6104db2
