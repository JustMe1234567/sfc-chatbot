import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

describe("WordPress embed smoke check", () => {
  it("loads the versioned loader script exactly once on the test page", async () => {
    const html = await readFile(
      path.join(repoRoot(), "public/demo/wordpress-test-page.html"),
      "utf8",
    );
    const occurrences = html.match(/<script[^>]+\/widget\/v1\.js[^>]*>/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(html).toContain('name="viewport"');
  });

  it("ships a loader that opens a chatbot-origin iframe and never touches page storage", async () => {
    const script = await readFile(path.join(repoRoot(), "public/widget/v1.js"), "utf8");

    expect(script).toContain("sfc-chatbot-widget-v1");
    expect(script).toContain("/widget/frame");
    expect(script).toContain("iframe");
    expect(script).toContain("sfcw:close");
    expect(script).toContain("@media (max-width:480px)");
    expect(script).toContain("aria-expanded");
    // The loader runs inside the WordPress page: no credential handling and
    // no page storage access may live there. (Ticket 76 narrows the old
    // "no API calls at all" property to exactly one credential-free,
    // boolean-only pre-render ask — the eligibility check, pinned in the
    // ticket-76 test below.)
    expect(script).not.toContain("localStorage");
    expect(script).not.toContain("sessionStorage");
    expect(script).not.toContain("document.cookie");
  });

  it("asks the chatbot server before touching the host page (ticket 76)", async () => {
    const script = await readFile(path.join(repoRoot(), "public/widget/v1.js"), "utf8");
    // The eligibility ask is the loader's only API surface in the shipped
    // asset. The full loader contract — no DOM mutation before the check,
    // the generic diagnostic, the credential-free fetch, the base-origin
    // capture — lives with the ticket in tests/embed-allowlist.test.ts;
    // this smoke pin holds only the shipped-artifact fact.
    expect(script).toContain("/api/v1/embed-eligibility");
    expect(script.match(/api\/v1/g)).toHaveLength(1);
    expect(script).not.toContain("springfieldcollege");
  });

  it("keeps the launcher available as an honest open and close toggle (ticket 35)", async () => {
    const script = await readFile(path.join(repoRoot(), "public/widget/v1.js"), "utf8");
    const source = await readFile(path.join(repoRoot(), "src/widget/loader.ts"), "utf8");

    expect(script).toContain('aria-label","Close chat"');
    expect(script).toContain('aria-expanded","true"');
    expect(script).toContain('aria-expanded","false"');
    expect(script).toContain("sfcw-launcher-close");
    expect(script).toContain('.sfcw-launcher[aria-expanded="true"] img{display:none}');
    expect(script).toContain('.sfcw-launcher[data-closing="true"] img{display:none}');
    expect(source).toContain('delete launcher.dataset.closing');
    expect(source).not.toContain("launcher.hidden = true");
  });

  it("ships a square icon-only launcher with an accessible name (ticket 40)", async () => {
    const script = await readFile(path.join(repoRoot(), "public/widget/v1.js"), "utf8");
    const source = await readFile(path.join(repoRoot(), "src/widget/loader.ts"), "utf8");

    // Tickets 70 and 71 supersede the fixed 56px white plate: the chathead
    // is configurable through CSS custom properties whose inline fallbacks
    // are the confirmed defaults (64 × 64 container, background #013C78),
    // with the corner radius at 25% of the smaller dimension.
    expect(script).toContain("width:var(--sfcw-w,64px);height:var(--sfcw-h,64px)");
    expect(script).toContain("background:var(--sfcw-bg,#013c78)");
    expect(script).toContain("border-radius:calc(min(var(--sfcw-w,64px),var(--sfcw-h,64px)) * .25)");
    expect(script).toContain('aria-label","Chat with Springfield College"');
    expect(source).not.toContain('label.textContent = "Chat"');
    expect(source).not.toContain("launcher.appendChild(label)");
    expect(source).toContain(".sfcw-launcher:focus-visible");
    expect(source).toContain(".sfcw-launcher[hidden]{display:none}");
    expect(source).toContain("@media (prefers-reduced-motion:reduce)");
  });

  it("keeps the visitor credential in iframe-origin session storage", async () => {
    // Storage access moved behind src/widget/visitorSession.ts (shared with
    // the /return landing page); the exposure review covers both files.
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const visitorSession = await readFile(
      path.join(repoRoot(), "src/lib/visitorSession.ts"),
      "utf8",
    );
    expect(visitorSession).toContain("sessionStorage");
    expect(visitorSession).not.toContain("localStorage");
    // The frame page's only persistent storage is the analytics browser id
    // (ticket 17): an anonymous random UUID in the widget's own presence
    // module, never the conversation credential, which stays session-scoped.
    // (Ticket 33 moved the heartbeat into the frame's presence hook and the
    // Escape cascade into its clear-flow hook; the pins follow the code.)
    const presenceModule = await readFile(
      path.join(repoRoot(), "src/widget/presence.ts"),
      "utf8",
    );
    const presenceHook = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/hooks/usePresence.ts"),
      "utf8",
    );
    const clearFlow = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/hooks/useClearFlow.ts"),
      "utf8",
    );
    expect(presenceHook).toMatch(/localStorage/);
    expect(presenceHook).toMatch(/startPresenceHeartbeat/);
    expect(presenceHook).not.toMatch(/localStorage\.(get|set)/);
    expect(frame).not.toMatch(/localStorage\.(get|set)/);
    expect(presenceModule).toContain('getItem(BROWSER_ID_STORAGE_KEY)');
    expect(presenceModule).not.toMatch(/sessionStorage|token|credential/i);
    // Keyboard and screen-reader hooks the browser check exercises live.
    expect(frame).toContain('role="log"');
    expect(frame).toContain("aria-live");
    expect(clearFlow).toContain("Escape");
    expect(frame).toContain("Your question");
  });

  it("keeps visitor input open while staff help is requested (ticket 103)", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const stream = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/hooks/useConversationStream.ts"),
      "utf8",
    );
    // Ticket 43's lock is gone (ticket 103): the composer, chips, and API
    // stay open while an advisor joins. The widget carries no lock state,
    // no waiting line, and no awaiting_staff 409 handler.
    expect(frame).not.toContain("composerLocked");
    expect(frame).not.toContain("Waiting for a staff member to take over");
    expect(stream).not.toContain('code === "awaiting_staff"');
    // The stream still applies the awaiting state — the notice and the open
    // composer render from it.
    expect(stream).toContain('state === "awaiting_staff"');
  });

  it("announces the handoff states exactly once, from inside the transcript (tickets 25 and 103)", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    // Both notices are transcript lines now (ticket 103): the log's single
    // live region announces each state event exactly once, so the notices
    // carry no live semantics of their own — no role, no nested region.
    const awaitingSlice = frame.slice(
      frame.indexOf("{handoff ? ("),
      frame.indexOf("{claimed ? ("),
    );
    expect(awaitingSlice).not.toMatch(/role=|aria-live/);
    expect(awaitingSlice).toContain("styles.notice");
    expect(awaitingSlice).toContain("waitingNotice");
    const claimedSlice = frame.slice(
      frame.indexOf("{claimed ? ("),
      frame.indexOf("{freshStart ? ("),
    );
    expect(claimedSlice).not.toMatch(/role=|aria-live/);
    expect(claimedSlice).toContain("styles.notice");
    // The joined notice keeps today's exact sentence (ticket 103 decision
    // 2, the owner-confirmed exception to ticket 102's wording sweep).
    expect(frame).toContain(
      "A college staff member has joined the conversation and will reply here.",
    );
    // The topicless guidance line carries no live role, so the takeover
    // announcement is never doubled by an intro swap (ticket 38 removed the
    // takeover variant; this keeps the region count at one per event).
    const introStart = frame.indexOf("className={styles.intro}");
    const introSlice = frame.slice(introStart, frame.indexOf("</p>", introStart));
    expect(introSlice).not.toMatch(/role=|aria-live/);
    // The error region stays a live region (ticket 38's persistent status
    // line), assertive since ticket 29 — a failed send is actionable now.
    // The email-capture box and its notes are gone with ticket 66.
    const statusStart = frame.indexOf("className={styles.status}");
    const statusSlice = frame.slice(statusStart, frame.indexOf("</p>", statusStart));
    expect(statusSlice).toMatch(/role="alert"/);
    expect(frame).not.toContain("emailNote");
  });

  it("shows an active verb on the visitor's send while it runs (ticket 42)", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const frameCss = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/frame.module.css"),
      "utf8",
    );
    // Conversation-first (ticket 42): the composer's button swaps to
    // "Sending…" and announces busy while the request settles.
    expect(frame).toContain("Sending…");
    expect(frame).toContain("aria-busy");
    // The widget iframe is self-contained (ticket 16): its pending spinner
    // CSS is a required local copy of the dashboard's shared pattern.
    expect(frameCss).toContain(".pendingSpinner");
    expect(frameCss).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.pendingSpinner \{[^}]*animation/s,
    );
  });

  it("greets a fresh chat without creating a conversation (ticket 41)", async () => {
    const content = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/hooks/usePublishedContent.ts"),
      "utf8",
    );
    // The greeting comes from the published setting, with the domain default
    // as the safe fallback, and renders inside the message log. (Ticket 33
    // moved the fetch into the frame's published-content hook; the pin
    // follows the code.)
    expect(content).toContain("/api/v1/welcome");
    expect(content).toContain("DEFAULT_WELCOME_MESSAGE");
    // Presentation-only: the greeting path never opens a conversation —
    // ensureSession stays behind the visitor's first question. The slice
    // covers the fetch helper.
    const welcomePath = content.slice(
      content.indexOf("The published greeting text, or the default"),
      content.indexOf("The configured chatbot icon (ticket 70)"),
    );
    expect(welcomePath).not.toContain("ensureSession");
    expect(welcomePath).toContain("/api/v1/welcome");
  });

  it("composes the fresh state like the supplied reference (ticket 46)", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const frameCss = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/frame.module.css"),
      "utf8",
    );
    // The fresh chat leads with the substantial branded header: the crest on
    // its white plate and the college name centered, with the existing close
    // control and (once a conversation exists) the ticket-39 menu keeping
    // their behavior and accessible names.
    expect(frame).toContain("headerFresh");
    expect(frame).toContain("brandPlate");
    expect(frame).toContain("Springfield College");
    expect(frame).toContain('aria-label="Close chat"');
    expect(frame).toContain('aria-label="Conversation options"');
    // The greeting renders as a real chat bubble with a decorative crest
    // avatar and a subtle local timestamp, presentation-only as in 41.
    expect(frame).toContain("botAvatar");
    expect(frame).toMatch(/<time[^>]*aria-hidden="true"/);
    // Suggested questions stack as right-aligned outlined actions on the
    // fresh state only; the compact two-row strip remains for conversations.
    expect(frame).toContain("freshStart");
    expect(frame).toContain("startArea");
    expect(frame).toContain("freshSuggestions");
    expect(frame).toContain("<TopicsStrip");
    expect(frameCss).toContain(".logFresh");
    expect(frameCss).toMatch(/\.freshSuggestions \{[^}]*align-items: flex-end/s);
    // Labels wrap instead of truncating or scrolling the page.
    expect(frameCss).toMatch(/\.freshSuggest \{[^}]*max-width: 85%/s);
  });

  it("ships the suggested-questions strip contract (ticket 18)", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const frameCss = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/frame.module.css"),
      "utf8",
    );
    // Individual chips use one or two text lines in a left-to-right flow that
    // overflows horizontally, with keyboard focus moving chips into view,
    // fades as the overflow cue, and motion gated by visitor preference.
    expect(frame).toContain('aria-label="Suggested questions"');
    expect(frame).toContain("scrollIntoView");
    expect(frameCss).toContain("display: flex");
    expect(frameCss).toContain("flex-wrap: nowrap");
    expect(frameCss).toContain("align-items: flex-start");
    expect(frameCss).not.toContain("grid-auto-flow: column");
    expect(frameCss).toContain("prefers-reduced-motion: no-preference");
    expect(frameCss).toContain("-webkit-line-clamp: 2");
  });

  it("keeps the handoff state compact and the transcript dominant (ticket 38)", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const frameCss = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/frame.module.css"),
      "utf8",
    );
    // The chips are the affordance once they exist (and the handoff notice
    // carries the takeover state), so both intro variants are gone; only the
    // topicless fallback remains.
    expect(frame).toContain("Ask us your question.");
    expect(frame).not.toContain("Pick a topic");
    // The saved/declined email confirmations are gone (ticket 66): email is
    // captured with the required contact details before the chat starts,
    // and return-link emails are no longer sent.
    expect(frame).not.toContain("EMAIL_NOTE_TTL_MS");
    expect(frame).not.toContain("Email me a link later");
    expect(frame).not.toContain("No thanks");
    expect(frame).not.toContain("/email");
    expect(frameCss).not.toContain("sfcw-depart");
    // The message log keeps its flex growth: it is the widget's primary
    // surface and absorbs the space the compacted handoff chrome frees.
    // Pinned on the .log block itself — other rules flex too.
    expect(frameCss).toMatch(/\.log \{[^}]*flex: 1/s);
    // The error live region stays mounted for announcements but reserves no
    // height while empty.
    expect(frameCss).toMatch(/\.status \{[^}]*min-height: 0/s);
  });

  it("moves Clear conversation into an accessible header menu (ticket 39)", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const frameCss = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/frame.module.css"),
      "utf8",
    );
    const browserProof = await readFile(
      path.join(repoRoot(), "scripts/topics-shots.mjs"),
      "utf8",
    );

    expect(frame).toContain('aria-label="Conversation options"');
    expect(frame).toContain('aria-haspopup="menu"');
    expect(frame).toContain('role="menu"');
    expect(frame).toContain('role="menuitem"');
    expect(frame).toContain('event.key === "ArrowDown"');
    // The Escape cascade lives in the frame's clear-flow hook (ticket 33).
    const clearFlowSource = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/hooks/useClearFlow.ts"),
      "utf8",
    );
    expect(clearFlowSource).toContain('event.key !== "Escape"');
    expect(frame).not.toContain("styles.clearRow");
    expect(frameCss).toMatch(/\.menuPanel,\s*\.confirmBox \{[^}]*position: absolute/s);
    expect(frameCss).toContain("prefers-reduced-motion: no-preference");
    expect(browserProof).toContain('getByRole("menuitem", { name: "Clear conversation" })');
    expect(browserProof).toContain("clear did not swap to a fresh successor conversation");
    expect(browserProof).toContain('assertMenuWithinFrame("360px")');
  });

  it("holds widget touch targets at the 24px minimum (ticket 27)", async () => {
    const frameCss = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/frame.module.css"),
      "utf8",
    );
    const browserProof = await readFile(
      path.join(repoRoot(), "scripts/cert27-touch-targets.mjs"),
      "utf8",
    );

    // The confirm pair is the metric-dependent floor (12px fonts, ~2-4px of
    // headroom); everything else reaches 24px by fixed box or padding, and
    // the cert script measures every control live across all widget states.
    expect(frameCss).toMatch(/\.confirmClear \{[^}]*min-height: 24px/s);
    expect(frameCss).toMatch(/\.confirmKeep \{[^}]*min-height: 24px/s);
    expect(browserProof).toContain("24×24px minimum");
    expect(browserProof).toContain("inline flow");
    expect(browserProof).toContain("ticket 18 constraint");
  });

  it("keeps service secrets out of the loader bundle", async () => {
    const script = await readFile(path.join(repoRoot(), "public/widget/v1.js"), "utf8");
    expect(script).not.toMatch(/process\.env/);
    expect(script).not.toMatch(/(?:api[_-]?key|secret|password|supabase)/i);
  });

  it("uses the site-wide enqueue mechanism once in the WordPress plugin", async () => {
    const plugin = await readFile(path.join(repoRoot(), "wordpress/sfc-chatbot.php"), "utf8");
    const enqueues = plugin.match(/wp_enqueue_script\(/g) ?? [];
    expect(enqueues).toHaveLength(1);
    expect(plugin).toContain("sfc_chatbot_widget_url");
    expect(plugin).toContain("/widget/v1.js");
  });
});
