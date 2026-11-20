import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import net from "node:net";

process.env.PG_POOL_MAX = process.env.PG_POOL_MAX ?? "3";

import { openPostgres } from "../src/db/postgres";
import { testPostgresUrl } from "./helpers";

/**
 * Ticket 90: the Supabase transaction pooler intermittently stops answering
 * queries on established client sockets under multi-socket concurrent load
 * (the server side stays idle — the stall is on the pooler path), and in bad
 * windows it also stalls new handshakes. postgres.js has no bound on in-flight
 * queries, so every socket hit by the stall holds its lease forever, the whole
 * pool wedges, and no error ever surfaces (the cert70 failures in tickets
 * 89/90). The proven fix: `query_timeout`/`queue_timeout` so a stalled query
 * rejects within a fixed bound and the pool recovers (the differential
 * harness in `.scratch/t90-harness.mjs` showed 4.1.1 with these options heal
 * on the same endpoint that permanently wedges both driver versions without
 * them).
 *
 * This file pins the bound at the real seam — `openPostgres` — without the
 * hosted pooler's weather: a local TCP proxy fronts the test Postgres server,
 * relays the startup handshake and a warmup query normally, then (after a
 * 2 s relay window, plenty on loopback) silently swallows every further
 * client→server byte while keeping both sockets open — the "silent endpoint"
 * the hosted transaction pooler produces. Every query issued after that must
 * reject within the configured bound; on the pre-fix driver the same queries
 * hang forever and this file goes red at the race.
 */

const RELAY_WINDOW_MS = 2000;
const QUERY_TIMEOUT_S = 2;
// query_timeout counts waiting + running; a canceled query may take up to the
// default cancel_timeout (5 s) before its connection is destroyed. The race
// only decides pass/fail: anything slower than this bound is the wedge.
const BOUND_MS = QUERY_TIMEOUT_S * 1000 + 5500 + 1500;

/** Listens briefly, then swallows client→server bytes, sockets staying open. */
async function swallowProxy(targetHost: string, targetPort: number): Promise<number> {
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, targetHost);
    let relaying = true;
    client.on("data", (chunk) => {
      if (relaying) upstream.write(chunk);
    });
    upstream.on("data", (chunk) => client.write(chunk));
    const timer = setTimeout(() => {
      relaying = false;
    }, RELAY_WINDOW_MS);
    client.on("close", () => {
      clearTimeout(timer);
      upstream.destroy();
    });
    upstream.on("close", () => client.destroy());
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

describe("postgres pool bounds (ticket 90)", () => {
  it.runIf(testPostgresUrl())(
    "a silent endpoint rejects queries within the bound instead of hanging the pool",
    async () => {
      // Parse via a special scheme: Node's URL parser swallows the authority
      // of a passwordless `postgres://user@host` URL (non-special scheme).
      const admin = new URL(testPostgresUrl()!.replace(/^postgresql:/, "http://"));
      const port = await swallowProxy(admin.hostname, Number(admin.port || 5432));
      const auth = admin.password
        ? `${admin.username}:${admin.password}@`
        : `${admin.username}@`;
      const proxyUrl = `postgresql://${auth}127.0.0.1:${port}/postgres`;

      // The overrides below must not leak into the shared worker: vitest
      // reuses worker state, and a lingering 2 s bound would flake later PG
      // work with exactly the QUERY_TIMEOUT cancels the helpers relaxation
      // exists to prevent. Each original is restored — or deleted, if it
      // was absent — in the finally, which runs even when the test fails.
      const previousQueryTimeout = process.env.PG_QUERY_TIMEOUT;
      const previousQueueTimeout = process.env.PG_QUEUE_TIMEOUT;
      try {
        // Short bounds for the test itself; openPostgres reads env per call.
        process.env.PG_QUERY_TIMEOUT = String(QUERY_TIMEOUT_S);
        process.env.PG_QUEUE_TIMEOUT = String(QUERY_TIMEOUT_S);
        const sql = openPostgres(proxyUrl);

        const outcome = async (promise: Promise<unknown>) =>
          Promise.race([
            promise.then(
              () => "settled" as const,
              (error: unknown) => `rejected: ${String(error).slice(0, 80)}`,
            ),
            new Promise<"HUNG">((resolve) => setTimeout(() => resolve("HUNG"), BOUND_MS)),
          ]);

        try {
          // Inside the relay window: handshake, auth, and one clean query.
          const warm = await outcome(sql.unsafe("SELECT 1"));
          expect(warm).toBe("settled");

          // Wait out the relay window, then hit the silent endpoint the way the
          // hosted transaction pooler hits the app: singles after a wedge and a
          // parallel burst — every query must reject within the bound.
          await new Promise((resolve) => setTimeout(resolve, RELAY_WINDOW_MS + 500));
          const single = await outcome(sql.unsafe("SELECT 1"));
          expect(single).not.toBe("HUNG");
          expect(String(single)).toMatch(/^rejected/);

          const burst = await Promise.all(
            Array.from({ length: 8 }, () => outcome(sql.unsafe("SELECT 1"))),
          );
          for (const one of burst) expect(one).not.toBe("HUNG");
        } finally {
          await Promise.race([
            sql.end({ timeout: 2 }),
            new Promise((resolve) => setTimeout(resolve, 5000)),
          ]).catch(() => {});
        }
      } finally {
        if (previousQueryTimeout === undefined) {
          delete process.env.PG_QUERY_TIMEOUT;
        } else {
          process.env.PG_QUERY_TIMEOUT = previousQueryTimeout;
        }
        if (previousQueueTimeout === undefined) {
          delete process.env.PG_QUEUE_TIMEOUT;
        } else {
          process.env.PG_QUEUE_TIMEOUT = previousQueueTimeout;
        }
      }
    },
    60_000,
  );
});
