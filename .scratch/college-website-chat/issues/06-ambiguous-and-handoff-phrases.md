# 06: Resolve ambiguous matches and handoff phrases

**What to build:** Typed questions route predictably when wording overlaps. The visitor chooses among several matching topics, while a configured handoff phrase goes to staff immediately even if an answer rule also matches.

**Blocked by:** 05: Publish answer rules and topic buttons.

**Status:** ready-for-agent

- [ ] Staff can configure escalation phrases in the dashboard, and changes take effect without a widget redeploy.
- [ ] Matching normalizes case, spacing, and punctuation and uses phrase or word boundaries so partial words do not trigger rules.
- [ ] When several answer rules apply, the visitor sees relevant choices and receives the selected approved answer.
- [ ] An explicit handoff phrase takes priority over all answer rules and creates the same escalation as an unknown question.
- [ ] An input with no applicable rule still follows ticket 02's immediate handoff behavior.
- [ ] Automated API flows cover overlapping answers, a selected choice, handoff priority, and boundary cases.
