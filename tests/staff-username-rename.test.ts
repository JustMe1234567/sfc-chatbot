import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { provisionStaffMember } from "../src/auth/provision";
import { renameStaffUsernameOnDatabase } from "../src/auth/renameStaffUsername";
import { getChatbotService } from "../src/db/service";
import { useTempDatabase, warmChatbotService } from "./helpers";

beforeAll(async () => {
  useTempDatabase();
  await warmChatbotService();
});

afterEach(async () => {
  const ids = fixtureIds.splice(0);
  if (ids.length === 0) return;
  const { db } = await getChatbotService();
  for (const id of ids) {
    await db.run(`DELETE FROM staff_members WHERE "id" = ?`, id);
  }
});

/**
 * Each test provisions its own fixtures with unique usernames and the file's
 * one temp database is shared, so every test reaps its rows afterwards and
 * stays self-contained regardless of order.
 */
const fixtureIds: string[] = [];
const PASSWORD = "rename-test-password";

interface StaffSnapshot {
  id: string;
  name: string;
  email: string;
  username: string;
  emailVerified: unknown;
  createdAt: string;
  updatedAt: string;
  role: string;
  banned: unknown;
  supabaseUserId: string | null;
  invitationStatus: string;
}

const SNAPSHOT_COLUMNS = `"id", "name", "email", "username", "emailVerified", "createdAt",
  "updatedAt", "role", "banned", "supabaseUserId", "invitationStatus"`;

async function snapshot(username: string): Promise<StaffSnapshot | undefined> {
  const { db } = await getChatbotService();
  return db.get<StaffSnapshot>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM staff_members WHERE lower("username") = lower(?)`,
    username,
  );
}

async function provision(
  username: string,
  role: "admin" | "admissions_advisor",
): Promise<StaffSnapshot> {
  const { auth, db } = await getChatbotService();
  await provisionStaffMember(auth, db, {
    username,
    password: PASSWORD,
    name: "Rename Fixture",
    role,
  });
  const row = await snapshot(username);
  if (!row) throw new Error(`Fixture ${username} was not provisioned.`);
  fixtureIds.push(row.id);
  return row;
}

function withoutVolatileFields(
  row: StaffSnapshot | undefined,
): Omit<StaffSnapshot, "updatedAt"> | undefined {
  if (!row) return undefined;
  const { updatedAt: _updatedAt, ...rest } = row;
  return rest;
}

describe("the guarded staff username rename (ticket 98)", () => {
  test("renames the sole active admin, changing only username and updatedAt", async () => {
    const before = await provision("owner", "admin");
    const { db } = await getChatbotService();
    // Pin the timestamp old so the rename's fresh updatedAt is observable.
    await db.run(
      `UPDATE staff_members SET "updatedAt" = ? WHERE "id" = ?`,
      "2020-01-01T00:00:00.000Z",
      before.id,
    );

    const result = await renameStaffUsernameOnDatabase(db, {
      currentUsername: "owner",
      newUsername: "SFC-Admin",
    });

    expect(result).toMatchObject({ staffId: before.id, from: "owner", to: "sfc-admin" });
    const after = await snapshot("sfc-admin");
    expect(after?.username).toBe("sfc-admin"); // stored lowercase; "SFC-Admin" was normalized
    expect(after?.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    // The preserved set: staff ID, Supabase user ID (and with it the Auth
    // user and its sessions, which key on that ID and are never touched),
    // name, role, email, flags, createdAt, invitationStatus.
    expect(withoutVolatileFields(after)).toEqual(
      withoutVolatileFields({ ...before, username: "sfc-admin" }),
    );
    // Nothing extra appeared and the old name is gone.
    const all = await db.all<{ username: string }>(`SELECT "username" FROM staff_members`);
    expect(all.map((row) => row.username)).toEqual(["sfc-admin"]);
  });

  test("refuses a missing source and writes nothing", async () => {
    const { db } = await getChatbotService();
    await expect(
      renameStaffUsernameOnDatabase(db, { currentUsername: "ghost", newUsername: "sfc-admin-missing" }),
    ).rejects.toThrowError(/No staff account exists for the username "ghost"/);
    expect(await snapshot("ghost")).toBeUndefined();
    expect(await snapshot("sfc-admin-missing")).toBeUndefined();
  });

  test("refuses a duplicate destination case-insensitively, even a disabled one", async () => {
    await provision("owner-dup", "admin");
    const destination = await provision("destination", "admissions_advisor");
    const { db } = await getChatbotService();
    // Uppercase in the store and disabled: the guard (like the unique index
    // beneath it) spans case and account state.
    await db.run(
      `UPDATE staff_members SET "username" = ?, "banned" = ? WHERE "id" = ?`,
      "SFC-Admin-Dup",
      true,
      destination.id,
    );
    await expect(
      renameStaffUsernameOnDatabase(db, {
        currentUsername: "owner-dup",
        newUsername: "sfc-admin-dup",
      }),
    ).rejects.toThrowError(/already exists with the username "sfc-admin-dup"/);
    expect((await snapshot("owner-dup"))?.username).toBe("owner-dup");
  });

  test("refuses a non-admin source", async () => {
    await provision("desk-staff", "admissions_advisor");
    const { db } = await getChatbotService();
    await expect(
      renameStaffUsernameOnDatabase(db, {
        currentUsername: "desk-staff",
        newUsername: "sfc-admin-staff",
      }),
    ).rejects.toThrowError(/does not hold the admin role/);
    expect((await snapshot("desk-staff"))?.username).toBe("desk-staff");
    expect(await snapshot("sfc-admin-staff")).toBeUndefined();
  });

  test("refuses a disabled source", async () => {
    const source = await provision("disabled-owner", "admin");
    const { db } = await getChatbotService();
    await db.run(`UPDATE staff_members SET "banned" = ? WHERE "id" = ?`, true, source.id);
    await expect(
      renameStaffUsernameOnDatabase(db, {
        currentUsername: "disabled-owner",
        newUsername: "sfc-admin-disabled",
      }),
    ).rejects.toThrowError(/is disabled/);
    expect(await snapshot("sfc-admin-disabled")).toBeUndefined();
  });

  test("refuses an unlinked source", async () => {
    const source = await provision("unlinked-owner", "admin");
    const { db } = await getChatbotService();
    await db.run(`UPDATE staff_members SET "supabaseUserId" = NULL WHERE "id" = ?`, source.id);
    await expect(
      renameStaffUsernameOnDatabase(db, {
        currentUsername: "unlinked-owner",
        newUsername: "sfc-admin-unlinked",
      }),
    ).rejects.toThrowError(/has no linked Auth user/);
    expect(await snapshot("sfc-admin-unlinked")).toBeUndefined();
  });

  test("refuses when more than one active admin exists", async () => {
    await provision("owner-a", "admin");
    await provision("owner-b", "admin");
    const { db } = await getChatbotService();
    await expect(
      renameStaffUsernameOnDatabase(db, {
        currentUsername: "owner-a",
        newUsername: "sfc-admin-multi",
      }),
    ).rejects.toThrowError(/exactly one active admin account; found 2/);
    expect(await snapshot("sfc-admin-multi")).toBeUndefined();
  });

  test("refuses an invalid destination username", async () => {
    await provision("invalid-dest-owner", "admin");
    const { db } = await getChatbotService();
    for (const bad of ["ab", "sfc admin!", "a".repeat(33), ""]) {
      await expect(
        renameStaffUsernameOnDatabase(db, {
          currentUsername: "invalid-dest-owner",
          newUsername: bad,
        }),
      ).rejects.toThrowError(/is not valid/);
    }
    expect((await snapshot("invalid-dest-owner"))?.username).toBe("invalid-dest-owner");
  });

  test("a refused rename leaves the whole roster untouched", async () => {
    const ownerA = await provision("rollback-a", "admin");
    const ownerB = await provision("rollback-b", "admin");
    const { db } = await getChatbotService();
    await db.run(
      `UPDATE staff_members SET "updatedAt" = ? WHERE "id" IN (?, ?)`,
      "2020-01-01T00:00:00.000Z",
      ownerA.id,
      ownerB.id,
    );
    const beforeA = await snapshot("rollback-a");
    const beforeB = await snapshot("rollback-b");
    await expect(
      renameStaffUsernameOnDatabase(db, {
        currentUsername: "rollback-a",
        newUsername: "sfc-admin-rollback",
      }),
    ).rejects.toThrowError(/exactly one active admin/);
    // The guard refused inside the keyed transaction before the only write,
    // so every stored byte is identical (on Postgres the transaction rolls
    // back outright; on SQLite no statement had run past the reads).
    expect(await snapshot("rollback-a")).toEqual(beforeA);
    expect(await snapshot("rollback-b")).toEqual(beforeB);
    expect(await snapshot("sfc-admin-rollback")).toBeUndefined();
  });
});
