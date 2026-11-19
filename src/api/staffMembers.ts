import type { AppDatabase } from "../db/appDatabase";
import type { StaffRole } from "../auth/server";

export interface StaffMemberRow {
  id: string;
  name: string;
  username: string;
  role: string;
  banned: boolean;
  emailVerified: boolean;
}

/** Flag columns are INTEGER 0/1 on SQLite and BOOLEAN on Postgres. */
function truthy(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

interface UserFlagRow {
  id: string;
  name: string;
  username: string;
  role: string;
  banned: unknown;
  emailVerified: unknown;
  [column: string]: unknown;
}

/** The staff roster for transfer pickers and the owner's management page. */
export async function listStaffMembers(db: AppDatabase): Promise<StaffMemberRow[]> {
  const rows = await db.all<UserFlagRow>(
    `SELECT "id", "name", "username", "role", "banned", "emailVerified"
     FROM staff_members ORDER BY "createdAt"`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    banned: truthy(row.banned),
    emailVerified: truthy(row.emailVerified),
  }));
}

/**
 * A staff account that can pass the dashboard's own checks today: active,
 * verified, and holding inbox permission (owner or staff role). The set of
 * accounts a conversation may be transferred to — since ticket 82 removed
 * the second factor, factor state no longer narrows it.
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
  }>(
    'SELECT "id", "name", "role", "banned", "emailVerified" AS email_verified FROM staff_members WHERE "id" = ?',
    userId,
  );
  if (!row) {
    return null;
  }
  const role: StaffRole = row.role as StaffRole;
  const eligible =
    (role === "owner" || role === "staff") && !truthy(row.banned) && truthy(row.email_verified);
  return eligible ? { id: row.id, name: row.name } : null;
}
