import type { DatabaseSync } from "node:sqlite";
import type { Sql } from "postgres";

/**
 * The small query surface every non-store consumer uses (settings, seeds,
 * notifications, mail outbox, staff administration, auth helpers). Both
 * backends implement it, so those consumers hold portable SQL — plain
 * statements with `?` placeholders that SQLite and Postgres answer
 * identically — while the Store keeps a dedicated implementation per
 * backend (its transactions and upserts are dialect-shaped).
 *
 * Every method is asynchronous because the Postgres driver is; the SQLite
 * adapter wraps its synchronous answers.
 */
export interface AppDatabase {
  /** The first row of a query, or undefined. */
  get<T>(query: string, ...params: unknown[]): Promise<T | undefined>;
  /** Every row of a query. */
  all<T>(query: string, ...params: unknown[]): Promise<T[]>;
  /** A write; `changes` reports affected rows where the backend provides it. */
  run(query: string, ...params: unknown[]): Promise<{ changes: number }>;
}

/** The SQLite adapter: a thin asynchronous restatement of node:sqlite.
    Booleans normalize to 0/1 — node:sqlite refuses real booleans, and the
    auth tables' flag columns are what portable statements write. */
export function sqliteAppDatabase(db: DatabaseSync): AppDatabase {
  const portable = (params: unknown[]): unknown[] =>
    params.map((param) => (typeof param === "boolean" ? (param ? 1 : 0) : param));
  return {
    async get<T>(query: string, ...params: unknown[]): Promise<T | undefined> {
      return db.prepare(query).get(...(portable(params) as never[])) as T | undefined;
    },
    async all<T>(query: string, ...params: unknown[]): Promise<T[]> {
      return db.prepare(query).all(...(portable(params) as never[])) as T[];
    },
    async run(query: string, ...params: unknown[]): Promise<{ changes: number }> {
      return { changes: Number(db.prepare(query).run(...(portable(params) as never[])).changes) };
    },
  };
}

/** `?` placeholders become Postgres's positional `$1..$n`. Module-internal
 *  (ticket 34): only this file's adapters rewrite statements. */
function toPositionalParameters(query: string): string {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

/**
 * The Postgres adapter over a postgres.js handle. Statement strings arrive
 * in the portable `?` form and are rewritten positionally; postgres.js
 * sends parameters out-of-band, so untrusted text can never change a
 * statement's shape.
 */
export function postgresAppDatabase(sql: Sql): AppDatabase {
  async function runQuery<T>(query: string, params: unknown[]): Promise<T[]> {
    return (await sql.unsafe(toPositionalParameters(query), params as never[])) as T[];
  }
  return {
    async get<T>(query: string, ...params: unknown[]): Promise<T | undefined> {
      const rows = await runQuery<T>(query, params);
      return rows[0];
    },
    async all<T>(query: string, ...params: unknown[]): Promise<T[]> {
      return runQuery<T>(query, params);
    },
    async run(query: string, ...params: unknown[]): Promise<{ changes: number }> {
      const rows = await runQuery(query, params);
      // postgres.js tags write results with the affected-row count.
      const count = (rows as unknown as { count?: number }).count;
      return { changes: count ?? 0 };
    },
  };
}
