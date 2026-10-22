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

  it("keeps the visitor credential in iframe-origin session storage", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    expect(frame).toContain("sessionStorage");
    expect(frame).not.toContain("localStorage");
    // Keyboard and screen-reader hooks the browser check exercises live.
    expect(frame).toContain('role="log"');
    expect(frame).toContain("aria-live");
    expect(frame).toContain("Escape");
    expect(frame).toContain("Your question");
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
