# 35: Keep the chat launcher visible while the chat is open; clicking it again closes

**Status:** ready-for-agent

**What to build:** In the widget loader (`src/widget/loader.ts`, built to `public/widget/v1.js`), the launcher button currently **hides itself** while the chat frame is open (ticket 16's "one crest per view" decision), and closing is only possible via the frame's close button or Escape. Change it to a true toggle:

- [ ] The launcher stays visible while the chat is open — it must not hide.
- [ ] Clicking the launcher while the chat is open closes the chat; clicking it again reopens. The launcher therefore works as an open/close toggle from the page at all times.
- [ ] `aria-expanded` on the launcher keeps reflecting the true state (it already exists — keep it honest through the toggle path).
- [ ] Escape still closes the chat, and after closing (by either Escape or the launcher), focus returns to the launcher.
- [ ] Exactly one brand crest is on screen at a time. Today the crest appears both on the launcher and in the frame header; with the launcher now persistent, resolve the duplication — either the launcher swaps its crest for a clear "close" affordance while open, or the frame header yields its crest — and record which in the ticket comments. Do not silently show both.
- [ ] Rapid toggling (including clicks during the close transition) never wedges the panel — the pending-hide-timer logic must stay correct with the toggle path.
- [ ] The open/close motion honors `prefers-reduced-motion` as today; the frame iframe stays mounted and hidden between closes so session/history persistence is unchanged.
- [ ] No regression at the 360px embed and phone viewports (launcher position/size unchanged).
- [ ] Update the affected tests (`tests/embed-smoke.test.ts` pins loader/frame contracts) and, if any screenshot script assumes the launcher hides while open, update it too.

## Context

Ticket 16 deliberately hid the launcher while the frame was open to avoid repeating the crest, leaving Escape and the frame's own close button as the only ways to dismiss the chat. The user wants standard chat-widget behavior instead: the bubble/icon remains on the page and clicking it toggles the chat. This supersedes ticket 16's hide-while-open decision (that ticket's crest-on-white-plate work and the `[hidden]{display:none}` fix remain relevant — the plate and hidden-attribute handling should survive the change).

## Comments

2026-11-01: Filed from the user's request: "when the icon of the chatbot is clicked, it will still show up when the chat is open. and clicking on the icon again will close the chatbot chat." Related: ticket 16 (launcher hide decision being reversed), ticket 15 (motion tokens in the loader), ticket 26 (focus-on-open — coordinate so toggle-open puts focus in the frame sensibly once 26 lands).

2026-11-01: Implementation decision: the persistent launcher swaps its crest for a clear close “×” while the frame is open. The frame header keeps its crest, so exactly one brand crest remains visible in either state.
