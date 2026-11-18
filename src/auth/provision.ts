import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db/appDatabase";
import type { AuthProvider } from "./provider";
import type { StaffRole } from "./server";

export interface ProvisionInput {
  username: string;
  password: string;
  name: string;
  role: StaffRole;
}

export interface ProvisionedStaff {
  userId: string;
  username: string;
  role: string;
}

interface ExistingStaff {
  id: string;
  name: string;
  username: string;
  role: string;
  banned: unknown;
  supabaseUserId: string | null;
}

function isBanned(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

/**
 * Creates an owner-managed staff account. The application row is written
 * first so a provider failure remains visible and can be retried without
 * changing the requested name or role.
 */
export async function provisionStaffMember(
  auth: AuthProvider,
  db: AppDatabase,
  input: ProvisionInput,
): Promise<ProvisionedStaff> {
  const username = input.username.trim().toLowerCase();
  const name = input.name.trim();
  const existing = await db.get<ExistingStaff>(
    `SELECT "id", "name", "username", "role", "banned", "supabaseUserId"
     FROM staff_members WHERE lower("username") = lower(?)`,
    username,
  );

  let applicationId: string;
  if (existing) {
    if (
      isBanned(existing.banned) ||
      existing.supabaseUserId !== null ||
      existing.name !== name ||
      existing.role !== input.role
    ) {
      throw new Error("An accepted, disabled, or differently provisioned staff account already exists.");
    }
    applicationId = existing.id;
  } else {
    applicationId = randomUUID();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO staff_members
       ("id", "name", "email", "username", "emailVerified", "createdAt", "updatedAt", "role",
        "banned", "twoFactorEnabled", "supabaseUserId", "invitationStatus")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      applicationId,
      name,
      `${applicationId}@staff.invalid`,
      username,
      true,
      now,
      now,
      input.role,
      false,
      false,
      null,
      "accepted",
    );
  }

  const created = await auth.createAccount(applicationId, name, input.password);
  await db.run(
    `UPDATE staff_members
     SET "supabaseUserId" = ?, "updatedAt" = ?
     WHERE "id" = ?`,
    created.userId,
    new Date().toISOString(),
    applicationId,
  );
  return { userId: applicationId, username, role: input.role };
}
