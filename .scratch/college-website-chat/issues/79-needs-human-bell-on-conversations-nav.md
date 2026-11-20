# 79: Show a needs-human bell on the Conversations navigation item

Status: done

## What to build

Give the dashboard sidebar's **Conversations** navigation item a small bell indicator that appears exactly while at least one live desk conversation sits in **Needs human** — the dashboard-wide visual counterpart to ticket 77's repeating alert. No numeric count is rendered anywhere; presence is the message.

- Draw a simple stroke-style bell SVG in the same hand-plotted 24-grid idiom as the other nav marks (`Mark` in `src/app/dashboard/header.tsx` — stroke-only, `currentColor`-inheritable) and place it at the **top-right corner of the existing chat-bubble icon**. One identical treatment in the expanded sidebar, the compact icon rail, and the mobile drawer (all render `SidebarChrome`); its appearance must not shift the row's layout.
- Show the bell **only when ≥ 1 conversation is in Needs human** (`desk.incoming`, the live `awaiting_staff` set — the exact list ticket 77's buzzer alarms on). Hide it the moment the state clears. Never render a "0" state or a number.
- Color the bell the **Needs-human green** from ticket 66's status treatment (the same green the desk's waiting count uses), so the bell pairs with the existing tier palette.
- Hide the bell from assistive technology (`aria-hidden`); while it shows, the row's accessible name reads **"Conversations — needs human"** (otherwise the plain "Conversations" label it carries today). The collapsed rail's callout mirrors the same wording.
- **Signal**: add a staff-only `GET /api/v1/needs-human` answering just `{ needsHuman: true | false }`, following the staff-gating pattern of the handoff-options staff routes (unauthenticated requests rejected). The sidebar polls it every **10 seconds while the tab is visible**, fetches immediately when the tab becomes visible again (the visibility pattern of `AutoRefresh`), and **keeps its last state on a failed request** rather than flashing the bell off.
- The bell is driven by its own poll, not by desk data, so it is correct from **every dashboard page** (Settings, Answers, Analytics, …) and not only on the inbox desk.
- Editors, whose role has no Conversations row, make **no polling requests** at all.
- Only the Conversations row changes; no other nav item, page, or behavior is touched.

## Acceptance criteria

- With one or more conversations in **Needs human**, the bell shows on the Conversations item in the expanded sidebar, the collapsed icon rail, and the mobile drawer, at the icon's top-right corner, in the Needs-human green.
- Taking over, clearing, or otherwise moving the last waiting conversation out of **Needs human** hides the bell (within one poll cadence) on every dashboard page.
- With zero waiting conversations the bell is absent and the row renders exactly as today — no badge, no "0", no layout shift.
- No numeric count appears anywhere in the UI.
- The row's accessible name is "Conversations — needs human" while the bell shows and "Conversations" otherwise; the bell itself is not announced; the collapsed-rail callout matches the same wording.
- `GET /api/v1/needs-human` rejects unauthenticated requests and returns `{ needsHuman: <boolean> }` for staff; the boolean is true exactly when at least one live desk conversation is in `awaiting_staff`.
- The sidebar polls at a 10-second cadence while visible, re-fetches on becoming visible, pauses while hidden, and keeps the previous bell state across a failed request.
- Editors trigger no requests to the endpoint.
- Tests cover the endpoint (auth + boolean semantics) and the sidebar wiring (cadence, visibility catch-up, failure retention, render conditions, accessible name, no-counter); visual certification screenshots capture the bell showing and hidden in both the expanded and collapsed rail.
- `GLOSSARY.md` gains a **Needs-human bell** entry.

## Comments

2026-11-21: OWNER ACCEPTED / STATUS RECONCILIATION. The implemented, reviewed,
and certified result recorded below is accepted. The stale `ready-for-human`
status is closed as `done`; no implementation change was made in this
reconciliation.

2026-11-19: Filed from the user's request ("on this tab, there should be a small bell or like a warning svg … for the total chats that needs human"), sharpened through grill-with-docs. Settled decisions: the bell counts only the Needs-human set (ticket 77's alarm set, not Contact Me requests or New-message attention); the user dropped the counter during grilling — a bell without a number is enough; icon-corner placement, identical in collapsed and expanded; Needs-human green + accessible-name change; tiny boolean endpoint + 10s sidebar poll (the sidebar has no desk data outside the inbox page and nothing re-renders it while staff sit on another page, so even a show/hide signal needs one lightweight request).

2026-11-19: Implemented. The endpoint reads the same desk read model as the buzzer (`summarizeConversationDesk`, so bell and alarm cannot drift), the bell renders inside the shared chat-bubble SVG on the 24-grid (no layout shift, identical in all three shells), and the sidebar poll is a `createNeedsHumanSignal` cycle with the AutoRefresh visibility pattern. The compact rail's callout now resolves its wording at display time through a live ref, so a bell appearing or clearing under a resting pointer updates the callout in place. The route joined the proxy matcher so the poll itself refreshes the session cookie. Cert: prod `next start` + scratch Postgres, real Supabase sign-in with fresh enrollment, six screenshots (showing/hidden × expanded/collapsed + the cross-page arrival on Settings); the visual pass found one mid-animation capture, re-taken settled. Suites green on both backends (SQLite 565/0, Postgres 567/0).

Review decisions worth noting for the human pass: the bell wears `--ok-bright` (the ticket-66 dark-rail variant, `dotNeedsHuman`'s color) rather than the waiting-count pill's `--ok` — the quoted clause describes the pill on a light panel; on the navy rail the deep green would sink, and ticket 66's own rail treatment already picked the bright variant. And the callout update-on-flip goes one step past "the callout mirrors the same wording": a pointer resting on the row when the bell flips now sees the wording change live instead of going stale until re-hover (found by the cert, disclosed in code).
