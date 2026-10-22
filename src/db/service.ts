import { openDatabase } from "./sqlite";
import { createSqliteStore } from "../store/sqliteStore";
import { seedAnswerRules } from "../store/seed";
import { createAuth, type Auth } from "../auth/server";
import { createOutboxTransport } from "../mail/outbox";
import { appBaseUrl, appDbPath } from "../config";
import type { Store } from "../domain/types";
import type { DatabaseSync } from "node:sqlite";

export interface ChatbotService {
  store: Store;
  db: DatabaseSync;
  auth: Auth;
}

let servicePromise: Promise<ChatbotService> | null = null;

/**
 * The running app's single service instance: SQLite at CHATBOT_DB (default
 * chatbot.db in the repo root), schema migrated and seed content ensured
 * before any request is served, plus staff authentication over the same
 * database. Route handlers await this on every request so tests can point a
 * fresh module registry at a controlled database via the environment.
 */
export function getChatbotService(): Promise<ChatbotService> {
  if (!servicePromise) {
    servicePromise = (async () => {
      const db = openDatabase(appDbPath());
      const store = createSqliteStore(db);
      await seedAnswerRules(store);
      const auth = createAuth({ db, mail: createOutboxTransport(db), baseUrl: appBaseUrl() });
      return { store, db, auth };
    })();
  }
  return servicePromise;
}
