# 93: Delta-based code-review reruns, anchored on a recorded last-reviewed SHA

Status: needs-triage

## What to build

Every `/code-review <fixed-point>` rerun re-scans the entire range even
when only one or two commits are new, because neither the review skill
nor the ticket records carry a "reviewed through" marker. Add a
convention that records the last-reviewed SHA in the ticket record — for
example a `Reviewed through: <sha>` line in each review or amendment
comment — and scope rerun sub-agents to the delta since that SHA, while
still cheaply re-verifying that recorded dispositions hold.

Decision needed (why needs-triage): where the convention lives — the
user-level review skill (`.zcode/skills/code-review/SKILL.md`, shared
across repos), a repo `docs/agents/` pointer, or simply the
ticket-record habit; and whether reruns are scoped by the skill itself
or by whoever invokes it.

## Acceptance criteria (sketch — finalize at triage)

- A rerun can find the last-reviewed SHA from the ticket record alone.
- A rerun's review covers the delta since that SHA with the same
  fresh-commit scrutiny today's runs give, plus a cheap re-verification
  of recorded dispositions.

## Comments

2026-11-20: Filed from the session retro. Evidence: three reruns of
9ea8fcacc on 2026-11-20 each re-read a 343-file diff to review a
one-to-two-commit delta; each rerun cost roughly 300–500k subagent
tokens and reproduced identical findings.
