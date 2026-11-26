import { describe, expect, it } from "vitest";
import { openPostgres } from "../src/db/postgres";

/**
 * `openPostgres` is the one place the application's Postgres client options
 * live, and the hosted-pooler posture depends on exactly this configuration.
 * The ticket-105 pins (owner-approved controlled transaction-pooler retry;
 * values verified against installed postgres.js 4.1.1, where every timeout
 * option is seconds and `max_pipeline` gates pipelining per socket):
 *
 * - `prepare: false` — the hosted Supabase poolers reject prepared
 *   statements (ticket 99's audit); transaction mode makes this
 *   load-bearing, not just an optimization.
 * - `max_pipeline: 1` — the transaction pooler does not support query
 *   pipelining and postgres.js pipelines up to 100 queries per socket by
 *   default (documented to hang queries or mismatch rows); one in-flight
 *   query per socket is the protocol-safe shape. Fixed: no override.
 * - `max` at 1 — the approved runtime pool size (ticket 105): every warm
 *   Vercel instance contributes up to this many client connections to the
 *   pooler, and with pipelining off a busy socket queues waits (bounded by
 *   `queue_timeout`) instead of opening a second pipeline.
 * - `idle_timeout` at 10 — idle sockets close and release their pooler
 *   client slots instead of squatting them for the instance's lifetime
 *   (the 2026-11-26 EMAXCONNSESSION outage mechanism, ticket 105);
 *   sockets reopen on demand.
 * - `query_timeout` at 15 / `queue_timeout` at 10 — ticket 90's wedge
 *   bounds (a stalled query rejects within a fixed bound and the pool
 *   recovers), re-approved at 15/10 for the retry.
 * - `connect_timeout` at 10 — the fixed bound that discards a hung hosted
 *   handshake (tickets 89/90). Fixed: no override.
 *
 * Pure introspection: the handle is created and never connected, so the
 * file runs on both dialects and needs no server.
 */

/** Every variable openPostgres reads. */
const OVERRIDABLE = [
  "PG_POOL_MAX",
  "PG_PREPARE",
  "PG_QUERY_TIMEOUT",
  "PG_QUEUE_TIMEOUT",
  "PG_IDLE_TIMEOUT",
] as const;

/**
 * Runs the body with the overridable variables deleted (or set to the given
 * overrides), then restores whatever each held before — including deleting
 * it again if it was absent. The ticket-90 review's environment-leak
 * discipline: vitest workers share state, and a lingering override would
 * flake later PG work.
 */
function withPoolEnv<T>(overrides: Record<string, string>, body: () => T): T {
  const saved = OVERRIDABLE.map((name) => [name, process.env[name]] as const);
  for (const [name] of saved) {
    delete process.env[name];
  }
  Object.assign(process.env, overrides);
  try {
    return body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

describe("openPostgres pool configuration (ticket 105)", () => {
  it("defaults to the approved transaction-pooler retry shape", () => {
    const sql = withPoolEnv({}, () =>
      openPostgres("postgresql://introspection@127.0.0.1:1/probe"),
    );
    expect(sql.options.max).toBe(1);
    expect(sql.options.max_pipeline).toBe(1);
    expect(sql.options.prepare).toBe(false);
    expect(sql.options.idle_timeout).toBe(10);
    expect(sql.options.connect_timeout).toBe(10);
    expect(sql.options.query_timeout).toBe(15);
    expect(sql.options.queue_timeout).toBe(10);
  });

  it("still honors the documented env overrides without moving the fixed bounds", () => {
    const sql = withPoolEnv(
      {
        PG_POOL_MAX: "2",
        PG_PREPARE: "true",
        PG_QUERY_TIMEOUT: "3",
        PG_QUEUE_TIMEOUT: "5",
        PG_IDLE_TIMEOUT: "30",
      },
      () => openPostgres("postgresql://introspection@127.0.0.1:1/probe"),
    );
    expect(sql.options.max).toBe(2);
    expect(sql.options.prepare).toBe(true);
    expect(sql.options.query_timeout).toBe(3);
    expect(sql.options.queue_timeout).toBe(5);
    expect(sql.options.idle_timeout).toBe(30);
    // connect_timeout has no documented env override: the fixed 10 s that
    // discards a hung hosted handshake (tickets 89/90) stays.
    expect(sql.options.connect_timeout).toBe(10);
    // max_pipeline is pinned at 1 on purpose: pipelining off is the
    // transaction pooler's protocol requirement (ticket 105), not a tuning
    // knob — the env must not be able to re-enable it.
    expect(sql.options.max_pipeline).toBe(1);
  });

  it("PG_IDLE_TIMEOUT=0 disables idle release, matching postgres.js's semantics", () => {
    const sql = withPoolEnv({ PG_IDLE_TIMEOUT: "0" }, () =>
      openPostgres("postgresql://introspection@127.0.0.1:1/probe"),
    );
    expect(sql.options.idle_timeout).toBe(0);
  });

  it("a blank variable means unset, not Number('') = 0 (the copied-.env.example shape)", () => {
    const sql = withPoolEnv(
      { PG_POOL_MAX: "", PG_QUERY_TIMEOUT: "", PG_QUEUE_TIMEOUT: "", PG_IDLE_TIMEOUT: "" },
      () => openPostgres("postgresql://introspection@127.0.0.1:1/probe"),
    );
    expect(sql.options.max).toBe(1);
    expect(sql.options.idle_timeout).toBe(10);
    expect(sql.options.query_timeout).toBe(15);
    expect(sql.options.queue_timeout).toBe(10);
  });
});
