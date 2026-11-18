import { openDatabase } from "./sqlite";
import { sqliteAppDatabase, postgresAppDatabase, type AppDatabase } from "./appDatabase";
import { createSqliteStore } from "../store/sqliteStore";
import { createPostgresStore } from "../store/postgresStore";
import { seedAnswerRules } from "../store/seed";
import { seedEmbedAllowlist, seedEscalationPhrases, seedHandoffOptions } from "../settings";
import { migratePostgres, openPostgres, type PostgresSql } from "./postgres";
import type { AuthProvider } from "../auth/provider";
import { assertSupabaseConfigured, createSupabaseAuth } from "../auth/supabase-provider";
import { appBaseUrl, appDatabaseUrl, appDbPath, assertConfiguredDatabaseUrl } from "../config";
import type { Store } from "../domain/types";
import type { DatabaseSync } from "node:sqlite";

export interface ChatbotService {
  store: Store;
  /** The portable query surface for settings and staff administration. */
  db: AppDatabase;
  auth: AuthProvider;
}

let servicePromise: Promise<ChatbotService> | null = null;

/**
 * Hosted runs use Supabase Postgres. SQLite remains behind the same service
 * boundary for isolated tests, where Vitest installs the fake auth provider.
 */
function activeDatabaseUrl(): string | null {
  return appDatabaseUrl();
}

async function buildSqliteService(): Promise<ChatbotService> {
  const db: DatabaseSync = openDatabase(appDbPath());
  const appDb = sqliteAppDatabase(db);
  const store = createSqliteStore(db);
  await seedAnswerRules(store);
  await seedEscalationPhrases(appDb);
  await seedHandoffOptions(appDb);
  await seedEmbedAllowlist(appDb);
  const auth = createSupabaseAuth({
    db: appDb,
    baseUrl: appBaseUrl(),
  });
  return { store, db: appDb, auth };
}

async function buildPostgresService(sql: PostgresSql): Promise<ChatbotService> {
  await migratePostgres(sql);
  const appDb = postgresAppDatabase(sql);
  const store = createPostgresStore(sql);
  await seedAnswerRules(store);
  await seedEscalationPhrases(appDb);
  await seedHandoffOptions(appDb);
  await seedEmbedAllowlist(appDb);
  const auth = createSupabaseAuth({
    db: appDb,
    baseUrl: appBaseUrl(),
  });
  return { store, db: appDb, auth };
}

/**
 * The running app's single service instance: migrations and seed content
 * ensured before any request is served, plus staff authentication over the
 * same database. Route handlers await this on every request so tests can
 * point a fresh module registry at a controlled database via the
 * environment — CHATBOT_DB for SQLite, DATABASE_URL for Postgres.
 */
export function getChatbotService(): Promise<ChatbotService> {
  if (!servicePromise) {
    servicePromise = (async () => {
      // Hosted runs require Postgres and a matching Supabase Auth project.
      // The test setup replaces the auth assertion/provider so controlled
      // SQLite route tests can continue exercising application behavior.
      assertConfiguredDatabaseUrl();
      assertSupabaseConfigured();
      const url = activeDatabaseUrl();
      if (url) {
        const sql = openPostgres(url);
        return buildPostgresService(sql);
      }
      return buildSqliteService();
    })();
  }
  return servicePromise;
}

/** Re-exported for consumers that need the concrete AppDatabase type. */
export type { AppDatabase };
