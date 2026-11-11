# 13: Improve the staff dashboard visual design

**Status:** ready-for-human

**What to build:** Give the staff dashboard a coherent, polished visual system suited to a college support desk. Start with an audit of the current screens, then improve typography, spacing, navigation, empty states, controls, and responsive layouts without changing authentication, permissions, routes, or conversation behavior.

**Blocked by:** 12: Messenger-style staff conversation desk with one-day inactivity; 14: Clear the visitor chat and keep the staff transcript; 16: Apply the supplied Springfield College brand assets. Design the completed conversation desk with the supplied identity rather than polishing the old waiting-only inbox.

**Design read:** A redesign of a trust-first college staff tool for people handling live visitor conversations. Favor calm, clear, accessible product UI over marketing-page effects. Use the Springfield College blue-and-gold identity from ticket 16.

**Required skill:** Read `.agents/skills/design-taste-frontend/SKILL.md` (also linked at `.zcode/skills/design-taste-frontend/SKILL.md`) before designing. Use its brief inference, existing-brand audit, visual consistency, typography, contrast, responsive, and preflight guidance where applicable. Its own Section 13 excludes dashboards, so use dashboard-specific interaction patterns and do not apply its hero, photography, marketing-section, or animation prescriptions to the staff tool.

**Reference screenshots:** [Current inbox at a narrow viewport](../references/dashboard-inbox-before.png); [incoming chat alert example](../references/tawk-incoming-reference.png); [conversation workspace example](../references/tawk-conversation-reference.png). Treat the latter two as layout and interaction references, not pixel-for-pixel styling or permission to display visitor network details.

- [x] Audit every staff dashboard surface: inbox/conversation desk, transcript, answers, staff, email alerts/settings, sign-in, and second-factor screens. Record existing colors, type, spacing, components, and the most important visual and accessibility problems before changing styles.
- [x] Establish a shared visual language for the dashboard: purposeful type scale, consistent spacing, surfaces, borders/radii, status colors, links, focus indicators, and button hierarchy. Apply it across the dashboard, not only the inbox.
- [x] Fix the screenshot's cramped header: the page title, navigation links, identity, and sign-out actions remain readable and intentionally arranged at the pictured width. Button labels stay on one line. Use a clear responsive navigation pattern at smaller widths.
- [x] Give the inbox and conversation desk useful hierarchy and an intentional empty state. Active conversation rows should be scannable, with clear selected, unread/attention, claimed, and archived states where data supports them. Do not invent counts or states.
- [x] Follow the supplied conversation-workspace structure: compact dark left rail for Incoming and Active chats, a large transcript workspace to its right, a clear conversation header, and a reply composer anchored at the bottom. Make the empty conversation state deliberate rather than leaving a mostly blank page. Do not add the reference product's Groups, Direct Messages, visitor ban, draft notes, or unrelated controls.
- [x] When a chat needs staff attention, show an obvious in-dashboard badge/count and a compact notification or preview tied to the conversation, similar in purpose to the supplied incoming-chat screenshot. Show a safe conversation label, status, and timing; do not show or store IP addresses, inferred location, ISP, or full visitor URLs. Notification appearance, dismissal, and repeat behavior are specified by ticket 12; preserve accessible announcements and keyboard access.
- [x] Use the Springfield College brand assets and a restrained dark product surface inspired by the references, with accessible blue/gold accents and readable contrast. Adapt the reference to the existing college staff workflow rather than copying Tawk branding, icons, text, or exact pixels.
- [x] Make transcripts and reply controls comfortable for sustained staff use: distinct speaker treatments, legible timestamps, visible ownership/status, and clear primary action. Preserve all existing claim, reply, release, transfer, close, and audit controls.
- [x] Keep forms and settings consistent: labels, help text, validation, loading, disabled, success, and error states are clear. Keyboard and screen-reader behavior is retained or improved; text and controls meet WCAG AA contrast and touch targets are usable.
- [x] Verify desktop, the screenshot's narrow width, and phone width with real rendered screenshots. No clipped text, wrapped desktop action labels, horizontal page scrolling, or controls hidden below a fixed pane. Check both populated and empty conversation states.
- [x] Include before/after visual evidence in the ticket's Comments when implemented. Run typecheck and the relevant existing tests; add tests only for changed behavior or a concrete accessibility risk.

## Context

The current inbox screenshot shows a heading split across two lines, navigation and identity competing for one row, a wrapped Sign out button, default-looking links, and a large mostly empty canvas. The dashboard currently uses CSS modules in `src/app/dashboard/dashboard.module.css`. Ticket 12 changes the inbox information layout; this ticket handles the visual language and polish after that layout is in place.

## Comments

2026-10-26: Requested as a ticket. The supplied design-taste-frontend skill was copied into the project's `.agents/skills` directory and linked into `.zcode/skills` for implementation.

2026-10-26: Added the supplied incoming-alert and conversation-workspace screenshots to `references/`. The user requested this layout without Groups or Direct Messages and explicitly prohibited saving IP addresses. Ticket 12 owns the notification behavior; this ticket owns its visual treatment.

Implemented 2026-10-28 (ticket 13), on the user's explicit order while tickets 14/16 remain open; the dashboard's share of the brand application (ticket 16) lands here, and the visitor widget + demo embed keep their existing look until 16.

Audit of the before state (screenshots in `references/shots-before/`, 18 captures at 1280/730/390 across inbox, conversation, answers, alerts, staff, and login): no design tokens — colors hardcoded per rule (#f3f5f9 page, #fff cards, #1d3a6b buttons), mixed radii (8/12/999); the header crammed title, underlined default links, identity text, and two sign-out buttons into one row that wrapped badly at the pictured 730px width ("Email alerts" broke over two lines, "Sign out" wrapped, identity wrapped to three); the desk's list column was visually indistinguishable from the workspace; red "New message" pills carried the only emphasis; the empty workspace was a blank canvas with one floating gray box; transcript bubbles had no speaker-side treatment; login/enroll were unbranded with the only heading doing identity work; no custom focus indicators; touch targets under 40px.

The visual system now: design tokens in `dashboard.module.css` (`:root` custom properties — brand blue #1d4e89 / deep #163c6b, gold #e3a739, light workspace surfaces, one dark rail palette, danger/ok/status pairs); a shared `DashboardHeader` (brand block: crest + "Springfield College" + page title; role-filtered pill navigation with `aria-current`; identity plus Sign out with "Sign out everywhere" demoted to a ghost control) replacing six per-page headers; the desk rail is dark per the supplied workspace reference (gold selection bar, gold attention chips, state + time + preview rows, blue active tab), the workspace light with a conversation header (state chip, ownership, last-activity), speaker-distinct bubbles (visitor gray left, staff blue right, bot bordered left), and the reply composer anchored after the transcript; a deliberate empty state (crest watermark, heading, guidance) replaces the blank pane; unified status chips everywhere; primary/secondary/ghost/danger button hierarchy with 36px+ targets and `:focus-visible` rings (blue on light surfaces, gold on the dark rail); branded sign-in and second-factor cards with their headings preserved for screen readers behind `srOnly`.

Verified with rendered screenshots (headless Chromium via a dev-only `scripts/design-shots.mjs` driver, not wired into the app or tests) in `references/shots-after/`: desktop 1280, the pictured 730 width, and 390 phone, populated and empty desk states, plus a claimed-conversation capture (`after-conversation-claimed-desktop.png`) showing the bottom-anchored composer. No clipped text, no wrapped desktop action labels, no horizontal scrolling. Typecheck clean; all 132 tests pass unchanged (no behavior change, so no new tests per the ticket).

Judgment calls:

- Worked while 14/16 are open, on the user's order: the dashboard's brand application happened here (assets from `public/brand/`), so ticket 16's remaining scope is the visitor widget, loader demo page, and WordPress embed; ticket 14's clear action will land inside this visual system.
- The suite gained a devDependency (`playwright`) and the screenshot driver script; the driver resets the dev database owner's TOTP enrollment on each run and is for evidence capture only.
- The handoff wording, notification behavior, and all controls are untouched from ticket 12; only their presentation changed. The seeded handoff message's em dash is existing accepted product copy from ticket 02, not new copy.
- Attention chips use gold on both light and dark surfaces with dark text (~8:1); the identity line renders the role capitalized ("Owner") instead of the raw enum.
