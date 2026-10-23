# 05: Publish answer rules and topic buttons

**What to build:** Authorized staff can maintain approved answers in the chatbot dashboard. Publishing a rule makes its topic button, response, aliases, and optional college page link available to visitors without redeploying the widget.

**Blocked by:** 02: Unknown question reaches the shared inbox.

**Status:** resolved

- [x] Authorized content editors can create, revise, preview, publish, and unpublish an answer rule.
- [x] Published rules can include a topic button, approved response, phrase aliases or keyword conditions, and an optional college page link.
- [x] Draft and unpublished rules never answer visitors; publishing or unpublishing changes the visitor experience without a widget redeploy.
- [x] The dashboard shows who published a rule and when its answer was last reviewed.
- [x] A complete flow proves that an editor publishes a rule and a visitor receives it, while an unauthorized user cannot publish one.

## Comments

Implemented 2026-10-23 (ticket 05). API flows in `tests/answer-rules.test.ts`; staff API at `/api/staff/answer-rules` (list/create/revise/publish/unpublish, owner+editor roles, CSRF-guarded); public `GET /api/v1/topics` feeds the widget's topic buttons; dashboard pages at `/dashboard/answers`. Verified in a browser against a production build: topic buttons render and answer, a rule published mid-run appears on the next widget open, and the revise → re-publish → visitor-receives loop works with no redeploy.

Judgment calls:

- Revising a published rule returns it to draft: published means "this exact content was reviewed", so any change requires re-publishing. The last review stamp stays visible meanwhile.
- A topic click sends the rule's first phrase through the normal question path (one code path, deterministic matcher, existing pause/closed/rate-limit handling). Keywords-only rules fall back to the topic label. Phrase overlap with another rule can therefore route a click elsewhere until ticket 06's choice UX exists.
- Keywords-only rules are valid (spec: "phrase aliases or keyword conditions"); validation requires at least one phrase or one keyword condition.
- The editor preview renders the button/response/link as visitors will see them; it does not run the matcher (several-match preview belongs to ticket 06).
- Unpublish and revise record no actor yet; the accountability audit trail (spec: records content publishing) belongs with ticket 08's staff-management audit work.
- Seeding is now insert-if-absent so a restart cannot overwrite dashboard edits of seeded rules.
- Tests warm the app service in `beforeAll` (helpers.warmChatbotService): cold service init under a full parallel suite run could exceed a first test's 5s timeout (pre-existing, reproduced on the unmodified tree).

**2026-10-23 — accepted as complete.** The human pass accepted the implementation, its browser checks, and the recorded judgment calls as they stand. Status set to `resolved`.
