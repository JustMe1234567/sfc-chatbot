# ZCode handoff: college website chatbot

Open this folder in ZCode and use the updated spec at `.scratch/college-website-chat/spec.md` as the source of truth. Codex completed `/to-tickets` with the user's approval and published ten tickets under `.scratch/college-website-chat/issues/`. Ticket 01 was reopened after its initial Express and in-memory implementation because the user requires Next.js and Supabase throughout. Finish ticket 01 on that stack before starting ticket 02 or other dependent tickets.

Read `AGENTS.md`, `GLOSSARY.md`, `docs/agents/issue-tracker.md`, and `docs/agents/triage-labels.md` before implementing. The latest spec makes a site-wide WordPress script the default integration; a custom loader plugin is optional. Do not infer the earlier plugin proposal from the conversation.

Suggested skills in `.zcode/skills/`: `/implement` for each ready ticket, with `/tdd` at the agreed API flow seam and `/code-review` before committing. `/ask-matt` can route a change in direction. Repository setup has already been completed; do not rerun it.

This workspace contains the initial widget, matcher, Express API, and in-memory store from ticket 01; treat those as reusable starting material while replacing the runtime and persistence. A Git repository is initialized on `main` and connected to `https://github.com/JustMe1234567/sfc-chatbot.git`. College IT or site owner approval of external hosting, messaging, and email services is a production launch gate documented in the spec.
