import type { DatabaseSync } from "node:sqlite";
import type { Sql, TransactionSql } from "postgres";

/**
 * The small query surface every non-store consumer uses (settings, seeds,
 * settings, staff administration, and auth helpers). Both
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
  /**
   * Serializes `fn` against every other transaction keyed the same: none
   * observes the database between `fn`'s reads and its last write, so a
   * same-key decision's count cannot go stale before its write lands.
   * Count-then-write sequences that decide a threshold or a guarded
   * transition must go through this — bare get/run lets a concurrent
   * writer slip between the read and the write, and both miss.
   */
  transaction<T>(key: string, fn: (tx: AppDatabaseTx) => Promise<T>): Promise<T>;
}

/** The statement surface a transaction body speaks. On Postgres it is the
 *  transaction's own connection (transactions do not nest); on SQLite the
 *  one adapter, serialized by the queue. */
export type AppDatabaseTx = Pick<AppDatabase, "get" | "all" | "run">;

/** The SQLite adapter: a thin asynchronous restatement of node:sqlite.
    Booleans normalize to 0/1 — node:sqlite refuses real booleans, and the
    auth tables' flag columns are what portable statements write. */
export function sqliteAppDatabase(db: DatabaseSync): AppDatabase {
  const portable = (params: unknown[]): unknown[] =>
    params.map((param) => (typeof param === "boolean" ? (param ? 1 : 0) : param));
  // The transaction queue: one turn at a time, in submission order, so two
  // keyed decisions can never interleave their reads and writes. Statements
  // stay individually atomic — the driver is synchronous — and no db-level
  // BEGIN is taken: held open across awaits it would collide with the
  // store's own transactions (a synchronous BEGIN inside an open one throws
  // in whichever direction collides), and a rollback could undo a foreign
  // statement that interleaved into the open transaction. The queue gives
  // threshold decisions their atomicity without either hazard; each
  // statement committing on its own is the exposure this path always had.
  let turns: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const turn = turns.then(fn);
    turns = turn.then(() => undefined, () => undefined);
    return turn;
  }
  const adapter: AppDatabase = {
    async get<T>(query: string, ...params: unknown[]): Promise<T | undefined> {
      return db.prepare(query).get(...(portable(params) as never[])) as T | undefined;
    },
    async all<T>(query: string, ...params: unknown[]): Promise<T[]> {
      return db.prepare(query).all(...(portable(params) as never[])) as T[];
    },
    async run(query: string, ...params: unknown[]): Promise<{ changes: number }> {
      return { changes: Number(db.prepare(query).run(...(portable(params) as never[])).changes) };
    },
    transaction<T>(_key: string, fn: (tx: AppDatabaseTx) => Promise<T>): Promise<T> {
      // The key names the decision's domain (the login log keys on the
      // client IP); this backend has one in-process connection, so a single
      // queue serializes every keyed decision.
      return serialized(() => fn(adapter));
    },
  };
  return adapter;
}

/** `?` placeholders become Postgres's positional `$1..$n`. Module-internal
 *  (ticket 34): only this file's adapters rewrite statements. */
function toPositionalParameters(query: string): string {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

/** The row-shaping shared by the pooled adapter and the per-transaction
 *  adapter below: both speak portable `?` SQL over an unsafe() runner. */
function postgresAdapterOver(
  unsafe: (query: string, params: never[]) => Promise<unknown>,
): AppDatabaseTx {
  async function runQuery<T>(query: string, params: unknown[]): Promise<T[]> {
    return (await unsafe(toPositionalParameters(query), params as never[])) as T[];
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

/**
 * The Postgres adapter over a postgres.js handle. Statement strings arrive
 * in the portable `?` form and are rewritten positionally; postgres.js
 * sends parameters out-of-band, so untrusted text can never change a
 * statement's shape.
 */
export function postgresAppDatabase(sql: Sql): AppDatabase {
  const direct = postgresAdapterOver((query, params) => sql.unsafe(query, params));
  return {
    ...direct,
    transaction<T>(key: string, fn: (tx: AppDatabaseTx) => Promise<T>): Promise<T> {
      // A real transaction, serialized by a transaction-scoped advisory
      // lock on the key: under READ COMMITTED two concurrent transactions
      // could otherwise both count the same committed past and both miss a
      // threshold, so the lock must be held before any statement of `fn`
      // runs — which sql.begin's first statement achieves. An error that
      // aborts the transaction releases the lock with it. hashtext
      // collisions across distinct keys only add serialization, never
      // incorrectness.
      return sql.begin<T>(async (tx: TransactionSql) => {
        await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))", [key] as never[]);
        return fn(postgresAdapterOver((query, params) => tx.unsafe(query, params)));
      }) as Promise<T>;
    },
  };
}
