import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

export type PostgresSql = postgres.Sql;
import { repoRoot } from "../paths";

const POSTGRES_MIGRATIONS_DIR = path.join(repoRoot(), "migrations", "postgres");



/**
 * Opens the Postgres connection for a Supabase-style DATABASE_URL. Prepared
 * statements are off by default: the serverless-friendly Supabase pooler
 * (transaction mode) rejects them, and the cost is negligible for this
 * application's query shapes. Handshakes to the hosted pooler can stall
 * (observed ~60s windows where every new connection hangs), so login gets a
 * short timeout: the pool discards the hung connect and retries instead of
 * queueing the whole app behind it.
 *
 * The hosted transaction pooler can also silently stop answering queries on
 * established sockets under bursty multi-socket load while the server side
 * stays idle (ticket 90). Without an in-flight bound, every socket the stall
 * touches holds its lease forever and the whole pool wedges with zero errors.
 * `query_timeout`/`queue_timeout` (postgres.js ≥ 4.1) turn that wedge into a
 * bounded rejection per query, after which the pool opens fresh sockets and
 * recovers. Ten seconds is far above this application's warm query times
 * (well under a second, even across the WAN) and far below the hosted
 * statement timeout.
 *
 * The pool ceiling is per instance, and a serverless deployment runs many
 * instances: every warm Vercel function instance contributes up to `max`
 * client connections to the hosted pooler, so a burst of renders across
 * instances multiplies them (the 2026-11-22 production outage, ticket 99 —
 * the shared session pooler capped clients at its 15 server sessions and
 * rejected the rest). The default stays conservative at 4: it matches the
 * Settings page's four-read concurrency (ticket 89) so that render never
 * queues behind itself, while keeping the per-instance client footprint
 * small. Production targets the transaction pooler (:6543), where client
 * connections multiplex over the shared server sessions and this ceiling
 * bounds queue pileups rather than client counts.
 */
export function openPostgres(url: string): PostgresSql {
  return postgres(url, {
    prepare: process.env.PG_PREPARE === "true",
    max: Number(process.env.PG_POOL_MAX ?? 4),
    connect_timeout: 10,
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT ?? 10),
    queue_timeout: Number(process.env.PG_QUEUE_TIMEOUT ?? 10),
  });
}

/**
 * Applies pending versioned migrations (migrations/postgres/NNNN_*.sql,
 * tracked in the _migrations table). Each file runs in its own transaction
 * with the tracking insert, so a failed migration leaves no partial state.
 */
export async function migratePostgres(sql: PostgresSql): Promise<void> {
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const applied = new Set(
    (await sql.unsafe<{ name: string }[]>("SELECT name FROM _migrations")).map(
      (row) => row.name,
    ),
  );
  const files = readdirSync(POSTGRES_MIGRATIONS_DIR)
    .filter((name) => /^\d{4}.*\.sql$/.test(name))
    .sort();
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const statements = readFileSync(path.join(POSTGRES_MIGRATIONS_DIR, file), "utf8");
    await sql.begin(async (tx: postgres.TransactionSql) => {
      await tx.unsafe(statements);
      await tx.unsafe("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    });
  }
}

/**
 * A short-lived handle for one-off administrative work (creating a test
 * database, running the data migration): connects, runs the given body,
 * always closes the connection.
 */
export async function withPostgres<T>(
  url: string,
  body: (sql: PostgresSql) => Promise<T>,
): Promise<T> {
  const sql = openPostgres(url);
  try {
    return await body(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
