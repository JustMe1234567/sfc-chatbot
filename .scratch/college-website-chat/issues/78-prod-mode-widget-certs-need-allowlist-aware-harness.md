> *This was filed by the ticket-76 implementation session, 2026-11-19.*

# 78: Production-mode widget certs need an allowlist-aware harness

**Category:** chore
**Status:** ready-for-agent

## Agent Brief

**Summary:** Ticket 76 made production deny every non-allowlisted origin, which is correct behavior — but it breaks the widget-driving steps of cert scripts that run against a production build served from a loopback origin, because a loopback http origin is (by design) never a producible allowlist entry.

**Current behavior:**
`scripts/cert76-embed-allowlist.mjs` (new) runs in production mode on a scratch Postgres database and certifies the widget through a self-signed local **HTTPS** host that the run itself adds to the allowlist — the exact production shape. Older cert scripts that drive the widget from the same-origin demo page (`scripts/cert70-branding.mjs`'s launcher-chathead steps, and any prod-build run of the `motion-shots`/`design-shots` era scripts) now find the demo origin denied: the loader renders nothing and the assertions that expect a launcher fail. Dev-mode cert runs (cert26/27-style, `next dev` + `CHATBOT_BASE_URL`) are unaffected because `trustedOrigins()` keeps the loopback embeddable outside production.

**Desired behavior:**
Prod-build widget certs either (a) adopt the cert76 recipe — serve the host page from a self-signed local HTTPS origin and add that exact origin to the allowlist (scratch DB write or owner API) before the widget-driving steps — or (b) explicitly document and pin that they run in dev mode. The choice per script is the ticket; no application behavior changes.

**Acceptance criteria:**
- [ ] Every cert script that drives the widget from the demo page under a production build either uses an allowlisted local HTTPS host or states dev-mode-only in its header and fails fast with a clear message under a production build.
- [ ] `cert70-branding.mjs` completes end-to-end again on a fresh scratch database.
- [ ] No application source changes; scripts only.

**Out of scope:**
- Any change to the allowlist rules, the dev exceptions, or trusted origins.
- Renaming or consolidating the cert scripts.
