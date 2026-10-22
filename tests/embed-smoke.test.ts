import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";
import { startTestServer, type TestServer } from "./helpers";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

describe("WordPress embed smoke check", () => {
  it("loads the versioned widget script exactly once on the test page", async () => {
    const response = await fetch(`${server.baseUrl}/demo/wordpress-test-page.html`);
    expect(response.status).toBe(200);

    const html = await response.text();
    const occurrences = html.match(/<script[^>]+\/widget\/v1\.js[^>]*>/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(html).toContain('name="viewport"');
  });

  it("serves the widget script as JavaScript with its boot marker", async () => {
    const response = await fetch(`${server.baseUrl}/widget/v1.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");

    const script = await response.text();
    expect(script).toContain("sfc-chatbot-widget-v1");
  });

  it("ships the widget with mobile and keyboard accessibility hooks", async () => {
    // Presence checks for the accessibility and responsive-design contract;
    // interactive behavior is exercised by the browser-check slice.
    const script = await (await fetch(`${server.baseUrl}/widget/v1.js`)).text();

    expect(script).toContain("@media (max-width:480px)");
    expect(script).toContain('aria-live');
    expect(script).toContain("Escape");
    expect(script).toContain("aria-expanded");
    expect(script).toContain("Your question");
  });

  it("keeps service secrets out of the served page and widget script", async () => {
    const page = await (await fetch(`${server.baseUrl}/demo/wordpress-test-page.html`)).text();
    const script = await (await fetch(`${server.baseUrl}/widget/v1.js`)).text();
    const combined = page + script;

    expect(combined).not.toMatch(/process\.env/);
    expect(combined).not.toMatch(/(?:api[_-]?key|secret|password|supabase)/i);
  });

  it("uses the site-wide enqueue mechanism once in the WordPress plugin", async () => {
    const plugin = await readFile(
      path.join(repoRoot(), "wordpress/sfc-chatbot.php"),
      "utf8",
    );
    const enqueues = plugin.match(/wp_enqueue_script\(/g) ?? [];
    expect(enqueues).toHaveLength(1);
    expect(plugin).toContain("sfc_chatbot_widget_url");
    expect(plugin).toContain("/widget/v1.js");
  });
});
