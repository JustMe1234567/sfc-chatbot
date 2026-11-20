# 46: Redesign the fresh chatbot state to match the supplied reference

**Status:** ready-for-human

**Reference:** [Supplied initial chatbot layout](../references/visitor-widget-initial-state-reference.png)

**What to build:** When a visitor opens a fresh chatbot with no conversation history, present a welcoming, composed start screen like the supplied reference: a prominent branded header, a bot greeting rendered as a real chat bubble, and clear suggested-question actions stacked beneath it.

- [ ] Use the reference's overall hierarchy on the fresh state: a substantial branded header at the top; generous breathing room; a left-aligned bot greeting with avatar; then right-aligned suggested-question buttons that visually resemble visitor choices.
- [ ] The header includes the existing close/back control, Springfield College identity, the existing Springfield crest or an approved bot avatar treatment, and the existing overflow menu from ticket 39. Keep the controls' current behavior and accessible names.
- [ ] Present the configurable welcome message from ticket 41 as the first bot-style bubble, with a small bot avatar and a subtle local timestamp. It remains presentation-only: opening the widget must not create a conversation, credential, or stored transcript message.
- [ ] Show published suggested questions as separate, full-width-or-content-width outlined actions stacked vertically on the initial state, following the reference rather than the compact two-row strip used during an active conversation.
- [ ] Align suggested-question actions toward the visitor/right side while keeping long labels readable on narrow screens. Do not truncate essential wording or create horizontal page scrolling.
- [ ] Clicking a suggestion uses the existing send flow exactly once, creates the conversation only at that point, and renders the chosen question as the visitor's first transcript message.
- [ ] After the first visitor message, transition to the normal conversation layout. Ticket 18's compact, persistent two-row suggested-question strip may remain for active conversations; the large stacked treatment is specific to the fresh initial state.
- [ ] Keep typed-question entry available on the initial state. The reference image does not remove the composer; if vertical space is tight, the transcript/start area scrolls while the composer remains reachable and usable.
- [ ] Preserve the existing Springfield College brand assets and established accessible color tokens. The screenshot's green is a composition reference, not authorization to discard ticket 16's approved blue-and-gold identity.
- [ ] Do not introduce a generic stock-person avatar. Prefer the supplied Springfield crest or a simple approved bot mark that remains crisp at small size and has correct decorative/accessible treatment.
- [ ] The layout works with zero, one, four, and many published questions. With many questions, the start area scrolls naturally without covering the greeting, composer, close control, or menu.
- [ ] Verify at 360px, phone, and desktop embed sizes, including long welcome copy, long question labels, keyboard navigation, visible focus, screen-reader announcement of the greeting, reduced motion, and no duplicate greeting after conversation history is restored.
- [ ] Add focused UI/browser coverage and fresh-state screenshots that compare the implemented hierarchy with the supplied reference. Existing ticket 18 and 41 behavior tests must remain green.

## Context

Tickets 18 and 41 implemented the suggested-question strip and configurable welcome message independently. The supplied screenshot establishes a new visual requirement for how those pieces compose before the visitor has started a conversation. This ticket changes only the fresh initial presentation; it does not change answer matching, persistence, staff handoff, or the active-conversation transcript.

## Comments

2026-11-05: Filed from the user's supplied screenshot and request: "I want the initial of the chatbot to be like this." The stable copy of the reference is stored at `references/visitor-widget-initial-state-reference.png`. The reference controls layout and hierarchy; existing Springfield assets, copy configuration, and accessibility behavior remain in force.

2026-11-05: Implemented (`Status:` → ready-for-human).

- **Fresh header** (`headerFresh`): the reference's composition in the approved brand blue — close control at the corner, crest on its white plate (ticket 16's plate rule), "Springfield College" centered. Same close control and accessible name as the conversation header; the ticket-39 overflow menu appears with the conversation chrome, since its one action (Clear) needs a conversation to exist — a genuinely fresh chat has nothing to clear.
- **Greeting row**: the ticket-41 welcome renders as a real bot bubble with the crest avatar left and a subtle local timestamp (aria-hidden, captured once per fresh cycle so re-renders never shift it). Still presentation-only — the embed-smoke 41 slice (no ensureSession, /api/v1/welcome only) holds unchanged, and the journey asserts no credential is minted on open.
- **Stacked suggestions** (`freshSuggestions`): outlined, content-width pills aligned to the visitor side, wrapping long labels (max-width 85%) with no horizontal page scrolling; they scroll together with the greeting in a `startArea` while the composer stays put. Clicking routes through the existing `send()` with the same duplicate-send protection, creating the conversation at that moment; the layout flips to the conversation view on the first message.
- **Conversation layout untouched**: the slim header, ticket-18 two-row strip (now gated to non-fresh states), transcript scrolling, and all ticket 38/42/43 behavior are unchanged; the transcript children are shared (`logContent`), so only the fresh presentation is new.
- **Verification**: embed-smoke gained the ticket-46 contract block (14 embed tests green); `topics-shots.mjs` now asserts the fresh layout live — timestamp present, suggestions stacked (strictly increasing tops) and flush-right (≤2px), no horizontal overflow at 360px, fresh screenshots at desktop + 360 (`after-widget-fresh-desktop/360.png`) for the reference comparison — then picks a suggestion and runs the whole ticket-18/39/41 journey on the conversation view. Suite 225 passed; typecheck + production build clean.
