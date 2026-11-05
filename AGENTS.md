## Agent skills

### Issue tracker

Issues and specs live as Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage roles as `Status:` values in local issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout with `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Working style

- **Build exactly what the ticket asks — nothing more.** Don't fix unrelated code, refactor untouched modules, upgrade dependencies, or "improve" anything nobody asked for, even if it looks wrong. File a ticket for it instead.
- **No overengineering.** No speculative abstractions, options, or configurability that no ticket requires. Reuse existing components, patterns, and utilities; the smallest correct change wins.
- **The ticket's acceptance criteria are the scope.** If something outside that scope seems necessary to complete the work, stop and ask the user rather than silently expanding the change.
- **Never change behavior the user didn't ask about** — API contracts, schemas, matching logic, and working UI stay untouched unless the ticket says otherwise.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
