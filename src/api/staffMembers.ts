import type { AppDatabase } from "../db/appDatabase";
import type { StaffRole } from "../auth/server";

export interface StaffMemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

/** Flag columns are INTEGER 0/1 on SQLite and BOOLEAN on Postgres. */
function truthy(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

interface UserFlagRow {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: unknown;
  emailVerified: unknown;
  twoFactorEnabled: unknown;
  [column: string]: unknown;
}

/** The staff roster for transfer pickers and the owner's management page. */
export async function listStaffMembers(db: AppDatabase): Promise<StaffMemberRow[]> {
  const rows = await db.all<UserFlagRow>(
    `SELECT "id", "name", "email", "role", "banned", "emailVerified", "twoFactorEnabled"
     FROM "user" ORDER BY "createdAt"`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    banned: truthy(row.banned),
    emailVerified: truthy(row.emailVerified),
    twoFactorEnabled: truthy(row.twoFactorEnabled),
  }));
}

/**
 * A staff account that can pass the dashboard's own checks today: active,
 * verified, second-factor-enrolled, and holding inbox permission. The set of
 * accounts a conversation may be transferred to.
 */
export async function activeInboxMember(
  db: AppDatabase,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  const row = await db.get<{
    id: string;
    name: string;
    role: string;
    banned: unknown;
    email_verified: unknown;
    two_factor_enabled: unknown;
  }>(
    'SELECT "id", "name", "role", "banned", "emailVerified" AS email_verified, "twoFactorEnabled" AS two_factor_enabled FROM "user" WHERE "id" = ?',
    userId,
  );
  if (!row) {
    return null;
  }
  const role: StaffRole = row.role as StaffRole;
  const eligible =
    (role === "owner" || role === "staff") &&
    !truthy(row.banned) &&
    truthy(row.email_verified) &&
    truthy(row.two_factor_enabled);
  return eligible ? { id: row.id, name: row.name } : null;
}
