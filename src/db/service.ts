import path from "node:path";
import { openDatabase } from "./sqlite";
import { createSqliteStore } from "../store/sqliteStore";
import { seedAnswerRules } from "../store/seed";
import { repoRoot } from "../paths";
import type { Store } from "../domain/types";

export interface ChatbotService {
  store: Store;
}

let servicePromise: Promise<ChatbotService> | null = null;

/**
 * The running app's single service instance: SQLite at CHATBOT_DB (default
 * chatbot.db in the repo root), schema migrated and seed content ensured
 * before any request is served. Route handlers await this on every request so
 * tests can point a fresh module registry at a controlled database via the
 * environment.
 */
export function getChatbotService(): Promise<ChatbotService> {
  if (!servicePromise) {
    const dbPath = process.env.CHATBOT_DB ?? path.join(repoRoot(), "chatbot.db");
    servicePromise = (async () => {
      const store = createSqliteStore(openDatabase(dbPath));
      await seedAnswerRules(store);
      return { store };
    })();
  }
  return servicePromise;
}
