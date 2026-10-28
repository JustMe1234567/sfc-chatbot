# 15: Add purposeful UI motion with reduced-motion support

**Status:** ready-for-human

**What to build:** Add restrained, consistent transitions to the visitor widget and staff dashboard for opening, closing, new content, hover, focus, and other state changes that benefit from visual feedback. Respect the device's `prefers-reduced-motion` setting throughout.

**Blocked by:** 13: Improve the staff dashboard visual design; 14: Clear the visitor chat and keep the staff transcript. Apply motion to the final layouts and controls.

- [x] Define a small shared set of motion durations and easing choices. Use motion to explain a state change or confirm an action, rather than animating every element. Keep interactions responsive and animations interruptible.
- [x] The widget launcher and chat panel have a clear, subtle open/close transition. Closing with the button, launcher, or Escape returns focus to the launcher and preserves the visitor's current session and draft as before. Repeated rapid open/close actions leave the panel in the correct final state.
- [x] Newly received or sent messages and handoff/claim/status notices get a brief arrival treatment only when they are new. Reloading history or each polling refresh does not replay entrance animations for existing messages, move the reading position unexpectedly, or delay access to content.
- [x] The staff conversation list, selected conversation, relevant panels, buttons, links, tabs, and the Clear conversation confirmation use simple state transitions where they improve orientation. Hover and pressed states have visible feedback; keyboard focus is equally clear without relying on hover or motion.
- [x] Loading, success, error, disabled, and closing states stay understandable without animation. No transition blocks typing, clicking, screen-reader announcements, or navigation. Exit transitions do not delay the underlying state update or leave an invisible control focusable.
- [x] Prefer `transform` and `opacity` for movement and fades; avoid animating layout dimensions or causing page shifts. Keep dependencies small and use CSS where sufficient. Support touch devices without assuming hover exists.
- [x] Under `prefers-reduced-motion: reduce`, remove nonessential movement and replace necessary state changes with immediate or near-immediate non-spatial feedback. The preference is honored on first render and if it changes while the page is open; functionality and focus behavior are identical in both modes.
- [x] Verify widget and dashboard at desktop and phone widths in normal and reduced-motion modes. Include a short motion inventory or before/after capture in Comments, and test rapid toggle, polling/new-message behavior, and reduced-motion behavior at the appropriate seams.

## Context

The current widget loader toggles the iframe's `hidden` attribute immediately; the widget and dashboard CSS have a few hover color changes but no coordinated transition system or reduced-motion handling. The motion should fit the trust-first college support UI from ticket 13, not turn the chat into a decorative animation surface. Use the UI/UX skill's animation and accessibility guidance as a reference.

## Comments

2026-10-26: Captured from the user's request as a separate ticket.

## Comments

2026-10-28: IMPLEMENTED (`ready-for-human`).

**Motion inventory** (everything that moves, and why):

- **Widget panel open/close** (loader): 180 ms ease-out fade + 10 px rise from bottom-right. Closing reverses and only then display-hides (one frame of slack past the transition); a pending hide timer is cancelled by reopening, so rapid toggling always lands on the last action's state. Escape/button close still returns focus to the launcher immediately and preserves session + draft.
- **New messages** (widget): 180 ms fade + 6 px rise, only for messages that are genuinely new on screen. Decided by `src/widget/arrivals.ts` (unit-tested): a word-based key (role + text) means history restores, every 3 s polling refresh, and the persisted twin of a just-sent optimistic bubble never replay. The flag clears on `animationend`, so nothing re-animates on a later remount. A duplicate of identical words arriving later is silent — the accepted cost of never re-animating the twin.
- **Handoff/claim notices + email box** (widget): same arrival treatment, only when the state transition happens live; history restores render them static.
- **Clear-conversation confirmation** (widget): 120 ms fade+rise on open (user-initiated mount).
- **Dashboard hover/pressed**: nav links, desk tabs, desk items, chips, cards, and all button families get 120 ms color transitions; pressed buttons dip 1 px. Pressed shares the hover colors, so the feedback is non-spatial and survives reduced motion (touch devices get no hover).
- **Visitor chips/buttons** (widget): same 120 ms color transitions; chips scale 0.98 pressed.

**Tokens**: one set — 120 ms fast, 180 ms base, ease-out cubic-bezier(0.2, 0.8, 0.2, 1) — defined in `frame.module.css` and `dashboard.module.css` `:root`, with the loader's injected styles using the same values (it cannot import from the Next bundle). Under `prefers-reduced-motion: reduce` the tokens drop to 0 ms, pressed transforms are stripped (colors remain), and the media queries are live — an OS-level change applies without a reload. All movement is `opacity`/`transform`; nothing animates layout.

**Verification** (`scripts/motion-shots.mjs`, headless Chromium, production build, scratch DB): computed transition durations 0.18 s → 0 s (widget) and 0.12 s → 0 s (dashboard) between modes; rapid open/close ×3 + final open lands `hidden=false`, class on, opacity 1; Escape close hides the frame and refocuses the launcher; a sent message carries `data-arrive` inside the animation window and clears after; reloaded history shows zero arrivals; a send under reduced motion still completes and renders. Full matrix captured: widget desktop/phone normal + reduce, dashboard desktop/phone normal + reduce (`references/shots-after/after-motion-*.png`). Full suite green (175 passed; `restart-persistence` skipped by the known environmental dev-server conflict); `npm run typecheck` clean.

**Two-agent review fixes applied**: loader duration unified to the shared 180 ms token (was a third value, 160 ms); pressed feedback now survives reduce via shared hover/active colors; conversation-state application deduplicated into `applyConversationState`; arrivals state slimmed to its one used field; the silent-duplicate trade-off documented at the helper; verification matrix completed (widget phone normal, dashboard phone reduce).
