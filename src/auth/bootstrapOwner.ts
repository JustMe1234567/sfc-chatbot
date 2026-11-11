import { PostgresDialect } from "kysely";
import { Pool } from "pg";
import { NodeSqliteDialect } from "@better-auth/kysely-adapter/node-sqlite-dialect";
import { sqliteAppDatabase, postgresAppDatabase } from "../db/appDatabase";
import { openDatabase } from "../db/sqlite";
import { migratePostgres, openPostgres } from "../db/postgres";
import { createAuth } from "./server";
import { provisionStaffMember, type ProvisionedStaff } from "./provision";
import { createOutboxTransport } from "../mail/outbox";
import { appBaseUrl, appDbPath } from "../config";

export interface BootstrapOwnerInput {
  email: string;
  name: string;
  password: string;
  /**
   * A Postgres connection string selects the production store; null or
   * undefined keeps the SQLite development store. The caller resolves this
   * from the environment with the app's own `appDatabaseUrl`, so the
   * bootstrap can never target a store other than the one the running app
   * would use (ticket 19).
   */
  databaseUrl?: string | null;
  /** Overrides the SQLite store's path; defaults to the app's own path. */
  dbPath?: string;
}

export interface BootstrapOwnerResult extends ProvisionedStaff {
  /** Human-readable name of the store that was written, credentials-free. */
  store: string;
}

function ownerInput(input: BootstrapOwnerInput) {
  return { email: input.email, name: input.name, password: input.password, role: "owner" as const };
}

async function bootstrapOnPostgres(
  input: BootstrapOwnerInput,
  url: string,
): Promise<BootstrapOwnerResult> {
  const sql = openPostgres(url);
  try {
    // Fresh production databases get their schema here: the same tracked
    // migrations the app applies on first start, so bootstrap works both
    // before and after the app has ever booted — matching how openDatabase
    // migrates on the SQLite side.
    await migratePostgres(sql);
    const appDb = postgresAppDatabase(sql);
    const mail = createOutboxTransport(appDb);
    // The auth adapter runs on its own small pg pool, exactly like the
    // server's Postgres service does (serverless functions hold few
    // concurrent auth flows).
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_AUTH_POOL_MAX ?? 2),
    });
    try {
      const auth = createAuth({
        db: appDb,
        dialect: new PostgresDialect({ pool }),
        kyselyType: "postgres",
        mail,
        baseUrl: appBaseUrl(),
      });
      const owner = await provisionStaffMember(auth, appDb, ownerInput(input));
      // The store is named, the credentials are not.
      return { ...owner, store: `Postgres database at ${safePostgresTarget(url)}` };
    } finally {
      await pool.end();
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function bootstrapOnSqlite(
  input: BootstrapOwnerInput,
  dbPath: string,
): Promise<BootstrapOwnerResult> {
  const db = openDatabase(dbPath);
  try {
    const appDb = sqliteAppDatabase(db);
    const mail = createOutboxTransport(appDb);
    const auth = createAuth({
      db: appDb,
      dialect: new NodeSqliteDialect({ database: db }),
      kyselyType: "sqlite",
      mail,
      baseUrl: appBaseUrl(),
    });
    const owner = await provisionStaffMember(auth, appDb, ownerInput(input));
    return { ...owner, store: `SQLite database at ${dbPath}` };
  } finally {
    db.close();
  }
}

/**
 * Creates the first owner account on the store the running app would use:
 * `databaseUrl` selects Postgres (applying the tracked migrations first, so
 * a fresh project works), otherwise the SQLite development file. The result
 * names the store that was written (ticket 19).
 */
export async function bootstrapOwner(
  input: BootstrapOwnerInput,
): Promise<BootstrapOwnerResult> {
  if (input.databaseUrl) {
    return bootstrapOnPostgres(input, input.databaseUrl);
  }
  return await bootstrapOnSqlite(input, input.dbPath ?? appDbPath());
}

/** host + database path of a connection string; unparseable input stays safe. */
function safePostgresTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(an unparseable connection string)";
  }
}
