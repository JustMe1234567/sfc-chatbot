import { describe, expect, it } from "vitest";
import { openPostgres } from "../src/db/postgres";

/**
 * Ticket 99: `openPostgres` is the one place the application's Postgres
 * client options live, and the production transaction-pooler cutover
 * depends on exactly this configuration. The pins:
 *
 * - `prepare: false` — the hosted Supabase poolers reject prepared
 *   statements (ticket 99's audit); transaction mode makes this
 *   load-bearing, not just an optimization.
 * - `query_timeout`/`queue_timeout` at 10 s — ticket 90's wedge bound,
 *   preserved unchanged: the transaction pooler can stall sockets, and
 *   these bounds are what turn a stall into a bounded rejection plus a
 *   recovered pool.
 * - `max` at 4 — the conservative per-instance ceiling (ticket 99): every
 *   warm Vercel instance contributes up to this many client connections to
 *   the hosted pooler, and the shared session pooler rejected clients past
 *   its 15 server sessions (the production outage). 4 matches the Settings
 *   page's four-read concurrency (ticket 89), so that render never queues
 *   behind itself while the per-instance footprint stays small.
 *
 * Pure introspection: the handle is created and never connected, so the
 * file runs on both dialects and needs no server.
 */

/** Every variable openPostgres reads; each test restores all of them. */
const OVERRIDABLE = [
  "PG_POOL_MAX",
  "PG_PREPARE",
  "PG_QUERY_TIMEOUT",
  "PG_QUEUE_TIMEOUT",
] as const;

describe("openPostgres pool configuration (ticket 99)", () => {
  it("defaults to the conservative ceiling and the transaction-pooler-safe shapes", () => {
    const saved = OVERRIDABLE.map((name) => [name, process.env[name]] as const);
    for (const [name] of saved) {
      delete process.env[name];
    }
    try {
      const sql = openPostgres("postgresql://introspection@127.0.0.1:1/probe");
      expect(sql.options.max).toBe(4);
      expect(sql.options.prepare).toBe(false);
      expect(sql.options.connect_timeout).toBe(10);
      expect(sql.options.query_timeout).toBe(10);
      expect(sql.options.queue_timeout).toBe(10);
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it("still honors the documented env overrides without moving the fixed bounds", () => {
    const saved = OVERRIDABLE.map((name) => [name, process.env[name]] as const);
    process.env.PG_POOL_MAX = "2";
    process.env.PG_PREPARE = "true";
    process.env.PG_QUERY_TIMEOUT = "3";
    process.env.PG_QUEUE_TIMEOUT = "5";
    try {
      const sql = openPostgres("postgresql://introspection@127.0.0.1:1/probe");
      expect(sql.options.max).toBe(2);
      expect(sql.options.prepare).toBe(true);
      expect(sql.options.query_timeout).toBe(3);
      expect(sql.options.queue_timeout).toBe(5);
      // connect_timeout has no documented env override: the fixed 10 s that
      // discards a hung hosted handshake (tickets 89/90) stays.
      expect(sql.options.connect_timeout).toBe(10);
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });
});
