# ZCode handoff: college website chatbot

Open this folder in ZCode and use the approved spec at `.scratch/college-website-chat/spec.md` as the source of truth. Codex completed `/to-tickets` with the user's approval and published ten tickets under `.scratch/college-website-chat/issues/`. Start with any ready ticket whose listed blockers are complete; ticket 01 is ready first.

Read `AGENTS.md`, `GLOSSARY.md`, `docs/agents/issue-tracker.md`, and `docs/agents/triage-labels.md` before making tickets. The latest spec makes a site-wide WordPress script the default integration; a custom loader plugin is optional. Do not infer the earlier plugin proposal from the conversation.

Suggested skills in `.zcode/skills/`: `/implement` for each ready ticket, with `/tdd` at the agreed API flow seam and `/code-review` before committing. `/ask-matt` can route a change in direction. Repository setup has already been completed; do not rerun it.

This workspace currently contains planning documents and no app implementation. A Git repository has been initialized on `main` and connected to `https://github.com/JustMe1234567/sfc-chatbot.git`; confirm the initial planning commits are present before implementation. College IT or site owner approval of external hosting, messaging, and email services is a production launch gate documented in the spec.
