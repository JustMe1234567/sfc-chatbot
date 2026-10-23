import type { DatabaseSync } from "node:sqlite";
import type { StaffRole } from "@/auth/server";

export interface StaffMemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

/** The staff roster for transfer pickers and the owner's management page. */
export function listStaffMembers(db: DatabaseSync): StaffMemberRow[] {
  return db
    .prepare(
      `SELECT "id", "name", "email", "role", "banned", "emailVerified", "twoFactorEnabled"
       FROM "user" ORDER BY "createdAt"`,
    )
    .all() as unknown as StaffMemberRow[];
}

interface EligibilityRow {
  id: string;
  name: string;
  role: string;
  banned: number;
  email_verified: number;
  two_factor_enabled: number;
}

/**
 * A staff account that can pass the dashboard's own checks today: active,
 * verified, second-factor-enrolled, and holding inbox permission. The set of
 * accounts a conversation may be transferred to.
 */
export function activeInboxMember(
  db: DatabaseSync,
  userId: string,
): { id: string; name: string } | null {
  const row = db
    .prepare(
      'SELECT "id", "name", "role", "banned", "emailVerified" AS email_verified, "twoFactorEnabled" AS two_factor_enabled FROM "user" WHERE "id" = ?',
    )
    .get(userId) as EligibilityRow | undefined;
  if (!row) {
    return null;
  }
  const role: StaffRole = row.role as StaffRole;
  const eligible =
    (role === "owner" || role === "staff") &&
    row.banned !== 1 &&
    row.email_verified === 1 &&
    row.two_factor_enabled === 1;
  return eligible ? { id: row.id, name: row.name } : null;
}
