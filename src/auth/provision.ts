import type { AppDatabase } from "../db/appDatabase";
import type { Auth, StaffRole } from "./server";

export interface ProvisionInput {
  email: string;
  name: string;
  password: string;
  role: StaffRole;
}

export interface ProvisionedStaff {
  userId: string;
  email: string;
  role: string;
}

/**
 * Server-side staff provisioning: the only way staff accounts come to exist.
 * Called by the owner bootstrap script; the dashboard invite flow (ticket 08)
 * reuses it. Account creation goes through the auth library's admin endpoint
 * in trusted server context (no session); the email is marked verified here
 * because provisioning happens at the owner's request, not via email flow.
 */
export async function provisionStaffMember(
  auth: Auth,
  db: AppDatabase,
  input: ProvisionInput,
): Promise<ProvisionedStaff> {
  const created = await auth.api.createUser({
    body: {
      email: input.email,
      name: input.name,
      password: input.password,
      role: input.role,
    },
  });
  const user = created?.user as { id?: string } | undefined;
  if (!user?.id) {
    throw new Error(`provisioning failed for ${input.email}: ${JSON.stringify(created).slice(0, 200)}`);
  }
  await db.run('UPDATE "user" SET "emailVerified" = ? WHERE "id" = ?', true, user.id);
  return { userId: user.id, email: input.email, role: input.role };
}
