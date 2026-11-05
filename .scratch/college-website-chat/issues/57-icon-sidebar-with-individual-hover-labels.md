# 57: Match the compact icon sidebar and show one hover label at a time

**Status:** ready-for-human

**Reference:** [Supplied sidebar reference](../references/dashboard-sidebar-hover-labels-reference.png)

**What to build:** Refine the existing dashboard sidebar from ticket 52 to match the supplied narrow, dark icon rail. On desktop its resting appearance is compact and icon-only. Hovering or keyboard-focusing one icon reveals **only that icon's label** in a small callout beside the rail.

- [x] Scope the change to the shared dashboard sidebar and its immediate layout. Do not redesign the Answers page shown in the reference, other page content, the chatbot widget, or dashboard data flows.
- [x] Use the reference's sidebar hierarchy: Springfield crest at the top, a divider, vertically spaced navigation icons, a clear blue active state, a lower divider, and Sign out at the bottom. Reuse the existing brand asset, icon set, color tokens, route links, and role filtering.
- [x] Default to the compact icon rail on desktop for a staff member with no saved sidebar preference. Retain the existing Expand navigation control and persisted preference from ticket 52 so staff can choose to leave full labels visible.
- [x] In the compact state, no text labels appear beside icons at rest. Hovering one navigation icon shows just its own label, anchored outside the right edge of the rail with a small pointer/callout shape like the reference. Moving to a different icon replaces the callout; the other labels remain hidden. Leaving the icon dismisses it.
- [x] Keyboard focus produces the same individual label. Each icon-only link and the Sign out control has an accessible name independently of the visual callout. The callout does not duplicate the name for screen readers or trap focus.
- [x] Make the callout visible beyond the rail boundary and within the viewport, including the first and last rows; avoid clipping by the sidebar or scroll container and avoid covering page controls. Preserve a visible focus ring and at least 44px targets.
- [x] The active icon remains highlighted when another icon is hovered. Hover and focus feedback must not shift the rail, icon positions, or page content.
- [x] The expanded state continues to show its labels without hover callouts. The mobile overlay drawer keeps visible labels and its existing open, close, focus, and role-filtering behavior.
- [x] Sign out uses the same individual-label behavior in compact mode. Its pending sign-out state stays understandable and continues to prevent duplicate submission.
- [x] Respect reduced motion. Check desktop at 1280px, a narrower desktop, and the existing mobile drawer at 390px and 360px; verify pointer hover, keyboard focus, dismissal, persistent choice, no horizontal overflow, and no clipped callouts.

## Scope decisions

The screenshot also depicts Home and Notifications labels. Do not add either as a separate destination: the existing **Email alerts** route serves the notification purpose, and `/dashboard` currently redirects staff to Conversations or editors to Answers rather than rendering a Home page. Keep its existing Email alerts label and route. The callouts all visible in the static screenshot illustrate their design and placement, not simultaneous behavior.

## Context

Ticket 52 already built the collapsible sidebar and individual tooltips, but its desktop default is expanded. This ticket refines its default compact presentation and the reference's tooltip appearance/visibility. The user's clarification is explicit: when one icon is hovered, **only that icon's label appears**. Keep ticket 52's navigation semantics and mobile drawer.

## Comments

2026-11-06: Filed from the supplied screenshot and the user's sidebar-only request. The user clarified that only the hovered icon's label should appear. Follow-up clarification: keep the icon-only rail with an expand option, use Email alerts for notification navigation, and omit a Home icon until there is a defined Home page.
2026-11-06: Implemented and verified. The rail now defaults to compact on desktop: the server render and hydration agree on collapsed (no flash for staff without a preference), and only the exact stored \"0\" marker — written when someone expands — restores labels, so ticket-52 staff who chose collapsed keep the same rail and those who chose expanded keep their labels. The ticket-52 hover tooltips (which the before-screenshot shows were clipped invisible by the rail's overflow) are replaced by ONE state-driven callout in header's SidebarChrome: hovering or keyboard-focusing a row renders a single aria-hidden, pointer-events-none bubble (position: fixed beside the rail at the clamped row center, pointer arrow via ::before, above the page below the drawer) showing only that row's label; moving rows replaces it, leaving or expanding dismisses it, and a nav scroll under a stationary pointer dismisses it too. Links keep their own aria-labels, focus rings, and 44px targets; the active row keeps its highlight during another row's hover; the expanded rail and the mobile drawer stay label-driven with no callouts; Sign out carries the same callout and its pending/duplicate guard is untouched. No Home or Notifications destinations; Email alerts kept; NAV, routes, and role filtering untouched.
- **Tests**: tests/sidebar-compact-callouts.test.ts (8: default-compact + marker semantics, one-callout state with hover/focus parity and scroll dismissal, decorative/clamped/viewport pins, Sign out parity incl. untouched pending guard, expanded/drawer label-driven, CSS pins for fixed pointer bubble + data-open gate + no untokened transition + block wrapper + 44px floors) plus ticket-52 pin amendments in tests/dashboard-sidebar.test.ts (default-compact marker semantics; state-driven callout replaces the per-row hover selectors). Full suite 316 passed + 3 skipped (restart-persistence environmental: the running dev server holds the Next dev lock; untouched). Typecheck and production build clean.
- **Browser certification** (scripts/sidebar-callouts-shots.mjs, idempotent; before-mode included): compact default with cleared storage; exactly one callout naming the hovered row, anchored beside the rail and fully in-viewport (first row and Sign out at the bottom); move-replaces; leave-dismisses; keyboard focus parity; active row stays highlighted; expanded rail shows labels with no callouts; choice persists across reload both ways; drawer labelled + Escape at 390/360; zero overflow at 1280/760/390/360.
- **Screenshots**: references/shots-sidebar-57/before-sidebar-{1280,collapsed-1280,hover-1280}.png (pre-change rail; the hover shot shows the old tooltip clipped invisible) + after-sidebar-{compact-1280,callout-1280,callout-signout-1280,760,drawer-390}.png.
- Two-axis review: Standards — no violations (renamed tipProps→calloutProps, removed a dead CSS fallback, replaced a vacuous transition assertion with a not.toMatch pin); Spec — every checkbox covered, no scope creep; one fragility fixed on review (nav scroll under a stationary pointer now dismisses the callout rather than leaving it detached).

