# 55: Redesign the Answers tab UI/UX

**Status:** ready-for-human

**What to build:** Improve the UI/UX of the existing **Answers tab** in the admin dashboard: cleaner, modern, professional, and user-friendly, while preserving all existing functionality. This is primarily a **frontend UI/UX refactor, not a backend rewrite**. Scope is the Answers tab only — do not redesign or modify Conversations, Analytics, Staff, Email Alerts, authentication, or other areas.

## 1. Page layout and visual hierarchy

- [x] Add a clear "Answers" heading with a short description underneath.
- [x] Position the "New Answer" button in the top-right corner.
- [x] Use consistent spacing, padding, typography, and alignment.
- [x] Maintain the existing Springfield College branding and primary blue color.
- [x] Use subtle borders, rounded corners, and minimal shadows; avoid unnecessary visual clutter.

## 2. Content organized into tabs

- [x] Replace the current long, vertically stacked layout with three tabs: **Answer Rules**, **Handoff Phrases**, **Welcome Message**.
- [x] Answer Rules is selected by default.
- [x] Switching tabs displays the corresponding content without a page refresh.
- [x] Preserve all existing form inputs, values, save actions, and functionality.

## 3. Compact expandable answer cards

- [x] Replace the current large answer cards with compact, expandable cards.
- [x] Collapsed card shows: answer title/category; publication status (Published/Draft); a short preview clamped to two lines; number of trigger phrases; number of keyword conditions when applicable; indicator for an associated college page link when applicable; an expand/collapse icon.
- [x] Expanded card shows: full answer content; publisher information; last reviewed date; existing metadata; an easily accessible **Edit** action.
- [x] Consistent spacing and alignment; subtle hover effects; smooth expand/collapse transitions; no unnecessary card height.
- [x] Preserve existing answer editing and publishing functionality; ensure keyboard accessibility.

## 4. Answer search

- [x] Add a search input above the answer list.
- [x] Filters answers by title/category and answer content; updates results immediately while typing; case-insensitive.
- [x] Displays a helpful empty state when nothing matches.
- [x] Operates on the existing loaded data where possible — no unnecessary API requests.

## 5. Handoff Phrases tab

- [x] Move the existing Handoff Phrases interface into its dedicated tab with a clear section title and short description.
- [x] Preserve the multiline phrase input and the instruction that each phrase goes on a separate line.
- [x] Use a properly aligned Save button instead of a full-width button.
- [x] Preserve existing save behavior and validation.

## 6. Welcome Message tab

- [x] Move the existing Welcome Message interface into its dedicated tab with a clear section title and description.
- [x] Preserve the existing greeting textarea and saving functionality; properly aligned Save button; improved spacing and form readability.

## 7. Responsive design

- [x] Works properly on desktop, tablet, and mobile. On smaller screens: readable card content, metadata and actions wrap gracefully, tabs stay accessible, no horizontal overflow, padding and spacing adjust appropriately.

## 8. Styling guidelines

- [x] Follow the application's existing design system wherever possible. Suggested: existing college blue as primary; light neutral grey background; white cards; subtle neutral borders; 10–12px radius; 16–20px card padding; ~24px section spacing; ~14px body typography; minimal shadows; subtle hover/transition effects.
- [x] No new UI framework or unnecessary dependencies; reuse existing components, styles, and utilities.

## Technical constraints

- Inspect the existing Answers tab implementation before making changes; follow the project's component architecture and conventions.
- Reuse existing state management and API integrations.
- Do not modify database schemas.
- Do not change API endpoints or request/response contracts.
- Do not change answer-matching logic or handoff behavior.
- Do not break existing publishing, editing, or saving functionality.
- Avoid code duplication; keep the implementation maintainable and lightweight.

## Acceptance criteria

- [x] The Answers page has improved visual hierarchy.
- [x] The New Answer button is positioned in the header.
- [x] Answer Rules, Handoff Phrases, and Welcome Message are organized into separate tabs.
- [x] Existing answers display in compact, expandable cards.
- [x] Answer search works correctly.
- [x] All existing answer metadata remains accessible.
- [x] All existing editing and save actions continue to work.
- [x] The interface is responsive across desktop, tablet, and mobile.
- [x] The interface supports keyboard navigation and accessible controls.
- [x] No unrelated pages or backend functionality are affected.
- [x] No unnecessary dependencies are introduced.

## Implementation instructions

1. Inspect the relevant files and identify the existing Answers tab implementation.
2. Understand the current data flow, state management, and save operations.
3. Refactor the existing UI while preserving functionality.
4. Reuse existing components where appropriate.
5. Verify all interactions and responsive behavior.
6. Run existing applicable tests, linting, and type checks.
7. Summarize the changes and identify any potential issues.

Focus on usability, visual consistency, and maintainability. Do not overengineer or add features outside this scope.

## Context

Current state (verified in `src/app/dashboard/answers/page.tsx`): one vertically stacked server-rendered page — a `New answer` link in a publish bar, answer cards rendered as whole-card `<Link>`s (topic + status badge + 140-char preview + publisher/reviewed meta + phrase/keyword/link counts), then `EscalationPhrasesForm` and `WelcomeForm` stacked below. Much of the metadata this ticket's collapsed cards require already renders on today's cards, so the card work is compaction (two-line clamp), the expand/collapse interaction, and surfacing the rest on expand — not new data plumbing. Interaction change to design deliberately: today the entire card navigates to `/dashboard/answers/<id>`; with expand/collapse the card body toggles expansion and the expanded **Edit** action navigates to the editor. Search fits the already-loaded `rules` array (client-side filtering). The tabs pattern should match however the dashboard resolves tabbed navigation elsewhere (Conversations/History tabs in `conversation-desk.tsx`); suggested styling values defer to the existing `dashboard.module.css` tokens wherever they conflict. No conflict with ticket 52's sidebar: this restyles page content only.

## Comments

2026-11-05: Filed from the user's own fully-written specification (objective through implementation instructions reproduced above essentially verbatim, reorganized into the repo's ticket format without dropping requirements). Grounding added from inspecting the current page: metadata already present on cards, whole-card navigation vs. expand/collapse tension, client-side search on loaded data, and the Conversations/History tab precedent.
2026-11-06: Implemented and verified. The server page keeps its guard (ANSWER_RULE_ROLES) and three loads, then hands everything to a new client workspace (answers-workspace.tsx): three in-place tabs (Answer Rules default, Handoff Phrases, Welcome Message) as a role=tablist of buttons with aria-selected/aria-labelledby panels swapped via the hidden attribute (display:flex beats the UA [hidden] rule, so .answersPanel[hidden] re-hides explicitly); client-side case-insensitive search over the already-loaded rules (filterAnswerRules exported for direct testing, no requests); compact expandable cards — one toggle button per card (aria-expanded/aria-controls), collapsed = topic + published/draft badge + two-line clamped preview + phrase/keyword/link counts, expanded = full response + publisher/reviewed trail + an Edit answer link to /dashboard/answers/[id] (the whole-card navigation the Context designed away); collapsed bodies are inert so the Edit link never sits in the tab order; the reveal animates a 0fr→1fr grid row through the motion tokens (instant under reduced motion). The two configuration forms are reused verbatim in their tabs; a scoped .answersPanel .ruleCard button rule left-aligns the Save buttons without touching the rule editor page. Page shell adds the description row with New answer top-right. No API, schema, matching, or editor-page changes; no new dependencies.
- **Tests**: tests/answers-redesign.test.ts (8: page-shell pins, tab semantics + default tab, client-only search + no-fetch pin, card semantics + inert + Edit target, direct filter cases incl. blank/case/content match, CSS pins incl. 44px floors + clamp + motion tokens + scoped Save alignment, editor-page/form preservation). Full suite 294 passed + 3 skipped (restart-persistence environmental: the running dev server holds the Next dev lock; untouched by this ticket). Typecheck and production build clean.
- **Browser certification** (scripts/answers-shots.mjs, idempotent): signs the owner in through the real UI, seeds five rules, asserts tabs (default + aria-selected + no navigation + inactive panels leaving the render), collapsed→expanded with metadata and working Edit navigation, keyboard focus + Enter toggling, live case-insensitive search with the no-match state, both preserved save flows through the real endpoints; screenshots at 1280/760/390/360 with zero overflow. Two fixes found by the cert itself: the .answersPanel[hidden] display override, and hiding the clamped preview while expanded (it duplicated the full response).
- **Screenshots**: references/shots-answers/before-answers-{1280,760,390}.png (pre-redesign page) + after-answers-{1280,760,390,360}.png.
- Known trait (pre-existing, repo-wide, unchanged): dashboard client components format dates with toLocaleString and no explicit timeZone — same as the desk rows; server/browser TZ divergence would surface equally on the desk today.
- Two-axis review: Standards — no violations (dead no-op block in the cert script removed on review); Spec — every checkbox covered, no scope creep; render-worker seed resurrection during db wipes is a cert-infra trait (next start lazily seeds per module registry — the script deletes fixed-id seed rows and re-renders before counting).

