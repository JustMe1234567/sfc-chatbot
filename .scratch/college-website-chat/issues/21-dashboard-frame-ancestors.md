# 21: Restrict dashboard embedding with frame-ancestors

**Status:** ready-for-human
**Priority:** P2 — security blocker for browser testing
**Found by:** pre-testing audit 2026-10-30 (security + docs passes; verified directly)

**What to build:** `next.config.ts` sets no security headers (verified) and no middleware exists, so dashboard pages can be framed by any origin. Inside a malicious parent frame, clicks carry the app's own Origin, so `sameOriginGuard` passes and clickjacking can drive claim, close, reply, disable, and settings actions.

- [ ] `/dashboard/*` responses carry `Content-Security-Policy: frame-ancestors 'self'` (plus `X-Frame-Options: DENY` for older browsers) via `next.config.ts` headers or middleware.
- [ ] `/widget/frame` remains embeddable from the college origin: its `frame-ancestors` names the configured chatbot/college origin(s) (see `src/config.ts` CORS trust list) rather than `'self'`.
- [ ] `/return` pages get the same treatment as the dashboard (no reason to be frameable).
- [ ] A test or build-level check pins that the dashboard sends the header and the widget frame does not send `DENY`.

## Comments

2026-10-30: Filed from the audit. Verified: `next.config.ts` (only `allowedDevOrigins`), absence of `middleware.ts` in `src/`. The widget iframe must stay cross-origin-embeddable — do not copy a global `DENY` onto it.

2026-11-11: Implemented in commit 1f56a96. `next.config.ts` gained a `headers()` block (no middleware introduced): `/dashboard/:path*` and `/return` carry `Content-Security-Policy: frame-ancestors 'self'` plus `X-Frame-Options: DENY`; `/widget/frame` carries `frame-ancestors` naming the origins from `trustedOrigins()` (src/config.ts CORS trust list — the configured `CHATBOT_BASE_URL` plus both loopback spellings outside production) and gets no `X-Frame-Options` in any form. Trailing slashes on the configured origin are normalized to bare origins for CSP source syntax. Acceptance boxes: (1,3) headers live — verified against a production `next start` build: `/dashboard`, `/dashboard/login`, `/return` all 200/307 with both headers, `/widget/frame` 200 with only the CSP (demo embed page untouched, still plain). (2) widget frame names the trust-list origins rather than `'self'`. (4) `tests/frame-ancestors.test.ts` pins all three header contracts at the config level — the suite has no HTTP-server harness, so the config is the build-level surface; also asserted the widget route carries no `X-Frame-Options` key at all. Typecheck clean; full suite 434 passed / 4 skipped; the one failing file (`restart-persistence.test.ts`) is the known environmental failure — proven pre-existing by booting `next dev` with the pre-change config, which fails identically ("Another next dev server is already running") while the human's dev server holds the dev lock. No screenshots: headers-only change, no visual surface.
