import { postgresAppDatabase } from "../db/appDatabase";
import { migratePostgres, openPostgres } from "../db/postgres";
import { createOutboxTransport } from "../mail/outbox";
import { appBaseUrl } from "../config";
import { assertSupabaseConfigured, createSupabaseAuth } from "./supabase-provider";
import { provisionStaffMember } from "./provision";

export interface BootstrapOwnerInput {
  email: string;
  name: string;
  databaseUrl: string;
}

export interface BootstrapOwnerResult {
  userId: string;
  email: string;
  role: string;
  invitationStatus: "sent";
  store: string;
}

/** Invites the first owner into the configured Supabase test/production project. */
export async function bootstrapOwner(input: BootstrapOwnerInput): Promise<BootstrapOwnerResult> {
  assertSupabaseConfigured();
  const sql = openPostgres(input.databaseUrl);
  try {
    await migratePostgres(sql);
    const db = postgresAppDatabase(sql);
    const auth = createSupabaseAuth({
      db,
      mail: createOutboxTransport(db),
      baseUrl: appBaseUrl(),
    });
    const owner = await provisionStaffMember(auth, db, {
      email: input.email,
      name: input.name,
      role: "owner",
    });
    return { ...owner, store: `Postgres database at ${safePostgresTarget(input.databaseUrl)}` };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function safePostgresTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(an unparseable connection string)";
  }
}
