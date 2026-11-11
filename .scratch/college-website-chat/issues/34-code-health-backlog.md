# 34: Code-health backlog

**Status:** ready-for-human
**Priority:** P3 — health polish, queued (non-gating)
**Found by:** pre-testing audit 2026-10-30 (health + spec passes, line-cited)

Small health findings, batched as a checklist — work any subset:

- [x] Bare `3000` poll literal in `frame/page.tsx:286` while the dashboard names the same idea (`auto-refresh.tsx:11`); inline `24*60*60*1000` retention math appears twice in `presence.ts:82,103`.
- [x] Brand `#1d4e89` and 180ms motion tokens hardcoded across `frame.module.css` (11×), `dashboard.module.css:40`, and the demo page's inline style. The loader's copy is a documented self-containment requirement — the CSS-module copies are not; introduce CSS custom properties.
- [x] Stale comment in `src/widget/loader.ts:14` claims "one 160ms ease-out" while the style and comment at :25/:103 say 180ms.
- [x] `DeskItem.state` weakens the `ConversationState` union to `string` (`src/domain/inbox.ts:14`), forcing `STATE_CHIPS`/`STATE_LABELS` to key off raw strings — restore the union type.
- [x] `scripts/dump-auth-schema.ts` is an unwired one-off debug tool absent from `package.json` — delete or wire it.
- [x] ~39 exports have no consumer outside their own module (`MAX_PHRASES` family, `toPositionalParameters`, `analyticsLiveWindowMs`, several contract types) — shrink visibility where it's constants, keep contract types.
- [x] Unexpected store errors bubble to Next's default HTML 500; API clients (the iframe) can receive non-JSON failures. A small route-level catch mapping to a JSON 500 keeps the widget's error handling honest.

## Comments

2026-10-30: Filed from the audit. Each item is independent; expect this to be closed incrementally rather than in one pass.

2026-11-12: Implemented in commit 8855373 — all seven items. (1) OPEN_POLL_MS/CLOSED_POLL_MS in the frame's poll effect; DAY_MS in presence.ts (both literals). (2) frame.module.css :root gained --sfc-blue/--sfc-gold (dashboard's established names) and 15 hex literals became var() references; dashboard skipLink color → var(--sfc-blue). Demo page + loader intentionally left literal, recorded here: the loader's copy is the documented self-containment requirement, and the demo page emulates the college HOST page's own styling (a WordPress-paste fixture that cannot read the app's CSS-module tokens) — same self-containment class, not an omission. (3) loader comment 160→180ms (v1.js rebuild byte-identical — esbuild strips comments). (4) DeskItem.state and DESK_STATE_LABELS/deskLabel keyed by ConversationState; STATE_CHIPS in conversation-desk + contacts keyed by the union (values stay string | undefined — CSS-module class access is optional); dead ?? fallbacks removed in desk-entry, conversation-desk, and the deskLabel body. (5) dump-auth-schema.ts + its private auth-schema-config.ts deleted (zero consumers, unwired). (6) six zero-consumer MAX_* constants plus analyticsLiveWindowMs and toPositionalParameters un-exported (grep-verified zero consumers in src/tests/scripts); MAX_TOPIC_LENGTH/MAX_RESPONSE_LENGTH stay exported (real consumers); contract types kept. (7) NEW src/api/serverError.ts: jsonServerError (JSON 500 in the codebase's { error: { code, message } } envelope + console.error) and withJsonErrors wrapper adopted by ALL 10 /api/v1 route files (12 exports) — thrown store errors now reach the iframe as JSON; /api/staff/* left unwrapped (the audit's client is the iframe; a follow-up could extend it). Reviews drove fixes: the first frame.module.css comment misdescribed ticket-70's --sfcw-* scope (corrected), and item 4 was initially half-done (STATE_CHIPS still string-keyed — completed). Two test pins updated where the named constants/typed fallback changed the pinned text (near-live cadence now also asserts the constant VALUES; history-compact lost its dead-fallback text). Typecheck clean; full suite 498 passed / 3 skipped / 0 failed.