import { openDatabase } from "./sqlite";
import { sqliteAppDatabase, postgresAppDatabase, type AppDatabase } from "./appDatabase";
import { createSqliteStore } from "../store/sqliteStore";
import { createPostgresStore } from "../store/postgresStore";
import { seedAnswerRules } from "../store/seed";
import { seedEscalationPhrases, seedHandoffOptions } from "../settings";
import { migratePostgres, openPostgres, type PostgresSql } from "./postgres";
import { createAuth, type Auth } from "../auth/server";
import { createMailTransportFromEnv } from "../mail/transport";
import type { MailTransport } from "../mail/outbox";
import { appBaseUrl, appDatabaseUrl, appDbPath, assertConfiguredDatabaseUrl } from "../config";
import type { Store } from "../domain/types";
import type { DatabaseSync } from "node:sqlite";
import { NodeSqliteDialect } from "@better-auth/kysely-adapter/node-sqlite-dialect";
import { Pool } from "pg";
import { PostgresDialect } from "kysely";

export interface ChatbotService {
  store: Store;
  /** The portable query surface for settings, notifications, and staff admin. */
  db: AppDatabase;
  auth: Auth;
  mail: MailTransport;
}

let servicePromise: Promise<ChatbotService> | null = null;

/**
 * The database backend: SQLite (development default, CHATBOT_DB) or Postgres
 * (production; Supabase via DATABASE_URL). Everything above the Store and
 * the portable query surface is identical on both.
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
  const mail = createMailTransportFromEnv(appDb);
  const auth = createAuth({
    db: appDb,
    dialect: new NodeSqliteDialect({ database: db }),
    kyselyType: "sqlite",
    mail,
    baseUrl: appBaseUrl(),
  });
  return { store, db: appDb, auth, mail };
}

async function buildPostgresService(sql: PostgresSql): Promise<ChatbotService> {
  await migratePostgres(sql);
  const appDb = postgresAppDatabase(sql);
  const store = createPostgresStore(sql);
  await seedAnswerRules(store);
  await seedEscalationPhrases(appDb);
  await seedHandoffOptions(appDb);
  const mail = createMailTransportFromEnv(appDb);
  const auth = createAuth({
    db: appDb,
    // Kysely speaks to Postgres through node-postgres with its own small
    // pool (serverless functions hold few concurrent auth flows); the main
    // query pool is the postgres.js one above.
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: activeDatabaseUrl() ?? undefined,
        max: Number(process.env.PG_AUTH_POOL_MAX ?? 2),
      }),
    }),
    kyselyType: "postgres",
    mail,
    baseUrl: appBaseUrl(),
  });
  return { store, db: appDb, auth, mail };
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
      // Production has no usable SQLite fallback (ticket 22): refuse the
      // store selection before opening anything.
      assertConfiguredDatabaseUrl();
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
