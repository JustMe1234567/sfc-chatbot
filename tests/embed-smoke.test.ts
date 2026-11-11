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
    // The loader runs inside the WordPress page: no API calls, no credential
    // handling, no page storage access may live there.
    expect(script).not.toContain("localStorage");
    expect(script).not.toContain("sessionStorage");
    expect(script).not.toContain("api/v1");
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

    expect(script).toContain("width:56px;height:56px");
    expect(script).toContain("background:#fff");
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
    const presence = await readFile(path.join(repoRoot(), "src/widget/presence.ts"), "utf8");
    expect(frame).toMatch(/localStorage/);
    expect(frame).toMatch(/startPresenceHeartbeat/);
    expect(frame).not.toMatch(/localStorage\.(get|set)/);
    expect(presence).toContain('getItem(BROWSER_ID_STORAGE_KEY)');
    expect(presence).not.toMatch(/sessionStorage|token|credential/i);
    // Keyboard and screen-reader hooks the browser check exercises live.
    expect(frame).toContain('role="log"');
    expect(frame).toContain("aria-live");
    expect(frame).toContain("Escape");
    expect(frame).toContain("Your question");
  });

  it("locks visitor input while staff help is requested (ticket 43)", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    // The composer locks while staff help is requested but unclaimed, with
    // an inline explanation; claiming re-enables it through the normal
    // state application, and the API rejects anything posted directly.
    expect(frame).toContain("Waiting for a staff member to take over…");
    expect(frame).toContain("composerLocked");
    expect(frame).toContain('code === "awaiting_staff"');
    // The lock's start and the takeover are each announced once — via the
    // handoff and claimed notices' own live regions (ticket 25 moved the
    // lock's announcer from this line to the notice).
    expect(frame).toContain('role="status"');
  });

  it("announces the takeover and the claim, each exactly once (ticket 25)", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    // The handoff notice is the awaiting event's ONE announcer (ticket 25):
    // the takeover is the service's core escalation event, and it must
    // reach screen readers through this paragraph.
    const handoffSlice = frame.slice(
      frame.indexOf("{handoff ? ("),
      frame.indexOf("Automated answers are paused."),
    );
    expect(handoffSlice).toContain('role="status"');
    expect(handoffSlice).toContain("College staff will reply in this chat.");
    // The claim announces through its own notice (ticket 43's region).
    const claimedSlice = frame.slice(
      frame.indexOf("{claimed ? ("),
      frame.indexOf("A college staff member has joined"),
    );
    expect(claimedSlice).toContain('role="status"');
    // One announcer per event: the waiting line renders alongside the
    // handoff notice, so it must stay visual — two polite regions firing
    // together would read the same event twice.
    const waitingSlice = frame.slice(
      frame.indexOf("{composerLocked ? ("),
      frame.indexOf("Waiting for a staff member to take over…"),
    );
    expect(waitingSlice).not.toContain('role="status"');
    expect(frame).toContain("Waiting for a staff member to take over…");
    // The topicless guidance line carries no live role, so the takeover
    // announcement is never doubled by an intro swap (ticket 38 removed the
    // takeover variant; this keeps the region count at one per event).
    const introStart = frame.indexOf("className={styles.intro}");
    const introSlice = frame.slice(introStart, frame.indexOf("</p>", introStart));
    expect(introSlice).not.toMatch(/role=|aria-live/);
    // The error region stays a live region (ticket 38's persistent status
    // line); the email-capture box and its notes are gone with ticket 66.
    const statusStart = frame.indexOf("className={styles.status}");
    const statusSlice = frame.slice(statusStart, frame.indexOf("</p>", statusStart));
    expect(statusSlice).toMatch(/role="status"/);
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
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    // The greeting comes from the published setting, with the domain default
    // as the safe fallback, and renders inside the message log.
    expect(frame).toContain("/api/v1/welcome");
    expect(frame).toContain("DEFAULT_WELCOME_MESSAGE");
    // Presentation-only: the greeting path never opens a conversation —
    // ensureSession stays behind the visitor's first question. The slice
    // covers the fetch helper and the effect that uses it.
    const welcomePath = frame.slice(
      frame.indexOf("The published greeting text, or the default"),
      frame.indexOf("The saved/declined email confirmations leave on their own"),
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
    expect(frame).toContain('event.key !== "Escape"');
    expect(frame).not.toContain("styles.clearRow");
    expect(frameCss).toMatch(/\.menuPanel,\s*\.confirmBox \{[^}]*position: absolute/s);
    expect(frameCss).toContain("prefers-reduced-motion: no-preference");
    expect(browserProof).toContain('getByRole("menuitem", { name: "Clear conversation" })');
    expect(browserProof).toContain("clear did not swap to a fresh successor conversation");
    expect(browserProof).toContain('assertMenuWithinFrame("360px")');
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
