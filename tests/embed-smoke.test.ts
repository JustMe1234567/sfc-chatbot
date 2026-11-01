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
    expect(frame).toContain("Pick a topic to send to staff");
    expect(frameCss).toContain("display: flex");
    expect(frameCss).toContain("flex-wrap: nowrap");
    expect(frameCss).toContain("align-items: flex-start");
    expect(frameCss).not.toContain("grid-auto-flow: column");
    expect(frameCss).toContain("prefers-reduced-motion: no-preference");
    expect(frameCss).toContain("-webkit-line-clamp: 2");
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
