import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db/appDatabase";
import type { AuthProvider } from "./provider";
import type { StaffRole } from "./server";

export interface ProvisionInput {
  email: string;
  name: string;
  role: StaffRole;
}

export interface ProvisionedStaff {
  userId: string;
  email: string;
  role: string;
  invitationStatus: "sent";
}

interface ExistingStaff {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: unknown;
  invitationStatus: "pending" | "sent" | "accepted";
}

function isBanned(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

/**
 * Creates or retries an invitation without ever accepting a role change as
 * part of the retry. The application row is written first as `pending`, so a
 * mail/provider failure is visible and safely retryable instead of leaving an
 * untracked Supabase user.
 */
export async function provisionStaffMember(
  auth: AuthProvider,
  db: AppDatabase,
  input: ProvisionInput,
): Promise<ProvisionedStaff> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const existing = await db.get<ExistingStaff>(
    `SELECT "id", "name", "email", "role", "banned", "invitationStatus"
     FROM staff_members WHERE lower(email) = lower(?)`,
    email,
  );

  let applicationId: string;
  if (existing) {
    if (
      isBanned(existing.banned) ||
      existing.invitationStatus === "accepted" ||
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
       ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role",
        "banned", "twoFactorEnabled", "supabaseUserId", "invitationStatus")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      applicationId,
      name,
      email,
      false,
      now,
      now,
      input.role,
      false,
      false,
      null,
      "pending",
    );
  }

  const invited = await auth.invite(email, name);
  await db.run(
    `UPDATE staff_members
     SET "supabaseUserId" = ?, "invitationStatus" = 'sent', "updatedAt" = ?
     WHERE "id" = ?`,
    invited.userId,
    new Date().toISOString(),
    applicationId,
  );
  return { userId: applicationId, email, role: input.role, invitationStatus: "sent" };
}
