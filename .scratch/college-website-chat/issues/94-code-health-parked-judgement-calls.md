# 94: Consolidate the seven parked code-health judgement calls

Status: needs-triage

## What to build

Seven judgement-call smells have been found, parked, and re-enumerated
by every code-review rerun since the 75fcedd31..HEAD era. This ticket is
the single place to disposition them — accept as-is (recorded here and
suppressed in future reruns) or approve a fix as its own follow-up
ticket per item. It files the list; it fixes NOTHING.

1. **settings.ts Divergent Change** — `src/settings.ts` holds ~10
   unrelated settings domains and gained 18 exports in the reviewed
   range; split so each module changes for one reason.
2. **REASON_MESSAGES twin** — server copy `src/domain/embedAllowlist.ts:96`
   vs client copy
   `src/app/dashboard/settings/embed-allowlist-settings.tsx:14`; drift
   risk between the save error and instant feedback.
3. **Cert-script embed-guard duplication** — cert26/27/29/66/67 paste the
   ~12-line embed-eligibility guard inline while
   `scripts/lib/shot-driver.mjs` exports `assertDemoOriginEmbeddable`.
4. **Ban-check re-inlined twice** — reset-password route and
   recover-staff-credentials drift from `src/api/staff.ts:55`'s triple
   variant (including the `banned: "1"` string handling).
5. **logs-workspace.tsx repeats** — `toLocaleString("en-GB")` ×4 and a
   re-implemented analytics tablist handler.
6. **"Four = half of pool 8" bound stated in three places** —
   `src/app/dashboard/settings/page.tsx:53`, the `docs/deployment.md`
   `PG_POOL_MAX` row, and
   `tests/settings-page-read-concurrency.test.ts:166`.
7. **JSON-stringify prop pins** —
   `tests/settings-page-read-concurrency.test.ts` pins rendered values by
   stringifying the whole tree; brittle to harmless reordering.

## Acceptance criteria

- Every item carries a recorded disposition (accepted-as-is here, or a
  follow-up ticket filed).
- No item is fixed inside this ticket.

## Comments

2026-11-20: Filed from the session retro. The seven have been re-found
and re-parked across four review reruns; each parking was deliberate
(the owner declined fixes during PR runs). This ticket ends the
re-enumeration by giving the list one home to disposition.
