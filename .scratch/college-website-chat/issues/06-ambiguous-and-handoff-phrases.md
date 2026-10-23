# 06: Resolve ambiguous matches and handoff phrases

**What to build:** Typed questions route predictably when wording overlaps. The visitor chooses among several matching topics, while a configured handoff phrase goes to staff immediately even if an answer rule also matches.

**Blocked by:** 05: Publish answer rules and topic buttons.

**Status:** resolved

- [x] Staff can configure escalation phrases in the dashboard, and changes take effect without a widget redeploy.
- [x] Matching normalizes case, spacing, and punctuation and uses phrase or word boundaries so partial words do not trigger rules.
- [x] When several answer rules apply, the visitor sees relevant choices and receives the selected approved answer.
- [x] An explicit handoff phrase takes priority over all answer rules and creates the same escalation as an unknown question.
- [x] An input with no applicable rule still follows ticket 02's immediate handoff behavior.
- [x] Automated API flows cover overlapping answers, a selected choice, handoff priority, and boundary cases.

## Comments

Implemented 2026-10-23 (ticket 06). API flows in `tests/ambiguity-handoff.test.ts`; several matching rules now produce a bot message carrying persisted topic choices (`messages.choices`, migration 0006) that the widget renders as buttons; a selection posts `{choice: ruleId}` and answers from that exact published rule. Handoff phrases live in the `settings` table behind `PUT /api/staff/settings/escalation-phrases` (owner+editor, CSRF-guarded), are read per question (no redeploy), and are matched as whole normalized phrases before answer rules, producing ticket 02's identical escalation. Editor UI: "Handoff phrases" form on `/dashboard/answers`. Verified in a browser against a production build: choices render and answer; a seeded phrase escalates despite a rule match; a phrase saved in the dashboard escalates the next question on the same running build.

Judgment calls:

- A topic selection is `{choice: ruleId}` only — no visitor-authored text rides along, and the transcript records the picked topic. The server answers from the chosen published rule without re-running the matcher, so wording overlap can never re-ambiguate the visitor's own choice. Any published rule id is a valid choice: rule ids and topics are already public via `/api/v1/topics`, so this adds no data exposure.
- Choice buttons are interactive only on the latest message; older offers remain visible as text in the transcript.
- Phrases are seeded insert-if-absent with "talk to a person" / "speak to a human"; an empty list is valid (feature off; unknown questions still escalate).
- Identically-normalizing duplicate phrases ("Talk to a person" / "talk to a person!") are accepted as-is — harmless to matching, editor-unfriendly; dedupe can ride along with ticket 08's settings work if wanted.

**2026-10-23 — accepted as complete.** The human pass accepted the implementation, its browser checks, and the recorded judgment calls as they stand. Status set to `resolved`.
