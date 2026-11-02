# 40: Launcher becomes a square, icon-only crest button (drop the "Chat" pill)

**Status:** ready-for-human

**Implementation evidence:** [Demo page showing the square, icon-only launcher](../references/shots-after/after-demo-launcher.png).

**What to build:** Today the launcher rendered by `src/widget/loader.ts` (built to `public/widget/v1.js`) is a rectangle: the crest on its white plate with the word "Chat" appended (ticket 16's design). Change it to a **square, icon-only button** — just the crest:

- [x] The launcher is a square (a modest border-radius to match the widget's aesthetic is fine) sized like a standard chat bubble button — roughly 52–60px — anchored bottom-right as today.
- [x] The "Chat" text label is removed. The button keeps its existing `aria-label` "Chat with Springfield College" (`loader.ts`), so it stays screen-reader accessible with no visible text.
- [x] The white plate behind the crest is KEPT — ticket 16 found the transparent crest's blue shield vanishes on same-hue blue backgrounds, and the launcher must survive arbitrary college-page backgrounds (the square button's own surface IS the plate).
- [x] Gold `:focus-visible` ring, `[hidden]{display:none}` handling, and the ticket-15 entrance/exit motion all carry over unchanged.
- [x] The launcher's hide/show behavior is whatever ticket 35 decides (persistent toggle vs hide-while-open) — this ticket changes only the button's shape/contents, not its lifecycle.
- [x] Demo page, WordPress test page, and any seeded screenshot content showing the old pill get updated so nothing documents the retired look.
- [x] Update tests/scripts that pin the crest+Chat markup (loader contract pins in `tests/embed-smoke.test.ts`, `scripts/design-shots.mjs`/`motion-shots.mjs`/`topics-shots.mjs` selectors if they target the label).
- [x] Verify at 360px, phone, and desktop: the square launcher never overlaps page content problematically and stays an easy touch target (far exceeds the ≥24px minimum from issue 27).

## Context

The user wants the standard chat-widget look: a square crest icon, not a rectangle with "Chat" appended. This amends ticket 16's launcher composition (its crest-plate finding, focus ring, and hidden-attribute fix all remain load-bearing). With ticket 35 (launcher toggle) likely making this button the open/close control, the icon-only square is also where a future "close while open" affordance would live — but that swap is ticket 35's concern, not this one.

## Comments

2026-11-01: Filed from the user's request: "i want the icon of the chatbot to be using the square logo so it will just be square instead of this rectangle with the word chat appended on it." Amends ticket 16. Coordinates with ticket 35 (button lifecycle/toggle) — implementing 40+35 together is natural since both reshape the launcher.

2026-11-02: Implemented as a 56×56 white launcher with a 14px radius and a 40px contained crest. Removed the visible "Chat" label while retaining `aria-label="Chat with Springfield College"`; ticket 35's open/close lifecycle and close-icon swap remain unchanged. The embed contract test passed, typecheck passed, and browser checks passed at desktop, 390px phone, and 360px widths with no overflow. The full suite reached 183 passing tests; only the process-restart suite could not start its nested Next dev server because another dev server already held this worktree's development lock.
