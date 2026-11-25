import { isStaffBanned } from "../api/staff";
import { postgresAppDatabase, type AppDatabase } from "../db/appDatabase";
import { migratePostgres, openPostgres } from "../db/postgres";

/**
 * The application's existing username rule — the same shape the members
 * POST route and the recover:staff command each enforce: 3-32 characters
 * of a-z, 0-9, dot, underscore, or hyphen after trim + lowercase.
 */
const STAFF_USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

function normalizeStaffUsername(value: string): string {
  return value.trim().toLowerCase();
}

function isValidStaffUsername(value: string): boolean {
  return STAFF_USERNAME_PATTERN.test(value);
}

export interface RenameStaffUsernameInput {
  /** The account's current username; matched case-insensitively. */
  currentUsername: string;
  /** The username to move the account to; validated, then stored lowercase. */
  newUsername: string;
}

export interface RenameStaffUsernameResult {
  staffId: string;
  from: string;
  to: string;
  updatedAt: string;
}

interface SourceRow {
  id: string;
  username: string;
  role: string | null;
  banned: unknown;
  supabaseUserId: string | null;
}

/**
 * The guarded rename of a staff account's application username. Every guard
 * runs inside one keyed transaction with the single write (username +
 * updatedAt), so a refusal cannot leave a partial state and a concurrent
 * roster change cannot slip between the count-then-write decisions.
 *
 * Only the application row changes. The linked Supabase Auth user is never
 * created, modified, or deleted — sign-in keeps working because Auth
 * identities key on the preserved staff ID (`<staffId>@staff.invalid`) and
 * Auth sessions reference the preserved Supabase user ID. Resetting that
 * account's password is a separate operation (recover:staff).
 */
export async function renameStaffUsernameOnDatabase(
  db: AppDatabase,
  input: RenameStaffUsernameInput,
): Promise<RenameStaffUsernameResult> {
  const from = normalizeStaffUsername(input.currentUsername);
  const to = normalizeStaffUsername(input.newUsername);
  if (!isValidStaffUsername(to)) {
    throw new Error(
      `The new username "${to}" is not valid: use 3-32 characters of a-z, 0-9, dot, underscore, or hyphen.`,
    );
  }
  const now = new Date().toISOString();
  return db.transaction("staff-username-rename", async (tx) => {
    const source = await tx.get<SourceRow>(
      `SELECT "id", "username", "role", "banned", "supabaseUserId"
       FROM staff_members WHERE lower("username") = lower(?)`,
      from,
    );
    if (!source) {
      throw new Error(`No staff account exists for the username "${from}".`);
    }
    if (isStaffBanned(source.banned)) {
      throw new Error(`The account "${source.username}" is disabled.`);
    }
    if (source.role !== "admin") {
      throw new Error(`The account "${source.username}" does not hold the admin role.`);
    }
    if (!source.supabaseUserId) {
      throw new Error(`The account "${source.username}" has no linked Auth user.`);
    }
    const destination = await tx.get<{ id: string }>(
      `SELECT "id" FROM staff_members WHERE lower("username") = lower(?)`,
      to,
    );
    if (destination) {
      throw new Error(
        `An account already exists with the username "${to}" (usernames are case-insensitive).`,
      );
    }
    const admins = await tx.all<{ banned: unknown }>(
      `SELECT "banned" FROM staff_members WHERE "role" = 'admin'`,
    );
    const activeAdmins = admins.filter((admin) => !isStaffBanned(admin.banned));
    if (activeAdmins.length !== 1) {
      throw new Error(
        `Expected exactly one active admin account; found ${activeAdmins.length}. Rename refused.`,
      );
    }
    const updated = await tx.run(
      `UPDATE staff_members SET "username" = ?, "updatedAt" = ? WHERE "id" = ?`,
      to,
      now,
      source.id,
    );
    if (updated.changes !== 1) {
      throw new Error("The rename did not update exactly one row; rolled back.");
    }
    return { staffId: source.id, from, to, updatedAt: now };
  });
}

export interface RenameStaffUsernameOperatorInput extends RenameStaffUsernameInput {
  databaseUrl: string;
}

/** The operator entry point: migrations, the guarded rename, connection cleanup. */
export async function renameStaffUsername(
  input: RenameStaffUsernameOperatorInput,
): Promise<RenameStaffUsernameResult> {
  const sql = openPostgres(input.databaseUrl);
  try {
    await migratePostgres(sql);
    const db = postgresAppDatabase(sql);
    return await renameStaffUsernameOnDatabase(db, {
      currentUsername: input.currentUsername,
      newUsername: input.newUsername,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
