// Ticket 99 concurrency/load harness: prove that the dashboard's read shape
// under the app's real pool configuration does not reach the shared session
// pooler's 15-client cap, and that the pre-ticket-99 shape does.
//
// The production failure (ticket 99): opening /dashboard fanned out ~10
// database-backed renders at once (the sidebar's prefetched nav rows, the
// document, the needs-human poller) across multiple Vercel function
// instances. Every instance holds up to PG_POOL_MAX client connections, and
// the shared SESSION pooler rejects clients past its server-side pool size
// (15): `EMAXCONNSESSION` → HTTP 500.
//
// What this harness runs, against a disposable Postgres:
//   1. A scratch database, migrated and seeded exactly like the app
//      (the buildPostgresService sequence, minus Supabase Auth).
//   2. A dedicated login role with CONNECTION LIMIT 15 — the same cap shape
//      as the production session pooler: the 16th concurrent connection is
//      rejected by the server itself, with the same "too many connections"
//      failure class as EMAXCONNSESSION.
//   3. At least eight simulated dashboard users spread across several
//      openPostgres handles (modeling separate Vercel instances). Each user
//      runs dashboard-shaped renders built from the REAL store/settings
//      reads, keeping the Settings page's ≤4-concurrent-read shape
//      (ticket 89) and the needs-human poll read (ticket 79).
//   4. Default run: every render must complete with zero rejections while
//      the peak concurrent connection count is reported against the cap —
//      the previous failure shape must not reproduce.
//      `--control`: reruns the pre-ticket-99 shape (the old pool default 8
//      and a first-visit prefetch burst of 11 concurrent renders per user)
//      and EXPECTS the cap to reject — proving this harness can catch the
//      failure shape it guards against.
//
// Usage:
//   npm run load:dashboard -- [--admin postgresql://postgres@127.0.0.1:5433/postgres] [--control]
//
// The load shape is fixed — 8 users × 3 renders across 3 instance pools at
// the app's shipped per-instance ceiling (8 under --control, the
// pre-ticket-99 default) — so the run demonstrates exactly the
// configuration that ships, not a parameterized family of them. The
// default target is this machine's local trust-auth cluster (ticket 91).
// Nothing here touches production: the scratch database is dropped on exit,
// the role is kept (the ticket-79 precedent), and no credentials are
// printed or stored.
import postgres from "postgres";
import { openPostgres, migratePostgres, type PostgresSql } from "../src/db/postgres";
import { postgresAppDatabase, type AppDatabase } from "../src/db/appDatabase";
import { createPostgresStore } from "../src/store/postgresStore";
import { seedAnswerRules } from "../src/store/seed";
import {
  getDashboardFaviconVersion,
  getEscalationPhrases,
  getHandoffOptions,
  readEmbedAllowlist,
  readTranscriptRetention,
  seedEmbedAllowlist,
  seedEscalationPhrases,
  seedHandoffOptions,
} from "../src/settings";
import type { Store } from "../src/domain/types";

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const adminUrl = readFlag("admin") ?? "postgresql://postgres@127.0.0.1:5433/postgres";
const control = process.argv.includes("--control");
// The ticket 99 demonstration shape: at least eight active dashboard users,
// three iterations each, spread over three instance pools.
const USERS = 8;
const ITERATIONS = 3;
const INSTANCES = 3;
// The shipped per-instance ceiling; the control pins the pre-ticket-99
// default of 8.
const POOL_MAX = control ? 8 : 4;

const DB = "sfc_load_harness";
const ROLE = "sfc_load_harness";
// The shared session pooler's production cap shape: pool_size 15.
const CAP = 15;

interface Instance {
  sql: PostgresSql;
  store: Store;
  db: AppDatabase;
}

/** One authed dashboard visit's read shape, from the app's real seams. */
async function dashboardRender(instance: Instance): Promise<void> {
  // The protected-request transaction seam: the app serializes threshold
  // decisions (rate limits, guarded transitions) through
  // AppDatabase.transaction — an advisory-locked `sql.begin`. A transaction
  // holds a dedicated socket for its duration, which is what multiplies a
  // Vercel instance's client connections past its read concurrency in
  // production; leaving it out made the control's burst pipeline into a
  // handful of sockets and miss the cap (first harness iteration). The
  // modeled transaction runs ~150 ms — the order of a real protected
  // request's serialized write across the WAN — so concurrent transactions
  // genuinely overlap instead of draining between scheduler ticks.
  await instance.db.transaction("harness-render", async (tx) => {
    await tx.run("SELECT pg_sleep(0.15)");
  });
  // The needs-human poll read (ticket 79's bell state), as its own request.
  await instance.store.listConversationsByState("awaiting_staff");
  // The Settings page's first batch (ticket 89's ≤4-concurrent shape) with
  // the conversation desk's list — the heaviest single authed read.
  await Promise.all([
    instance.store.listConversations(),
    readEmbedAllowlist(instance.db),
    readTranscriptRetention(instance.db),
    getEscalationPhrases(instance.db),
  ]);
  // The second batch: contact requests, handoff options, and the layout's
  // per-request favicon-version read.
  await Promise.all([
    instance.store.listOpenContactRequests(),
    getHandoffOptions(instance.db),
    getDashboardFaviconVersion(instance.db),
  ]);
}

/** True when the server refused the connection for exceeding a cap. */
function isCapRejection(error: unknown): boolean {
  if ((error as { code?: string }).code === "53300") return true;
  return /too many connections/i.test(String((error as Error)?.message ?? ""));
}

async function run(): Promise<0 | 1> {
  process.env.PG_POOL_MAX = String(POOL_MAX);
  const admin = postgres(adminUrl, { max: 2, connect_timeout: 10, onnotice: () => {} });
  const instancesOpened: Instance[] = [];
  let peak = 0;
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      try {
        const rows = await admin.unsafe<{ n: number }[]>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = $1",
          [ROLE],
        );
        peak = Math.max(peak, rows[0]?.n ?? 0);
      } catch {
        // The watcher never contributes failures; the next tick retries.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();

  try {
    // Scratch store: dropped and recreated per run, migrated and seeded
    // exactly like the app's own boot sequence. Owned by the harness role:
    // PostgreSQL 15+ leaves the public schema unwritable to non-owners, and
    // the migrations must run as that role (the capped connection is the
    // one the app's pool uses).
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB} OWNER ${ROLE}`);
    const roles = await admin.unsafe("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLE]);
    if (roles.length === 0) {
      await admin.unsafe(`CREATE ROLE ${ROLE} LOGIN`);
    }
    await admin.unsafe(`ALTER ROLE ${ROLE} CONNECTION LIMIT ${CAP}`);

    // The application connects AS the capped role — reusing the admin's
    // username here would dodge the connection limit this harness exists to
    // enforce (caught by the first run: peak 0/15, the cap never applied).
    // Node's URL parser swallows the authority of a passwordless
    // postgres:// URL (the tests/postgres-pool-bounds.ts trick): swap the
    // scheme for the parse, then rebuild with the harness role and scratch
    // database. The role has no password: the default target is the local
    // trust-auth cluster (ticket 91).
    const parsed = new URL(adminUrl.replace(/^postgres(ql)?:/, "http:"));
    const appUrl = `postgresql://${ROLE}@${parsed.hostname}:${parsed.port}/${DB}`;

    const setup = openPostgres(appUrl);
    try {
      await migratePostgres(setup);
      const db = postgresAppDatabase(setup);
      const store = createPostgresStore(setup);
      await seedAnswerRules(store);
      await seedEscalationPhrases(db);
      await seedHandoffOptions(db);
      await seedEmbedAllowlist(db);
    } finally {
      await setup.end({ timeout: 5 });
    }

    // Several openPostgres handles model separate Vercel instances; each
    // contributes up to PG_POOL_MAX client connections (openPostgres reads
    // the env per call, so the pin above took effect).
    for (let i = 0; i < INSTANCES; i++) {
      const sql = openPostgres(appUrl);
      instancesOpened.push({
        sql,
        store: createPostgresStore(sql),
        db: postgresAppDatabase(sql),
      });
    }

    console.log(
      `ticket 99 load harness${control ? " (control: pre-ticket-99 shape)" : ""}`,
    );
    console.log(
      `target: scratch database ${DB} (dropped on exit), role ${ROLE} CONNECTION LIMIT ${CAP}`,
    );
    console.log(
      `load: ${USERS} users × ${ITERATIONS} renders across ${INSTANCES} instance pools, PG_POOL_MAX=${POOL_MAX}`,
    );

    const started = Date.now();
    let completed = 0;
    const failures: { error: unknown }[] = [];
    await Promise.all(
      Array.from({ length: USERS }, async (_, user) => {
        for (let i = 0; i < ITERATIONS; i++) {
          const instance = instancesOpened[(user + i) % instancesOpened.length];
          if (!instance) {
            throw new Error("harness configuration error: missing instance handle");
          }
          try {
            if (control && i === 0) {
              // The first-visit prefetch fan-out: the old sidebar behavior
              // issued every nav row's RSC render as the dashboard opened
              // (~10–12 concurrent renders per visit, the ticket 99 evidence).
              await Promise.all(
                Array.from({ length: 11 }, () => dashboardRender(instance)),
              );
            } else {
              await dashboardRender(instance);
            }
            completed++;
          } catch (error) {
            failures.push({ error });
          }
        }
      }),
    );
    const elapsedMs = Date.now() - started;
    watching = false;
    await watcher;

    const capRejections = failures.filter((f) => isCapRejection(f.error)).length;
    console.log(`renders: ${completed} completed, ${failures.length} failed in ${elapsedMs} ms`);
    console.log(`peak concurrent connections: ${peak}/${CAP}`);
    if (failures.length > 0) {
      for (const f of failures.slice(0, 5)) {
        const error = f.error as { code?: string; message?: string };
        console.error(
          `  failure${error.code ? ` [${error.code}]` : ""}: ${String(error.message ?? f.error).slice(0, 120)}`,
        );
      }
    }

    if (!control) {
      if (failures.length > 0) {
        console.error(
          "FAIL: renders failed under the enforced 15-connection cap — the previous failure shape reproduced.",
        );
        return 1;
      }
      console.log(
        `PASS: zero rejections at peak ${peak}/${CAP} — the previous 15-session failure shape did not reproduce.`,
      );
      return 0;
    }
    // The control reproduces the failure SHAPE: renders failing because the
    // enforced 15-connection cap bit (peak at the cap). The driver may
    // surface the refused 16th connection either as a direct
    // "too many connections" rejection or — after its own connect retries —
    // as one of ticket 90's bounded rejections; either way the renders
    // failed under the cap, which is what production answered as 500s.
    if (failures.length === 0 || peak < CAP) {
      console.error(
        "CONTROL FAIL: the pre-ticket-99 shape did not reproduce the failure shape this harness guards against (expected failures at the enforced cap).",
      );
      return 1;
    }
    console.log(
      `CONTROL PASS: the pre-ticket-99 shape reproduced the failure — ${failures.length} failed renders with peak connections at the ${CAP} cap (${capRejections} direct "too many connections" rejections, the rest bounded rejections after refused connects).`,
    );
    return 0;
  } finally {
    watching = false;
    for (const instance of instancesOpened) {
      await instance.sql.end({ timeout: 5 });
    }
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    } catch {
      // A failed run must not mask its own error: the next run's leading
      // DROP ... IF EXISTS reaps any leftover scratch database.
    }
    await admin.end({ timeout: 5 });
    console.log(`cleanup: scratch database ${DB} dropped (role ${ROLE} kept, ticket-79 precedent).`);
  }
}

process.exitCode = await run();
