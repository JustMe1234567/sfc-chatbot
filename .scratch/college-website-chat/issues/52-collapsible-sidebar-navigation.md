# 52: Collapsible sidebar navigation for the dashboard

**Status:** ready-for-human

**Reference:** [Sidebar layout the user wants](../references/dashboard-sidebar-reference.png)

**What to build:** Replace the dashboard's top navigation bar with a **collapsible left sidebar** matching the reference: a dark navy rail holding every dashboard option, one row per area with an SVG icon and label, the active area highlighted, smooth expand/collapse transitions, hover effects on rows, and hover tooltips showing the option name when the sidebar is collapsed to icons. Page content keeps its existing styling and shifts with the sidebar.

Today `DashboardHeader` (`src/app/dashboard/header.tsx`) renders a top bar: college brand + page title, a horizontal role-filtered nav (Conversations, Analytics, Answers, Staff, Email alerts), and the signed-in identity with Sign out. That component is the single seam — every dashboard page passes `area`/`title`/`name`/`role` to it.

## Layout and content

- [ ] The sidebar replaces the top bar's nav row. It contains, top to bottom: the college brand mark (existing `/brand/` logo) and name, the nav items, and the signed-in identity plus Sign out pinned at the bottom.
- [ ] Nav items are exactly the existing five areas with today's role filtering and hrefs: Conversations, Analytics, Answers, Staff (owner-only), Email alerts. Owners, staff, and editors each see the same subset they see today.
- [ ] Every item has a hand-authored **inline SVG icon** on a consistent grid (chat bubbles for Conversations, chart for Analytics, document for Answers, people for Staff, bell/mail for Email alerts, arrow for Sign out). No icon library dependency is added; icons inherit `currentColor`.
- [ ] The page title renders as a heading row at the top of the content area. `DashboardHeader`'s external contract (props: `area`, `title`, `name`, `role`) does not change, so no page component needs editing for the chrome swap.
- [ ] Content keeps the existing light styling, max-width reading measure, and every page's current markup. Only the shell changes from a centered column to a grid: sidebar column plus content column.

## Expand/collapse behavior

- [ ] Expanded state shows icon + label (~240–260px). Collapsed state is an icon-only rail (~64–72px) with labels hidden.
- [ ] A toggle control (chevron icon that rotates with state) collapses and expands. Width and label changes animate with smooth CSS transitions; icon-only rows keep stable alignment so nothing jumps mid-transition.
- [ ] The collapsed/expanded choice persists across navigation and reloads (localStorage), defaulting to expanded on desktop. An unknown/stored-invalid value falls back to expanded.
- [ ] While collapsed, hovering (or keyboard-focusing) an item shows a tooltip to the right of the rail with the item's label. While expanded, no tooltips render — the label is already visible. Tooltips never obscure the active highlight and dismiss on pointer leave and blur.

## Motion, hover, and active states

- [ ] Nav rows have a hover effect (subtle background/indent shift) with a transition; the active item is visually distinct (accent background treatment per the reference) and carries `aria-current="page"` exactly as the top nav does today.
- [ ] All transitions respect `prefers-reduced-motion`: motion collapses to an instant state change while every element stays fully usable.
- [ ] No animation library is added — plain CSS transitions only.

## Access, keyboard, and narrow screens

- [ ] The nav keeps `nav` semantics with its accessible name (`aria-label="Dashboard"`). Tab order, visible focus, and touch-target sizing (ticket 27 standard, ≥44px rows) hold in both states.
- [ ] At narrow widths (≤720px, including 360px) the sidebar does not squeeze the content: it collapses into an overlay drawer opened from a header control, with a scrim, Escape-to-close, scrim-click-to-close, and it closes on navigation. The desktop persistence state does not fight the mobile drawer (narrow screens don't restore the desktop rail mid-overlay).
- [ ] Screen-reader and keyboard users can reach every item, toggle, and Sign out in both desktop and drawer forms.

## Constraints and regression safety

- [ ] Routes, role gating, the sign-out flow, and every page's content are unchanged — this ticket moves chrome, not behavior.
- [ ] All existing dashboard tests keep passing; nav contract (labels, hrefs, role filtering, `aria-current`) is covered by tests in the repo's current style.
- [ ] Styling stays inside `dashboard.module.css` and its token system (brand blue/gold); no global element selectors — this repo's CSS Modules setup rejects non-pure selectors, and the sidebar must not leak styles into page content or the widget.
- [ ] The widget (`/widget`) and public site are untouched by the shell change.

## Context

The reference (user-supplied) shows the target: dark navy left rail, white icon+label rows, blue-highlighted active item, light content pane — the standard admin-sidebar pattern. The current top bar wraps awkwardly on narrow screens (its mobile grid-template-areas reflow in `dashboard.module.css`), which the drawer replaces. `DashboardHeader` is rendered by every dashboard page, so it is the one place to build this; `SignOutButton` and the brand logo already exist as components/assets. Keep the dark sidebar token set adjacent to the existing light-page tokens so later dark-mode work has a foothold.

## Comments

2026-11-05: Filed from the user's request with their reference screenshot: collapsible sidebar holding all dashboard options on the left, smooth transitions, hover effects, hover tooltips on the icons, SVG icons. Decisions recorded: inline dependency-free SVG icon set; CSS-only animation with reduced-motion respect; localStorage persistence defaulting expanded; overlay drawer below 720px; `DashboardHeader` props frozen so pages don't change.

2026-11-05: Implemented (`Status:` → ready-for-human).

- **One component, two shells.** `DashboardHeader` is now a client component with the same `area/title/name/role` props (all seven render sites unchanged, verified by the review). It renders: the desktop rail (`<aside class="sidebar">` — brand, collapse toggle, role-filtered nav, identity + Sign out pinned at the bottom via a nav-that-scrolls layout so short viewports keep the identity visible), the mobile drawer + scrim (only while open), and the content heading row (menu control + the page's `<h1>`). `.shell` becomes a two-column grid (`auto minmax(0,1fr)`); page blocks auto-place into the content column, keeping their own max-widths.
- **Icons:** a shared `Mark` wrapper (24-grid, stroke-only, `currentColor`) with five per-area path sets, a chevron for the toggle, a hamburger for the drawer control, and a `SIGN_OUT_MARK` arrow passed into `SignOutButton` via a new optional `icon` prop — no icon library, no fixed fills, no CSS text-glyph hacks.
- **Collapse:** chevron toggle; `--sidebar-width` 252px → 68px animated through the motion tokens (0ms under `prefers-reduced-motion`); labels fade via max-width/opacity (display:none can't animate — review catch); each link carries its own `aria-label` so the collapsed icon rail never presents an empty accessible name (review catch); the collapsed Sign out shrinks to its arrow. Choice persists in `localStorage` key `dashboard.sidebar.collapsed` (restored after mount so SSR/hydration agree; only `"1"` collapses — anything else reads as expanded).
- **Tooltips:** rendered per item but displayed only from the collapsed rail on hover, `:focus-visible`, or `:focus-within`, floating outside the rail so they never cover the active row's highlight; dismissed on leave/blur.
- **Narrow screens (≤720px):** the rail leaves the layout entirely (the shell goes single-column); the content-head Menu control (aria-expanded/aria-controls) opens the drawer — the same surface composed with the sidebar class, re-shown as a fixed panel over a scrim. Focus moves into the drawer on open, returns to the Menu control on Escape/scrim-close, and navigating closes it.
- **Constraint compliance:** styling stays in `dashboard.module.css` pure selectors; the old `.topBar/.topNav/.topIdentity` rules are fully removed; the widget and public surfaces are untouched; routes, role gating, and sign-out flow unchanged (`SignOutButton` gained only the optional icon slot).
- **Tests:** `tests/dashboard-sidebar.test.ts` (9 pins: NAV table byte-equality — the seam ticket 53 coordinates against — aria-current/aria-label, icon authorship with no library, persistence + fallback, drawer contract, CSS pins for grid/widths/44px rows/tooltips/≤720 rules/old-chrome removal). Suite: 272 passed + 3 env-skipped; the only failures in the tree are ticket 53's own in-flight test pinning ITS nav integration, which is that ticket's pending amendment to this component.
- **Browser certification** (`scripts/sidebar-shots.mjs`, light-wipe idempotent on `history51.db` :3216): expanded rail content + geometry (content starts beside the rail), collapse to 68px with hidden labels and persistence across reload, hover + keyboard-focus tooltips with dismissal, drawer focus/Escape/scrim/navigation close paths, aria-current following navigation, no overflow at 390/360. Screenshots: `references/shots-sidebar/after-sidebar-{expanded,collapsed,tooltip}-1280.png`, `after-sidebar-drawer-390.png`, `after-sidebar-360.png`.
- **Review fixes applied** (two axes): aria-labels on collapsed links; label fade instead of display:none; hover shift removed (it animated padding, violating the file's own ticket-15 "never layout dimensions" rule); `Mark` icon dedup; the drawer composes the sidebar surface instead of re-declaring it (and re-shows display, which the composition initially lost — caught by the certification run); z-index and grid-span comments; Sign out arrow became a real inline SVG on the icon grid.
- **Note for the human pass:** another session's ticket-53 work sits uncommitted in the tree (visitor-emails store methods, a Follow-up email row, an untracked `/dashboard/emails` page). It is NOT part of this commit; its nav amendment to `header.tsx` lands with ticket 53 per the recorded coordination note.
