import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repoRoot } from "../src/paths";

const execFileAsync = promisify(execFile);

const NEXT_BIN = path.join(repoRoot(), "node_modules", "next", "dist", "bin", "next");
const DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "sfc-chatbot-restart-")), "restart.db");

const children: ChildProcess[] = [];

async function startServer(port: number): Promise<string> {
  const child = spawn(process.execPath, [NEXT_BIN, "dev", "--port", String(port)], {
    cwd: repoRoot(),
    env: { ...process.env, CHATBOT_DB: DB_PATH },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) {
        return baseUrl;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`next dev on port ${port} did not become ready`);
}

async function stopServers(): Promise<void> {
  while (children.length > 0) {
    const child = children.pop();
    if (!child || child.exitCode !== null || child.pid === undefined) {
      continue;
    }
    if (process.platform === "win32") {
      // next dev spawns worker processes; only a process-tree kill reclaims
      // the port on Windows.
      await execFileAsync("taskkill", ["/pid", String(child.pid), "/T", "/F"]).catch(() => {});
    } else {
      child.kill("SIGTERM");
    }
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 5000);
    });
  }
}

// A SQLite-specific proof (ticket 01): the visitor's conversation survives a
// Next.js process restart because the store is a file. On Postgres (ticket
// 11) persistence across processes is the platform's own property — the
// database outlives every function — so this suite runs on SQLite only.
const describeSqliteOnly = process.env.CHATBOT_TEST_POSTGRES_URL
  ? describe.skip
  : describe;

describeSqliteOnly("visitor journey across a Next.js process restart", () => {
  let firstRunBaseUrl: string;
  let conversation: { id: string; token: string };

  beforeAll(async () => {
    firstRunBaseUrl = await startServer(4321);
  }, 180_000);

  afterAll(stopServers);

  it("serves the WordPress demo page, loader, and chat frame", async () => {
    const page = await fetch(`${firstRunBaseUrl}/demo/wordpress-test-page.html`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect((html.match(/<script[^>]+\/widget\/v1\.js[^>]*>/g) ?? []).length).toBe(1);

    const loader = await fetch(`${firstRunBaseUrl}/widget/v1.js`);
    expect(loader.status).toBe(200);
    expect(loader.headers.get("content-type")).toContain("javascript");
    expect(await loader.text()).toContain("sfc-chatbot-widget-v1");

    const frame = await fetch(`${firstRunBaseUrl}/widget/frame`);
    expect(frame.status).toBe(200);
  }, 60_000);

  it("asks a seeded question and receives the approved answer", async () => {
    const start = await fetch(`${firstRunBaseUrl}/api/v1/conversations`, { method: "POST" });
    expect(start.status).toBe(201);
    conversation = (await start.json()) as { id: string; token: string };

    const response = await fetch(
      `${firstRunBaseUrl}/api/v1/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${conversation.token}`,
        },
        body: JSON.stringify({ text: "What are the admission requirements?" }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reply: { text: string } };
    expect(body.reply.text).toContain("admissions portal");
  }, 30_000);

  it("keeps the conversation readable after the Next.js process restarts", async () => {
    await stopServers();
    const secondRunBaseUrl = await startServer(4322);

    const history = await fetch(
      `${secondRunBaseUrl}/api/v1/conversations/${conversation.id}/messages`,
      { headers: { Authorization: `Bearer ${conversation.token}` } },
    );
    expect(history.status).toBe(200);
    const body = (await history.json()) as { messages: { role: string; text: string }[] };
    expect(body.messages.map((message) => [message.role, message.text])).toEqual([
      ["visitor", "What are the admission requirements?"],
      [
        "bot",
        "You can apply online through our admissions portal. Undergraduate applications ask for your high school transcript and one reference letter. See the admissions page for the full checklist.",
      ],
    ]);
  }, 180_000);
});
