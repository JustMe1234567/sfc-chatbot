> *This was filed by the ticket-76 implementation session, 2026-11-19.*

# 78: Production-mode widget certs need an allowlist-aware harness

**Category:** chore
**Status:** ready-for-human

## Agent Brief

**Summary:** Ticket 76 made production deny every non-allowlisted origin, which is correct behavior — but it breaks the widget-driving steps of cert scripts that run against a production build served from a loopback origin, because a loopback http origin is (by design) never a producible allowlist entry.

**Current behavior:**
`scripts/cert76-embed-allowlist.mjs` (new) runs in production mode on a scratch Postgres database and certifies the widget through a self-signed local **HTTPS** host that the run itself adds to the allowlist — the exact production shape. Older cert scripts that drive the widget from the same-origin demo page (`scripts/cert70-branding.mjs`'s launcher-chathead steps, and any prod-build run of the `motion-shots`/`design-shots` era scripts) now find the demo origin denied: the loader renders nothing and the assertions that expect a launcher fail. Dev-mode cert runs (cert26/27-style, `next dev` + `CHATBOT_BASE_URL`) are unaffected because `trustedOrigins()` keeps the loopback embeddable outside production.

**Desired behavior:**
Prod-build widget certs either (a) adopt the cert76 recipe — serve the host page from a self-signed local HTTPS origin and add that exact origin to the allowlist (scratch DB write or owner API) before the widget-driving steps — or (b) explicitly document and pin that they run in dev mode. The choice per script is the ticket; no application behavior changes.

**Acceptance criteria:**
- [x] Every cert script that drives the widget from the demo page under a production build either uses an allowlisted local HTTPS host or states dev-mode-only in its header and fails fast with a clear message under a production build.
- [ ] `cert70-branding.mjs` completes end-to-end again on a fresh scratch database. *(Open box, substrate-blocked — see the 2026-11-19 comment: the Supabase auth branch removed the fresh-scratch run substrate for owner sign-in entirely. The harness is implemented and locally verified; the authed run needs the maintainer's substrate decision, tracked as the run decision in ticket 80.)*
- [x] No application source changes; scripts only.

**Out of scope:**
- Any change to the allowlist rules, the dev exceptions, or trusted origins.
- Renaming or consolidating the cert scripts.

## Comments

2026-11-19: IMPLEMENTED (`ready-for-human`). Per-script choice, as the ticket allowed:

- **cert70-branding.mjs — recipe (a), the cert76 recipe.** The widget steps
  now drive a minimal host page from a self-signed local HTTPS origin
  (openssl key material in a temp dir; `ignoreHTTPSErrors` context), added to
  the embed allowlist by a direct settings write before the widget steps,
  with the write verified through the eligibility route. The run captures
  the `embed_allowlist` + three `branding_*` settings rows up front and
  restores them byte-identically in a `finally` (cleanly aborted runs too),
  and fails fast with a clear message when `CHATBOT_CERT_PG_URL` is missing
  or the target store's chathead is not at the bundled defaults (a
  customized store would fail the mid-run default assertions otherwise).
  Usage: `node scripts/cert70-branding.mjs <outdir> [port] [hostPort] [username]`.
- **Dev-mode-only pins (option b) for the rest of the widget-driving fleet:**
  cert26, cert27, cert29, cert66, cert67 (standalone inline probe) and
  motion-shots, analytics-shots (only when the widget step is not
  `SKIP_WIDGET`d), topics-shots (shared `assertDemoOriginEmbeddable` in
  `scripts/lib/shot-driver.mjs`). Each states dev-mode-only in its header
  and probes `/api/v1/embed-eligibility` for the demo origin right after the
  healthz wait — under a production build that answer is `allowed:false` for
  a loopback origin, so the run dies in one line with the exact instruction
  (`next dev` + `CHATBOT_BASE_URL`) instead of an opaque launcher timeout.

**Verification (all local, zero writes to the hosted Supabase project):** a
production build served from scratch Postgres `sfc_cert78` on the 5433
cluster with the cert76 stub-Supabase env denied the loopback demo origin
(`allowed:false` confirmed) — all eight pinned scripts failed fast with the
intended message; the true branch was confirmed read-only against the dev
server's `allowed:true` posture. cert70's harness chain (capture → fresh-store
guard → openssl host → allowlist write → eligibility assert) ran green and its
aborted run restored the settings table byte-identically (md5-verified
before/after). Full suite 528 passed / 5 skipped / 0 failed; `tsc --noEmit`
clean.

**Why criterion 2 stays open:** while the harness was being implemented, the
Supabase auth branch's reality surfaced — staff password verification
delegates to hosted Supabase Auth and session validation reads Supabase's
`auth` schema inside the DATABASE_URL database itself, so a fresh scratch
database can no longer authenticate a staff sign-in on ANY run. cert70's
sign-in was adapted to the username flow (it could not complete at all
otherwise), but the authed run now needs the hosted test project (shared
state; disposable cert owner; maintainer's yes) — that decision, plus the
fleet-wide stale sign-in discovery, is filed as ticket 80. The harness itself
is proven; only the authed journey awaits a substrate.
