import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootstrapOwner } from "../src/auth/bootstrapOwner";
import { testPostgresUrl } from "./helpers";
import { withPostgres } from "../src/db/postgres";

// The Postgres-mode suite runs near the local cluster's connection ceiling:
// every worker holds its per-file pools. This file opens its own bootstrap
// connections on top, so it keeps both of its pools small (postgres.js and
// the auth pool read these at open time, and this worker is
// process-isolated from the other files).
process.env.PG_POOL_MAX = "2";
process.env.PG_AUTH_POOL_MAX = "2";

/**
 * Ticket 19: the owner bootstrap targets the active database store. The
 * core runs the same createAuth + provisionStaffMember flow the app uses,
 * on whichever store it is handed: a `databaseUrl` selects Postgres (with
 * the tracked migrations applied first, so a fresh project works), no URL
 * keeps the SQLite development path. Its result names the store it wrote,
 * without leaking credentials.
 */

const OWNER = {
  email: "bootstrap-owner@example.edu",
  password: "bootstrap-owner-password-19",
  name: "Bootstrap Owner",
};

function freshSqlitePath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "sfc-chatbot-boot-")), "test.db");
}

describe("bootstrapping on SQLite (no database URL)", () => {
  it("provisions a verified owner on a fresh file and names the store", async () => {
    const dbPath = freshSqlitePath();
    const result = await bootstrapOwner({ ...OWNER, databaseUrl: null, dbPath });
    expect(result.email).toBe(OWNER.email);
    expect(result.userId).toBeTruthy();
    expect(result.store).toContain("SQLite");
    expect(result.store).toContain(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      const row = db
        .prepare(
          'SELECT "emailVerified", "role" FROM "user" WHERE "email" = ?',
        )
        .get(OWNER.email) as { emailVerified: number; role: string } | undefined;
      expect(row?.role).toBe("owner");
      expect(Number(row?.emailVerified)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("refuses a duplicate email without touching the existing account", async () => {
    const dbPath = freshSqlitePath();
    await bootstrapOwner({ ...OWNER, databaseUrl: null, dbPath });
    await expect(
      bootstrapOwner({ ...OWNER, databaseUrl: null, dbPath }),
    ).rejects.toThrow();

    const db = new DatabaseSync(dbPath);
    try {
      const owners = db
        .prepare('SELECT COUNT(*) AS n FROM "user" WHERE "email" = ?')
        .get(OWNER.email) as { n: number };
      expect(owners.n).toBe(1);
    } finally {
      db.close();
    }
  });
});

const describeOnPostgres = testPostgresUrl() ? describe : describe.skip;

describeOnPostgres("bootstrapping on Postgres (a database URL)", () => {
  it("migrates a fresh database, provisions a verified owner, and names the store without credentials", async () => {
    const adminUrl = testPostgresUrl()!;
    const dbName = `sfc_test_boot_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const url = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
    const password = "super-secret-pw";
    const credentialedUrl = url.replace("://", `://postgres:${encodeURIComponent(password)}@`);

    await withPostgres(adminUrl, async (sql) => {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await sql.unsafe(`CREATE DATABASE ${dbName}`);
    });

    try {
      const result = await bootstrapOwner({ ...OWNER, databaseUrl: credentialedUrl });
      expect(result.email).toBe(OWNER.email);
      expect(result.userId).toBeTruthy();
      // The store is named, the credentials are not.
      expect(result.store).toContain("Postgres");
      expect(result.store).toContain(dbName);
      expect(result.store).not.toContain(password);

      await withPostgres(url, async (sql) => {
        const user = await sql.unsafe<
          { role: string; emailVerified: boolean }[]
        >(`SELECT "role", "emailVerified" FROM "user" WHERE "email" = $1`, [OWNER.email]);
        expect(user[0]?.role).toBe("owner");
        expect(user[0]?.emailVerified).toBe(true);
        // A fresh project works: the tracked migrations ran before provisioning.
        const migrations = await sql.unsafe<{ n: string }[]>(
          "SELECT COUNT(*)::text AS n FROM _migrations",
        );
        expect(Number(migrations[0]?.n)).toBeGreaterThanOrEqual(5);
      });
    } finally {
      await withPostgres(adminUrl, async (sql) => {
        await sql.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      });
    }
  }, 120000);
});
