import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app";
import { createMemoryStore } from "../src/store/memoryStore";
import { seedAnswerRules } from "../src/store/seed";

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Boots the real HTTP application on an ephemeral port with a controlled
 * in-memory store and the seeded answer rules, ready for API flow tests.
 */
export async function startTestServer(): Promise<TestServer> {
  const store = createMemoryStore();
  await seedAnswerRules(store);
  const app = createApp({ store });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

export interface ConversationStart {
  id: string;
  token: string;
}

export async function startConversation(baseUrl: string): Promise<ConversationStart> {
  const response = await fetch(`${baseUrl}/api/v1/conversations`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`conversation start failed: ${response.status}`);
  }
  const body = (await response.json()) as { id: string; token: string };
  return { id: body.id, token: body.token };
}

export async function ask(
  baseUrl: string,
  conversation: ConversationStart,
  text: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/conversations/${conversation.id}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${conversation.token}`,
    },
    body: JSON.stringify({ text }),
  });
}

export async function loadHistory(
  baseUrl: string,
  conversation: ConversationStart,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/conversations/${conversation.id}/messages`, {
    headers: { Authorization: `Bearer ${conversation.token}` },
  });
}
