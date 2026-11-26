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
 * recovers. Fifteen and ten seconds are far above this application's warm
 * query times (well under a second, even across the WAN) and far below the
 * hosted statement timeout. Every timeout option is in seconds — postgres.js
 * multiplies them onto millisecond timers itself.
 *
 * Transaction mode (port 6543) is the owner-approved, monitored runtime
 * retry for Vercel traffic (ticket 105; the 2026-11-22 attempt was rolled
 * back for chronic stall weather, tickets 100/101 — deployment.md §7 keeps
 * the runbook and the rollback URL). The pooler multiplexes many clients
 * over a few server sessions and does not support query pipelining, while
 * postgres.js pipelines up to 100 queries per socket by default — the
 * documented combo can hang queries or mismatch rows. `max_pipeline: 1`
 * serializes in-flight queries per socket, making the client protocol-safe;
 * with `max: 1` each instance speaks single-socket traffic, so a busy
 * socket means queued waits (bounded by `queue_timeout`), never a second
 * pipeline. `idle_timeout: 10` closes sockets after ten idle seconds so a
 * warm serverless instance releases its client slots instead of holding
 * them for its lifetime — the 2026-11-26 outage (ticket 105) showed the
 * session pooler rejecting new clients while idle sockets squatted the
 * cap; released sockets reopen on demand.
 *
 * Migrations and operator scripts call this same opener but run against
 * their own environment's direct/session URL (the standing session pooler
 * :5432 locally), not the runtime transaction pooler; the options above are
 * protocol-safe there too (pipelining off only serializes). The cutover and
 * rollback steps, including the production `PG_POOL_MAX`, live in
 * deployment.md §7.
 */
/**
 * Reads one of the numeric `PG_*` overrides; an unset OR blank variable
 * means the default. A bare `Number(raw ?? fallback)` would turn the blank
 * value a copied-`.env.example` line (or an empty Vercel env entry) carries
 * into `Number("") = 0` — for `PG_IDLE_TIMEOUT` that silently disables idle
 * release again (the squatting behavior this configuration exists to end),
 * and for `PG_POOL_MAX` it would mean a pool of zero connections.
 */
function envOverride(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : Number(raw);
}

export function openPostgres(url: string): PostgresSql {
  return postgres(url, {
    prepare: process.env.PG_PREPARE === "true",
    max: envOverride("PG_POOL_MAX", 1),
    max_pipeline: 1,
    idle_timeout: envOverride("PG_IDLE_TIMEOUT", 10),
    connect_timeout: 10,
    query_timeout: envOverride("PG_QUERY_TIMEOUT", 15),
    queue_timeout: envOverride("PG_QUEUE_TIMEOUT", 10),
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
